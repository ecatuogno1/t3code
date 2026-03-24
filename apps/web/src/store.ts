import { Fragment, type ReactNode, createElement, useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type BrowserEvent,
  type BrowserTabSnapshot,
  type ProviderKind,
  ThreadId,
  type WorkspaceId,
  type WorkspaceProjectId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
  type WorkspaceReadModel,
} from "@t3tools/contracts";
import {
  inferProviderForModel,
  resolveModelSlug,
  resolveModelSlugForProvider,
} from "@t3tools/shared/model";
import { create } from "zustand";
import {
  type ChatMessage,
  type Project,
  type Thread,
  type Workspace,
  type WorkspaceProject,
} from "./types";
import { Debouncer } from "@tanstack/react-pacer";
import {
  normalizeWorkspacePaneState,
  parseChatPaneThreadId,
  reconcileWorkspacePaneState,
  removeWorkspacePane,
  resolveDefaultPaneTier,
  resolveWorkspacePreferredPaneId,
  resolveDefaultWorkspaceProjectId,
  type WorkspacePaneState,
  upsertWorkspaceThreadPane,
} from "./workspaceShell";
import type { WorkspacePaneTier } from "@t3tools/contracts";
import {
  buildWorkspaceEnvironmentTargetKey,
  type WorkspaceBrowserEnvironment,
} from "./workspaceBrowserTargets";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  workspaces: Workspace[];
  workspaceProjects: WorkspaceProject[];
  workspaceShellById: Record<WorkspaceId, WorkspacePaneState>;
  workspaceFilesSidebarById: Record<
    WorkspaceId,
    {
      open: boolean;
      selectionValue: string | null;
    }
  >;
  recentWorkspaceIds: WorkspaceId[];
  lastActiveWorkspaceId: WorkspaceId | null;
  activeWorkspaceProjectIdByWorkspaceId: Record<WorkspaceId, WorkspaceProjectId | null>;
  preferredChildWorkspaceIdByRootId: Record<WorkspaceId, WorkspaceId | null>;
  activeWorkspaceDevTargetByWorkspaceId: Record<WorkspaceId, string | null>;
  configuredWorkspaceEnvironmentUrlsByKey: Record<string, string>;
  expandedWorkspaceThreadClusterIds: string[];
  browserRuntimeTabsById: Record<string, BrowserTabSnapshot>;
  threadsHydrated: boolean;
  workspacesHydrated: boolean;
}

const PERSISTED_STATE_KEY = "t3code:renderer-state:v10";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  workspaces: [],
  workspaceProjects: [],
  workspaceShellById: {},
  workspaceFilesSidebarById: {},
  recentWorkspaceIds: [],
  lastActiveWorkspaceId: null,
  activeWorkspaceProjectIdByWorkspaceId: {},
  preferredChildWorkspaceIdByRootId: {},
  activeWorkspaceDevTargetByWorkspaceId: {},
  configuredWorkspaceEnvironmentUrlsByKey: {},
  expandedWorkspaceThreadClusterIds: [],
  browserRuntimeTabsById: {},
  threadsHydrated: false,
  workspacesHydrated: false,
};
const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];

// ── Persist helpers ──────────────────────────────────────────────────

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as {
      expandedProjectCwds?: string[];
      projectOrderCwds?: string[];
      workspaceShellById?: Record<
        string,
        {
          paneOrder?: string[];
          activePaneId?: string | null;
          paneTierById?: Record<string, string>;
        }
      >;
      workspaceFilesSidebarById?: Record<
        string,
        {
          open?: boolean;
          selectionValue?: string | null;
        }
      >;
      recentWorkspaceIds?: string[];
      lastActiveWorkspaceId?: string | null;
      openWorkspaceTabIds?: string[];
      activeWorkspaceTabId?: string | null;
      activeWorkspaceProjectIdByWorkspaceId?: Record<string, string | null>;
      preferredChildWorkspaceIdByRootId?: Record<string, string | null>;
      activeWorkspaceDevTargetByWorkspaceId?: Record<string, string | null>;
      configuredWorkspaceEnvironmentUrlsByKey?: Record<string, string>;
      expandedWorkspaceThreadClusterIds?: string[];
    };
    persistedExpandedProjectCwds.clear();
    persistedProjectOrderCwds.length = 0;
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedExpandedProjectCwds.add(cwd);
      }
    }
    for (const cwd of parsed.projectOrderCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
        persistedProjectOrderCwds.push(cwd);
      }
    }
    const VALID_TIERS = new Set<string>(["workspace", "project", "ephemeral"]);
    const workspaceShellById = Object.fromEntries(
      Object.entries(parsed.workspaceShellById ?? {}).map(([workspaceId, shellState]) => {
        const rawTiers = shellState?.paneTierById ?? {};
        const paneTierById = Object.fromEntries(
          Object.entries(rawTiers).filter(
            ([, tier]) => typeof tier === "string" && VALID_TIERS.has(tier),
          ),
        ) as Record<string, WorkspacePaneTier>;
        return [
          workspaceId as WorkspaceId,
          normalizeWorkspacePaneState({
            ...(shellState?.paneOrder ? { paneOrder: shellState.paneOrder } : {}),
            activePaneId: shellState?.activePaneId ?? null,
            paneTierById,
          }),
        ];
      }),
    ) as Record<WorkspaceId, WorkspacePaneState>;
    const workspaceFilesSidebarById = Object.fromEntries(
      Object.entries(parsed.workspaceFilesSidebarById ?? {}).flatMap(
        ([workspaceId, filesSidebarState]) =>
          typeof workspaceId === "string" && workspaceId.length > 0
            ? [
                [
                  workspaceId as WorkspaceId,
                  {
                    open: filesSidebarState?.open === true,
                    selectionValue:
                      typeof filesSidebarState?.selectionValue === "string"
                        ? filesSidebarState.selectionValue
                        : null,
                  },
                ],
              ]
            : [],
      ),
    ) as AppState["workspaceFilesSidebarById"];
    const recentWorkspaceIds = Array.from(
      new Set(
        (parsed.recentWorkspaceIds ?? parsed.openWorkspaceTabIds ?? []).flatMap((workspaceId) =>
          typeof workspaceId === "string" && workspaceId.length > 0
            ? [workspaceId as WorkspaceId]
            : [],
        ),
      ),
    );
    const lastActiveWorkspaceIdCandidate =
      parsed.lastActiveWorkspaceId ?? parsed.activeWorkspaceTabId ?? null;
    const lastActiveWorkspaceId =
      lastActiveWorkspaceIdCandidate &&
      recentWorkspaceIds.includes(lastActiveWorkspaceIdCandidate as WorkspaceId)
        ? (lastActiveWorkspaceIdCandidate as WorkspaceId)
        : (recentWorkspaceIds.at(0) ?? null);
    const activeWorkspaceProjectIdByWorkspaceId = Object.fromEntries(
      Object.entries(parsed.activeWorkspaceProjectIdByWorkspaceId ?? {}).flatMap(
        ([workspaceId, workspaceProjectId]) =>
          typeof workspaceId === "string" && workspaceId.length > 0
            ? [[workspaceId as WorkspaceId, workspaceProjectId as WorkspaceProjectId | null]]
            : [],
      ),
    ) as Record<WorkspaceId, WorkspaceProjectId | null>;
    const preferredChildWorkspaceIdByRootId = Object.fromEntries(
      Object.entries(parsed.preferredChildWorkspaceIdByRootId ?? {}).flatMap(
        ([rootWorkspaceId, childWorkspaceId]) =>
          typeof rootWorkspaceId === "string" && rootWorkspaceId.length > 0
            ? [[rootWorkspaceId as WorkspaceId, childWorkspaceId as WorkspaceId | null]]
            : [],
      ),
    ) as Record<WorkspaceId, WorkspaceId | null>;
    const activeWorkspaceDevTargetByWorkspaceId = Object.fromEntries(
      Object.entries(parsed.activeWorkspaceDevTargetByWorkspaceId ?? {}).flatMap(
        ([workspaceId, targetKey]) =>
          typeof workspaceId === "string" && workspaceId.length > 0
            ? [[workspaceId as WorkspaceId, typeof targetKey === "string" ? targetKey : null]]
            : [],
      ),
    ) as Record<WorkspaceId, string | null>;
    const configuredWorkspaceEnvironmentUrlsByKey = Object.fromEntries(
      Object.entries(parsed.configuredWorkspaceEnvironmentUrlsByKey ?? {}).flatMap(
        ([targetKey, url]) =>
          typeof targetKey === "string" &&
          targetKey.length > 0 &&
          typeof url === "string" &&
          url.length > 0
            ? [[targetKey, url]]
            : [],
      ),
    ) as Record<string, string>;
    const expandedWorkspaceThreadClusterIds = Array.from(
      new Set(
        (parsed.expandedWorkspaceThreadClusterIds ?? []).flatMap((workspaceId) =>
          typeof workspaceId === "string" && workspaceId.length > 0
            ? [workspaceId as WorkspaceId]
            : [],
        ),
      ),
    );
    return {
      ...initialState,
      workspaceShellById,
      workspaceFilesSidebarById,
      recentWorkspaceIds,
      lastActiveWorkspaceId,
      activeWorkspaceProjectIdByWorkspaceId,
      preferredChildWorkspaceIdByRootId,
      activeWorkspaceDevTargetByWorkspaceId,
      configuredWorkspaceEnvironmentUrlsByKey,
      expandedWorkspaceThreadClusterIds,
    };
  } catch {
    return initialState;
  }
}

let legacyKeysCleanedUp = false;

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds: state.projects
          .filter((project) => project.expanded)
          .map((project) => project.cwd),
        projectOrderCwds: state.projects.map((project) => project.cwd),
        workspaceShellById: Object.fromEntries(
          Object.entries(state.workspaceShellById).map(([workspaceId, shellState]) => [
            workspaceId,
            {
              paneOrder: shellState.paneOrder,
              activePaneId: shellState.activePaneId,
              ...(Object.keys(shellState.paneTierById).length > 0
                ? { paneTierById: shellState.paneTierById }
                : {}),
            },
          ]),
        ),
        workspaceFilesSidebarById: state.workspaceFilesSidebarById,
        recentWorkspaceIds: state.recentWorkspaceIds,
        lastActiveWorkspaceId: state.lastActiveWorkspaceId,
        activeWorkspaceProjectIdByWorkspaceId: state.activeWorkspaceProjectIdByWorkspaceId,
        preferredChildWorkspaceIdByRootId: state.preferredChildWorkspaceIdByRootId,
        activeWorkspaceDevTargetByWorkspaceId: state.activeWorkspaceDevTargetByWorkspaceId,
        configuredWorkspaceEnvironmentUrlsByKey: state.configuredWorkspaceEnvironmentUrlsByKey,
        expandedWorkspaceThreadClusterIds: state.expandedWorkspaceThreadClusterIds,
      }),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}
const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(previous.map((project) => [project.cwd, project] as const));
  const previousOrderById = new Map(previous.map((project, index) => [project.id, index] as const));
  const previousOrderByCwd = new Map(
    previous.map((project, index) => [project.cwd, index] as const),
  );
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const usePersistedOrder = previous.length === 0;

  const mappedProjects = incoming.map((project) => {
    const existing = previousById.get(project.id) ?? previousByCwd.get(project.workspaceRoot);
    return {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      model:
        existing?.model ??
        resolveModelSlug(project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex),
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectCwds.size > 0
          ? persistedExpandedProjectCwds.has(project.workspaceRoot)
          : true),
      scripts: project.scripts.map((script) => ({ ...script })),
    } satisfies Project;
  });

  return mappedProjects
    .map((project, incomingIndex) => {
      const previousIndex =
        previousOrderById.get(project.id) ?? previousOrderByCwd.get(project.cwd);
      const persistedIndex = usePersistedOrder ? persistedOrderByCwd.get(project.cwd) : undefined;
      const orderIndex =
        previousIndex ??
        persistedIndex ??
        (usePersistedOrder ? persistedProjectOrderCwds.length : previous.length) + incomingIndex;
      return { project, incomingIndex, orderIndex };
    })
    .toSorted((a, b) => {
      const byOrder = a.orderIndex - b.orderIndex;
      if (byOrder !== 0) return byOrder;
      return a.incomingIndex - b.incomingIndex;
    })
    .map((entry) => entry.project);
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === "codex" || providerName === "claudeAgent") {
    return providerName;
  }
  return "codex";
}

function inferProviderForThreadModel(input: {
  readonly model: string;
  readonly sessionProviderName: string | null;
}): ProviderKind {
  if (input.sessionProviderName === "codex" || input.sessionProviderName === "claudeAgent") {
    return input.sessionProviderName;
  }
  return inferProviderForModel(input.model);
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

/**
 * Returns the existing thread reference if the new thread is structurally
 * equivalent, avoiding unnecessary re-renders from Zustand subscriptions.
 */
function reuseThreadIfUnchanged(next: Thread, existing: Thread | undefined): Thread {
  if (!existing) return next;
  if (
    next.title !== existing.title ||
    next.error !== existing.error ||
    next.branch !== existing.branch ||
    next.worktreePath !== existing.worktreePath ||
    next.pullRequestUrl !== existing.pullRequestUrl ||
    next.messages.length !== existing.messages.length ||
    next.activities.length !== existing.activities.length ||
    next.turnDiffSummaries.length !== existing.turnDiffSummaries.length ||
    next.proposedPlans.length !== existing.proposedPlans.length ||
    next.session?.status !== existing.session?.status ||
    next.session?.activeTurnId !== existing.session?.activeTurnId ||
    next.latestTurn?.completedAt !== existing.latestTurn?.completedAt ||
    next.latestTurn?.startedAt !== existing.latestTurn?.startedAt ||
    next.runtimeMode !== existing.runtimeMode ||
    next.interactionMode !== existing.interactionMode ||
    next.model !== existing.model
  ) {
    return next;
  }
  // Compare last message content for streaming updates
  const lastMsg = next.messages.at(-1);
  const existingLastMsg = existing.messages.at(-1);
  if (lastMsg?.id !== existingLastMsg?.id || lastMsg?.streaming !== existingLastMsg?.streaming) {
    return next;
  }
  return existing;
}

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    state.projects,
  );
  const existingThreadById = new Map(state.threads.map((thread) => [thread.id, thread] as const));
  const threads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      const nextThread: Thread = {
        id: thread.id,
        codexThreadId: null,
        projectId: thread.projectId,
        workspaceId: thread.workspaceId,
        workspaceProjectId: thread.workspaceProjectId ?? null,
        title: thread.title,
        model: resolveModelSlugForProvider(
          inferProviderForThreadModel({
            model: thread.model,
            sessionProviderName: thread.session?.providerName ?? null,
          }),
          thread.model,
        ),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        session: thread.session
          ? {
              provider: toLegacyProvider(thread.session.providerName),
              status: toLegacySessionStatus(thread.session.status),
              orchestrationStatus: thread.session.status,
              activeTurnId: thread.session.activeTurnId ?? undefined,
              createdAt: thread.session.updatedAt,
              updatedAt: thread.session.updatedAt,
              ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
            }
          : null,
        categorization: thread.categorization ?? null,
        messages: thread.messages.map((message) => {
          const attachments = message.attachments?.map((attachment) => ({
            type: "image" as const,
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
          }));
          const normalizedMessage: ChatMessage = {
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            streaming: message.streaming,
            ...(message.streaming ? {} : { completedAt: message.updatedAt }),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          };
          return normalizedMessage;
        }),
        proposedPlans: thread.proposedPlans.map((proposedPlan) => ({
          id: proposedPlan.id,
          turnId: proposedPlan.turnId,
          planMarkdown: proposedPlan.planMarkdown,
          implementedAt: proposedPlan.implementedAt,
          implementationThreadId: proposedPlan.implementationThreadId,
          createdAt: proposedPlan.createdAt,
          updatedAt: proposedPlan.updatedAt,
        })),
        error: thread.session?.lastError ?? null,
        createdAt: thread.createdAt,
        latestTurn: thread.latestTurn,
        lastVisitedAt: existing?.lastVisitedAt ?? thread.updatedAt,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        pullRequestUrl: thread.pullRequestUrl ?? null,
        previewUrls: [...(thread.previewUrls ?? [])],
        turnDiffSummaries: thread.checkpoints.map((checkpoint) => ({
          turnId: checkpoint.turnId,
          completedAt: checkpoint.completedAt,
          status: checkpoint.status,
          assistantMessageId: checkpoint.assistantMessageId ?? undefined,
          checkpointTurnCount: checkpoint.checkpointTurnCount,
          checkpointRef: checkpoint.checkpointRef,
          files: checkpoint.files.map((file) => ({ ...file })),
        })),
        activities: thread.activities.map((activity) => ({ ...activity })),
      };
      return reuseThreadIfUnchanged(nextThread, existing);
    });
  // Preserve array reference if all threads are unchanged
  const threadsUnchanged =
    threads.length === state.threads.length && threads.every((t, i) => t === state.threads[i]);
  return {
    ...state,
    projects,
    threads: threadsUnchanged ? state.threads : threads,
    threadsHydrated: true,
  };
}

export function syncWorkspaceReadModel(state: AppState, readModel: WorkspaceReadModel): AppState {
  const existingWorkspaceById = new Map(
    state.workspaces.map((workspace) => [workspace.id, workspace] as const),
  );
  const workspaces = readModel.workspaces.map((workspace) => {
    const existing = existingWorkspaceById.get(workspace.id);
    if (!existing) return { ...workspace };
    // Compare key fields to preserve reference identity
    if (
      existing.title === workspace.title &&
      existing.deletedAt === workspace.deletedAt &&
      existing.lastFocusedPaneId === workspace.lastFocusedPaneId &&
      existing.panes.length === workspace.panes.length &&
      existing.browserTabs.length === workspace.browserTabs.length &&
      existing.layout.activePaneId === workspace.layout.activePaneId &&
      existing.layout.paneOrder.length === workspace.layout.paneOrder.length &&
      existing.layout.paneOrder.every((id, i) => id === workspace.layout.paneOrder[i])
    ) {
      return existing;
    }
    return { ...workspace };
  });
  const workspacesUnchanged =
    workspaces.length === state.workspaces.length &&
    workspaces.every((w, i) => w === state.workspaces[i]);

  const existingWorkspaceProjectById = new Map(
    state.workspaceProjects.map((wp) => [wp.id, wp] as const),
  );
  const workspaceProjects = readModel.workspaceProjects
    .filter((workspaceProject) => workspaceProject.deletedAt === null)
    .map((workspaceProject) => {
      const existing = existingWorkspaceProjectById.get(workspaceProject.id);
      if (
        existing &&
        existing.title === workspaceProject.title &&
        existing.kind === workspaceProject.kind &&
        existing.workspaceId === workspaceProject.workspaceId
      ) {
        return existing;
      }
      return Object.assign({}, workspaceProject);
    });
  const workspaceProjectsUnchanged =
    workspaceProjects.length === state.workspaceProjects.length &&
    workspaceProjects.every((wp, i) => wp === state.workspaceProjects[i]);
  const availableWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
  const workspaceFilesSidebarById = Object.fromEntries(
    Object.entries(state.workspaceFilesSidebarById).flatMap(([workspaceId, filesSidebarState]) =>
      availableWorkspaceIds.has(workspaceId as WorkspaceId)
        ? [[workspaceId as WorkspaceId, filesSidebarState]]
        : [],
    ),
  ) as AppState["workspaceFilesSidebarById"];
  const recentWorkspaceIds = state.recentWorkspaceIds.filter((workspaceId) =>
    availableWorkspaceIds.has(workspaceId),
  );
  const lastActiveWorkspaceId =
    state.lastActiveWorkspaceId && availableWorkspaceIds.has(state.lastActiveWorkspaceId)
      ? state.lastActiveWorkspaceId
      : (recentWorkspaceIds.at(-1) ?? recentWorkspaceIds[0] ?? null);
  const activeWorkspaceProjectIdByWorkspaceId = Object.fromEntries(
    workspaces.map((workspace) => {
      const workspaceProjectIds = workspaceProjects
        .filter((workspaceProject) => workspaceProject.workspaceId === workspace.id)
        .map((workspaceProject) => workspaceProject.id);
      const workspaceProjectIdSet = new Set(workspaceProjectIds);
      const hasExistingSelection = Object.prototype.hasOwnProperty.call(
        state.activeWorkspaceProjectIdByWorkspaceId,
        workspace.id,
      );
      const existingProjectId = hasExistingSelection
        ? state.activeWorkspaceProjectIdByWorkspaceId[workspace.id]
        : undefined;
      const existingWorkspaceProject =
        existingProjectId && workspaceProjectIdSet.has(existingProjectId)
          ? (workspaceProjects.find(
              (workspaceProject) => workspaceProject.id === existingProjectId,
            ) ?? null)
          : null;
      const nextProjectId =
        existingProjectId === null
          ? null
          : existingWorkspaceProject?.kind === "root"
            ? null
            : existingProjectId && workspaceProjectIdSet.has(existingProjectId)
              ? existingProjectId
              : resolveDefaultWorkspaceProjectId({
                  workspaceId: workspace.id,
                  workspaceProjects,
                });
      return [workspace.id, nextProjectId];
    }),
  ) as Record<WorkspaceId, WorkspaceProjectId | null>;
  const preferredChildWorkspaceEntries: Array<[WorkspaceId, WorkspaceId | null]> = [];
  for (const [rootWorkspaceId, childWorkspaceId] of Object.entries(
    state.preferredChildWorkspaceIdByRootId,
  )) {
    if (!availableWorkspaceIds.has(rootWorkspaceId as WorkspaceId)) {
      continue;
    }
    preferredChildWorkspaceEntries.push([
      rootWorkspaceId as WorkspaceId,
      childWorkspaceId && availableWorkspaceIds.has(childWorkspaceId) ? childWorkspaceId : null,
    ]);
  }
  const preferredChildWorkspaceIdByRootId = Object.fromEntries(
    preferredChildWorkspaceEntries,
  ) as Record<WorkspaceId, WorkspaceId | null>;
  const activeWorkspaceDevTargetByWorkspaceId = Object.fromEntries(
    Object.entries(state.activeWorkspaceDevTargetByWorkspaceId).flatMap(
      ([workspaceId, targetKey]) =>
        availableWorkspaceIds.has(workspaceId as WorkspaceId)
          ? [[workspaceId as WorkspaceId, targetKey]]
          : [],
    ),
  ) as Record<WorkspaceId, string | null>;
  const expandedWorkspaceThreadClusterIds = state.expandedWorkspaceThreadClusterIds.filter(
    (clusterId) =>
      Array.from(availableWorkspaceIds).some(
        (workspaceId) => clusterId === workspaceId || clusterId.startsWith(`${workspaceId}:`),
      ),
  );
  const workspaceShellById = Object.fromEntries(
    workspaces.flatMap((workspace) => {
      const existingShellState = state.workspaceShellById[workspace.id];
      const nextShellState = reconcileWorkspacePaneState({
        workspace,
        shellState: existingShellState ?? null,
      });
      if (nextShellState.paneOrder.length === 0 && nextShellState.activePaneId === null) {
        return [];
      }
      return [[workspace.id, nextShellState] as const];
    }),
  ) as Record<WorkspaceId, WorkspacePaneState>;
  return {
    ...state,
    workspaces: workspacesUnchanged ? state.workspaces : workspaces,
    workspaceProjects: workspaceProjectsUnchanged ? state.workspaceProjects : workspaceProjects,
    workspaceShellById,
    workspaceFilesSidebarById,
    recentWorkspaceIds,
    lastActiveWorkspaceId,
    activeWorkspaceProjectIdByWorkspaceId,
    preferredChildWorkspaceIdByRootId,
    activeWorkspaceDevTargetByWorkspaceId,
    expandedWorkspaceThreadClusterIds,
    workspacesHydrated: true,
  };
}

export function upsertWorkspacePaneRecord(
  state: AppState,
  workspaceId: WorkspaceId,
  pane: AppState["workspaces"][number]["panes"][number],
): AppState {
  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) {
      return workspace;
    }
    const existingPaneIndex = workspace.panes.findIndex((entry) => entry.id === pane.id);
    if (existingPaneIndex >= 0) {
      const existingPane = workspace.panes[existingPaneIndex];
      if (existingPane && JSON.stringify(existingPane) === JSON.stringify(pane)) {
        return workspace;
      }
      changed = true;
      return {
        ...workspace,
        panes: workspace.panes.map((entry) => (entry.id === pane.id ? pane : entry)),
      };
    }
    changed = true;
    return {
      ...workspace,
      panes: [...workspace.panes, pane],
    };
  });
  return changed ? { ...state, workspaces } : state;
}

export function upsertWorkspaceBrowserTabRecord(
  state: AppState,
  workspaceId: WorkspaceId,
  browserTab: AppState["workspaces"][number]["browserTabs"][number],
): AppState {
  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) {
      return workspace;
    }
    const existingBrowserTabIndex = workspace.browserTabs.findIndex(
      (entry) => entry.id === browserTab.id,
    );
    if (existingBrowserTabIndex >= 0) {
      const existingBrowserTab = workspace.browserTabs[existingBrowserTabIndex];
      if (existingBrowserTab && JSON.stringify(existingBrowserTab) === JSON.stringify(browserTab)) {
        return workspace;
      }
      changed = true;
      return {
        ...workspace,
        browserTabs: workspace.browserTabs.map((entry) =>
          entry.id === browserTab.id ? browserTab : entry,
        ),
      };
    }
    changed = true;
    return {
      ...workspace,
      browserTabs: [...workspace.browserTabs, browserTab],
    };
  });
  return changed ? { ...state, workspaces } : state;
}

export function removeWorkspacePaneRecord(
  state: AppState,
  workspaceId: WorkspaceId,
  paneId: string,
): AppState {
  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId || !workspace.panes.some((pane) => pane.id === paneId)) {
      return workspace;
    }
    changed = true;
    return {
      ...workspace,
      panes: workspace.panes.filter((pane) => pane.id !== paneId),
    };
  });
  return changed ? { ...state, workspaces } : state;
}

export function removeWorkspaceBrowserTabRecord(
  state: AppState,
  workspaceId: WorkspaceId,
  browserTabId: string,
): AppState {
  const runtimeTabExists = browserTabId in state.browserRuntimeTabsById;
  let workspaceChanged = false;
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) {
      return workspace;
    }
    const browserTabExists = workspace.browserTabs.some((tab) => tab.id === browserTabId);
    const removedPaneIds = workspace.panes
      .filter((pane) => pane.browserTabId === browserTabId)
      .map((pane) => pane.id);
    if (!browserTabExists && removedPaneIds.length === 0) {
      return workspace;
    }
    workspaceChanged = true;
    const panes = workspace.panes.filter((pane) => pane.browserTabId !== browserTabId);
    const paneIdSet = new Set(panes.map((pane) => pane.id));
    const paneOrder = workspace.layout.paneOrder.filter((paneId, index, allPaneIds) => {
      return paneIdSet.has(paneId) && allPaneIds.indexOf(paneId) === index;
    });
    const activePaneId = resolveWorkspacePreferredPaneId({
      paneOrder,
      activePaneId:
        workspace.layout.activePaneId && !removedPaneIds.includes(workspace.layout.activePaneId)
          ? workspace.layout.activePaneId
          : null,
      lastFocusedPaneId:
        workspace.lastFocusedPaneId && !removedPaneIds.includes(workspace.lastFocusedPaneId)
          ? workspace.lastFocusedPaneId
          : null,
    });
    return {
      ...workspace,
      browserTabs: workspace.browserTabs.filter((tab) => tab.id !== browserTabId),
      panes,
      layout: {
        paneOrder,
        activePaneId,
      },
      lastFocusedPaneId:
        workspace.lastFocusedPaneId && !removedPaneIds.includes(workspace.lastFocusedPaneId)
          ? workspace.lastFocusedPaneId
          : activePaneId,
    };
  });

  const existingShellState = state.workspaceShellById[workspaceId];
  const nextShellState = existingShellState
    ? normalizeWorkspacePaneState({
        paneOrder: existingShellState.paneOrder.filter((paneId) => {
          const threadId = parseChatPaneThreadId(paneId);
          if (threadId) {
            return true;
          }
          const workspace = workspaces.find((entry) => entry.id === workspaceId) ?? null;
          return workspace?.panes.some((pane) => pane.id === paneId) ?? false;
        }),
        activePaneId: existingShellState.activePaneId,
        paneTierById: existingShellState.paneTierById,
      })
    : null;
  const browserRuntimeTabsById = runtimeTabExists
    ? { ...state.browserRuntimeTabsById }
    : state.browserRuntimeTabsById;
  if (runtimeTabExists) {
    delete browserRuntimeTabsById[browserTabId];
  }

  const workspaceShellById =
    existingShellState && nextShellState
      ? {
          ...state.workspaceShellById,
          [workspaceId]: nextShellState,
        }
      : state.workspaceShellById;

  if (!workspaceChanged && !runtimeTabExists && workspaceShellById === state.workspaceShellById) {
    return state;
  }

  return {
    ...state,
    workspaces,
    workspaceShellById,
    browserRuntimeTabsById,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(state.threads, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function reorderProjects(
  state: AppState,
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
): AppState {
  if (draggedProjectId === targetProjectId) return state;
  const draggedIndex = state.projects.findIndex((project) => project.id === draggedProjectId);
  const targetIndex = state.projects.findIndex((project) => project.id === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const projects = [...state.projects];
  const [draggedProject] = projects.splice(draggedIndex, 1);
  if (!draggedProject) return state;
  projects.splice(targetIndex, 0, draggedProject);
  return { ...state, projects };
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function openWorkspaceThreadPane(
  state: AppState,
  workspaceId: WorkspaceId,
  threadId: ThreadId,
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId] ?? normalizeWorkspacePaneState({});
  const existing = normalizeWorkspacePaneState(existingRaw);
  const next = upsertWorkspaceThreadPane(existing, threadId);
  if (next === existing) {
    if (existingRaw === existing) {
      return state;
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: existing,
      },
    };
  }
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function focusWorkspacePane(
  state: AppState,
  workspaceId: WorkspaceId,
  paneId: string | null,
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId] ?? normalizeWorkspacePaneState({});
  const existing = normalizeWorkspacePaneState(existingRaw);
  const next = normalizeWorkspacePaneState({
    openThreadIds: existing.openThreadIds,
    paneOrder: existing.paneOrder,
    activePaneId: paneId,
    paneTierById: existing.paneTierById,
  });
  if (
    next.activePaneId === existing.activePaneId &&
    next.paneOrder === existing.paneOrder &&
    next.openThreadIds === existing.openThreadIds
  ) {
    if (existingRaw === existing) {
      return state;
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: existing,
      },
    };
  }
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function closeWorkspacePane(
  state: AppState,
  workspaceId: WorkspaceId,
  paneId: string,
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId];
  if (!existingRaw) {
    return state;
  }
  const existing = normalizeWorkspacePaneState(existingRaw);
  const next = removeWorkspacePane(existing, paneId);
  if (next === existing) {
    if (existingRaw === existing) {
      return state;
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: existing,
      },
    };
  }
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function ensureWorkspacePaneState(
  state: AppState,
  workspaceId: WorkspaceId,
  fallbackThreadIds: readonly ThreadId[],
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId];
  const existing = existingRaw ? normalizeWorkspacePaneState(existingRaw) : null;
  const fallbackThreadId = fallbackThreadIds[0] ?? null;
  const fallbackPaneId = fallbackThreadId ? `chat:${fallbackThreadId}` : null;
  if (!fallbackPaneId) {
    return state;
  }
  if (existing) {
    // Don't force a fallback if any chat pane is already open — the user is
    // viewing something intentionally, even if it's from a different project scope.
    const hasAnyChatPane = existing.paneOrder.some(
      (paneId) => parseChatPaneThreadId(paneId) !== null,
    );
    if (hasAnyChatPane) {
      return state;
    }
    const paneOrder = existing.paneOrder.includes(fallbackPaneId)
      ? existing.paneOrder
      : [...existing.paneOrder, fallbackPaneId];
    const next = normalizeWorkspacePaneState({
      paneOrder,
      activePaneId: fallbackPaneId,
      paneTierById: existing.paneTierById,
    });
    if (
      next.activePaneId === existing.activePaneId &&
      next.paneOrder.length === existing.paneOrder.length &&
      next.paneOrder.every((paneId, index) => paneId === existing.paneOrder[index])
    ) {
      if (existingRaw === existing) {
        return state;
      }
      return {
        ...state,
        workspaceShellById: {
          ...state.workspaceShellById,
          [workspaceId]: existing,
        },
      };
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: next,
      },
    };
  }
  const next = normalizeWorkspacePaneState({
    paneOrder: [fallbackPaneId],
    activePaneId: fallbackPaneId,
  });
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function pruneWorkspacePaneState(
  state: AppState,
  workspaceId: WorkspaceId,
  visibleThreadIds: readonly ThreadId[],
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId];
  if (!existingRaw) {
    return state;
  }
  const existing = normalizeWorkspacePaneState(existingRaw);
  const visibleThreadIdSet = new Set(visibleThreadIds);
  const paneOrder = existing.paneOrder.filter((paneId) => {
    const threadId = parseChatPaneThreadId(paneId);
    return threadId ? visibleThreadIdSet.has(threadId) : true;
  });
  const next = normalizeWorkspacePaneState({
    paneOrder,
    activePaneId: existing.activePaneId,
    paneTierById: existing.paneTierById,
  });
  if (
    next.activePaneId === existing.activePaneId &&
    next.paneOrder.length === existing.paneOrder.length &&
    next.paneOrder.every((paneId, index) => paneId === existing.paneOrder[index])
  ) {
    if (existingRaw === existing) {
      return state;
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: existing,
      },
    };
  }
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function setWorkspacePaneLayoutState(
  state: AppState,
  workspaceId: WorkspaceId,
  paneOrder: readonly string[],
  activePaneId: string | null,
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId] ?? normalizeWorkspacePaneState({});
  const existing = normalizeWorkspacePaneState(existingRaw);
  const next = normalizeWorkspacePaneState({
    paneOrder,
    activePaneId,
    paneTierById: existing.paneTierById,
  });
  if (
    next.activePaneId === existing.activePaneId &&
    next.paneOrder.length === existing.paneOrder.length &&
    next.paneOrder.every((paneId, index) => paneId === existing.paneOrder[index])
  ) {
    if (existingRaw === existing) {
      return state;
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: existing,
      },
    };
  }
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function reorderWorkspacePanes(
  state: AppState,
  workspaceId: WorkspaceId,
  draggedPaneId: string,
  targetPaneId: string,
): AppState {
  const existing = state.workspaceShellById[workspaceId];
  if (!existing) return state;
  const draggedIndex = existing.paneOrder.indexOf(draggedPaneId);
  const targetIndex = existing.paneOrder.indexOf(targetPaneId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const paneOrder = [...existing.paneOrder];
  const [dragged] = paneOrder.splice(draggedIndex, 1);
  if (!dragged) return state;
  paneOrder.splice(targetIndex, 0, dragged);
  return setWorkspacePaneLayoutState(state, workspaceId, paneOrder, existing.activePaneId);
}

export function setPaneTier(
  state: AppState,
  workspaceId: WorkspaceId,
  paneId: string,
  tier: WorkspacePaneTier,
): AppState {
  const existingRaw = state.workspaceShellById[workspaceId];
  if (!existingRaw) {
    return state;
  }
  const existing = normalizeWorkspacePaneState(existingRaw);
  if (!existing.paneOrder.includes(paneId)) {
    return state;
  }
  if (existing.paneTierById[paneId] === tier) {
    if (existingRaw === existing) {
      return state;
    }
    return {
      ...state,
      workspaceShellById: {
        ...state.workspaceShellById,
        [workspaceId]: existing,
      },
    };
  }
  const next = normalizeWorkspacePaneState({
    openThreadIds: existing.openThreadIds,
    paneOrder: existing.paneOrder,
    activePaneId: existing.activePaneId,
    paneTierById: {
      ...existing.paneTierById,
      [paneId]: tier,
    },
  });
  return {
    ...state,
    workspaceShellById: {
      ...state.workspaceShellById,
      [workspaceId]: next,
    },
  };
}

export function setWorkspaceFilesSidebarOpen(
  state: AppState,
  workspaceId: WorkspaceId,
  open: boolean,
): AppState {
  const existing = state.workspaceFilesSidebarById[workspaceId] ?? {
    open: false,
    selectionValue: null,
  };
  if (existing.open === open) {
    return state;
  }
  return {
    ...state,
    workspaceFilesSidebarById: {
      ...state.workspaceFilesSidebarById,
      [workspaceId]: {
        ...existing,
        open,
      },
    },
  };
}

export function setWorkspaceFilesSidebarSelection(
  state: AppState,
  workspaceId: WorkspaceId,
  selectionValue: string | null,
  options?: { open?: boolean },
): AppState {
  const existing = state.workspaceFilesSidebarById[workspaceId] ?? {
    open: false,
    selectionValue: null,
  };
  const nextOpen = options?.open ?? existing.open;
  if (existing.selectionValue === selectionValue && existing.open === nextOpen) {
    return state;
  }
  return {
    ...state,
    workspaceFilesSidebarById: {
      ...state.workspaceFilesSidebarById,
      [workspaceId]: {
        open: nextOpen,
        selectionValue,
      },
    },
  };
}

export function rememberVisitedWorkspace(state: AppState, workspaceId: WorkspaceId): AppState {
  const recentWorkspaceIds = state.recentWorkspaceIds.includes(workspaceId)
    ? state.recentWorkspaceIds.filter((id) => id !== workspaceId)
    : [...state.recentWorkspaceIds];
  recentWorkspaceIds.push(workspaceId);
  if (
    recentWorkspaceIds.length === state.recentWorkspaceIds.length &&
    recentWorkspaceIds.every((id, index) => id === state.recentWorkspaceIds[index]) &&
    state.lastActiveWorkspaceId === workspaceId
  ) {
    return state;
  }
  return {
    ...state,
    recentWorkspaceIds,
    lastActiveWorkspaceId: workspaceId,
  };
}

export function forgetVisitedWorkspace(state: AppState, workspaceId: WorkspaceId): AppState {
  if (!state.recentWorkspaceIds.includes(workspaceId)) {
    return state;
  }
  const recentWorkspaceIds = state.recentWorkspaceIds.filter((id) => id !== workspaceId);
  const lastActiveWorkspaceId =
    state.lastActiveWorkspaceId === workspaceId
      ? (recentWorkspaceIds.at(-1) ?? recentWorkspaceIds[0] ?? null)
      : state.lastActiveWorkspaceId;
  return {
    ...state,
    recentWorkspaceIds,
    lastActiveWorkspaceId,
  };
}

export function setActiveWorkspaceProject(
  state: AppState,
  workspaceId: WorkspaceId,
  workspaceProjectId: WorkspaceProjectId | null,
): AppState {
  if (state.activeWorkspaceProjectIdByWorkspaceId[workspaceId] === workspaceProjectId) {
    return state;
  }
  return {
    ...state,
    activeWorkspaceProjectIdByWorkspaceId: {
      ...state.activeWorkspaceProjectIdByWorkspaceId,
      [workspaceId]: workspaceProjectId,
    },
  };
}

export function setPreferredChildWorkspace(
  state: AppState,
  rootWorkspaceId: WorkspaceId,
  childWorkspaceId: WorkspaceId | null,
): AppState {
  if (state.preferredChildWorkspaceIdByRootId[rootWorkspaceId] === childWorkspaceId) {
    return state;
  }
  return {
    ...state,
    preferredChildWorkspaceIdByRootId: {
      ...state.preferredChildWorkspaceIdByRootId,
      [rootWorkspaceId]: childWorkspaceId,
    },
  };
}

export function setActiveWorkspaceDevTarget(
  state: AppState,
  workspaceId: WorkspaceId,
  targetKey: string | null,
): AppState {
  if (state.activeWorkspaceDevTargetByWorkspaceId[workspaceId] === targetKey) {
    return state;
  }
  return {
    ...state,
    activeWorkspaceDevTargetByWorkspaceId: {
      ...state.activeWorkspaceDevTargetByWorkspaceId,
      [workspaceId]: targetKey,
    },
  };
}

export function setWorkspaceEnvironmentUrl(
  state: AppState,
  input: {
    workspaceId: WorkspaceId;
    workspaceProjectId: WorkspaceProjectId | null;
    environment: WorkspaceBrowserEnvironment;
    url: string | null;
  },
): AppState {
  const targetKey = buildWorkspaceEnvironmentTargetKey({
    workspaceId: input.workspaceId,
    workspaceProjectId: input.workspaceProjectId,
    environment: input.environment,
  });
  const nextUrl = input.url?.trim() ? input.url.trim() : null;
  const currentUrl = state.configuredWorkspaceEnvironmentUrlsByKey[targetKey] ?? null;
  if (currentUrl === nextUrl) {
    return state;
  }
  if (!nextUrl) {
    if (!(targetKey in state.configuredWorkspaceEnvironmentUrlsByKey)) {
      return state;
    }
    const configuredWorkspaceEnvironmentUrlsByKey = {
      ...state.configuredWorkspaceEnvironmentUrlsByKey,
    };
    delete configuredWorkspaceEnvironmentUrlsByKey[targetKey];
    return {
      ...state,
      configuredWorkspaceEnvironmentUrlsByKey,
    };
  }
  return {
    ...state,
    configuredWorkspaceEnvironmentUrlsByKey: {
      ...state.configuredWorkspaceEnvironmentUrlsByKey,
      [targetKey]: nextUrl,
    },
  };
}

export function setWorkspaceThreadClusterExpanded(
  state: AppState,
  clusterId: string,
  expanded: boolean,
): AppState {
  const isExpanded = state.expandedWorkspaceThreadClusterIds.includes(clusterId);
  if (isExpanded === expanded) {
    return state;
  }
  return {
    ...state,
    expandedWorkspaceThreadClusterIds: expanded
      ? [...state.expandedWorkspaceThreadClusterIds, clusterId]
      : state.expandedWorkspaceThreadClusterIds.filter((id) => id !== clusterId),
  };
}

export function applyBrowserRuntimeEvent(state: AppState, event: BrowserEvent): AppState {
  switch (event.type) {
    case "tab-opened":
    case "tab-updated":
      return {
        ...state,
        browserRuntimeTabsById: {
          ...state.browserRuntimeTabsById,
          [event.tab.id]: event.tab,
        },
      };
    case "tab-focused":
      return state;
    case "tab-closed": {
      const ownerWorkspace =
        state.workspaces.find((workspace) =>
          workspace.browserTabs.some((browserTab) => browserTab.id === event.tabId),
        ) ?? null;
      if (ownerWorkspace) {
        return removeWorkspaceBrowserTabRecord(state, ownerWorkspace.id, event.tabId);
      }
      if (!(event.tabId in state.browserRuntimeTabsById)) {
        return state;
      }
      const browserRuntimeTabsById = { ...state.browserRuntimeTabsById };
      delete browserRuntimeTabsById[event.tabId];
      return {
        ...state,
        browserRuntimeTabsById,
      };
    }
  }
}

export function hydrateBrowserRuntimeTabs(
  state: AppState,
  tabs: readonly BrowserTabSnapshot[],
): AppState {
  const browserRuntimeTabsById = Object.fromEntries(tabs.map((tab) => [tab.id, tab]));
  return {
    ...state,
    browserRuntimeTabsById,
  };
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  syncWorkspaceReadModel: (readModel: WorkspaceReadModel) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  reorderProjects: (draggedProjectId: Project["id"], targetProjectId: Project["id"]) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
  openWorkspaceThreadPane: (workspaceId: WorkspaceId, threadId: ThreadId) => void;
  focusWorkspacePane: (workspaceId: WorkspaceId, paneId: string | null) => void;
  closeWorkspacePane: (workspaceId: WorkspaceId, paneId: string) => void;
  setWorkspaceFilesSidebarOpen: (workspaceId: WorkspaceId, open: boolean) => void;
  setWorkspaceFilesSidebarSelection: (
    workspaceId: WorkspaceId,
    selectionValue: string | null,
    options?: { open?: boolean },
  ) => void;
  rememberVisitedWorkspace: (workspaceId: WorkspaceId) => void;
  forgetVisitedWorkspace: (workspaceId: WorkspaceId) => void;
  setActiveWorkspaceProject: (
    workspaceId: WorkspaceId,
    workspaceProjectId: WorkspaceProjectId | null,
  ) => void;
  setPreferredChildWorkspace: (
    rootWorkspaceId: WorkspaceId,
    childWorkspaceId: WorkspaceId | null,
  ) => void;
  setActiveWorkspaceDevTarget: (workspaceId: WorkspaceId, targetKey: string | null) => void;
  setWorkspaceEnvironmentUrl: (input: {
    workspaceId: WorkspaceId;
    workspaceProjectId: WorkspaceProjectId | null;
    environment: WorkspaceBrowserEnvironment;
    url: string | null;
  }) => void;
  setWorkspaceThreadClusterExpanded: (clusterId: string, expanded: boolean) => void;
  ensureWorkspacePaneState: (
    workspaceId: WorkspaceId,
    fallbackThreadIds: readonly ThreadId[],
  ) => void;
  pruneWorkspacePaneState: (
    workspaceId: WorkspaceId,
    visibleThreadIds: readonly ThreadId[],
  ) => void;
  setWorkspacePaneLayoutState: (
    workspaceId: WorkspaceId,
    paneOrder: readonly string[],
    activePaneId: string | null,
  ) => void;
  reorderWorkspacePanes: (
    workspaceId: WorkspaceId,
    draggedPaneId: string,
    targetPaneId: string,
  ) => void;
  setPaneTier: (
    workspaceId: WorkspaceId,
    paneId: string,
    tier: WorkspacePaneTier,
  ) => void;
  upsertWorkspacePaneRecord: (
    workspaceId: WorkspaceId,
    pane: AppState["workspaces"][number]["panes"][number],
  ) => void;
  upsertWorkspaceBrowserTabRecord: (
    workspaceId: WorkspaceId,
    browserTab: AppState["workspaces"][number]["browserTabs"][number],
  ) => void;
  removeWorkspacePaneRecord: (workspaceId: WorkspaceId, paneId: string) => void;
  removeWorkspaceBrowserTabRecord: (workspaceId: WorkspaceId, browserTabId: string) => void;
  applyBrowserRuntimeEvent: (event: BrowserEvent) => void;
  hydrateBrowserRuntimeTabs: (tabs: readonly BrowserTabSnapshot[]) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  syncWorkspaceReadModel: (readModel) => set((state) => syncWorkspaceReadModel(state, readModel)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
  openWorkspaceThreadPane: (workspaceId, threadId) =>
    set((state) => openWorkspaceThreadPane(state, workspaceId, threadId)),
  focusWorkspacePane: (workspaceId, paneId) =>
    set((state) => focusWorkspacePane(state, workspaceId, paneId)),
  closeWorkspacePane: (workspaceId, paneId) =>
    set((state) => closeWorkspacePane(state, workspaceId, paneId)),
  setWorkspaceFilesSidebarOpen: (workspaceId, open) =>
    set((state) => setWorkspaceFilesSidebarOpen(state, workspaceId, open)),
  setWorkspaceFilesSidebarSelection: (workspaceId, selectionValue, options) =>
    set((state) => setWorkspaceFilesSidebarSelection(state, workspaceId, selectionValue, options)),
  rememberVisitedWorkspace: (workspaceId) =>
    set((state) => rememberVisitedWorkspace(state, workspaceId)),
  forgetVisitedWorkspace: (workspaceId) =>
    set((state) => forgetVisitedWorkspace(state, workspaceId)),
  setActiveWorkspaceProject: (workspaceId, workspaceProjectId) =>
    set((state) => setActiveWorkspaceProject(state, workspaceId, workspaceProjectId)),
  setPreferredChildWorkspace: (rootWorkspaceId, childWorkspaceId) =>
    set((state) => setPreferredChildWorkspace(state, rootWorkspaceId, childWorkspaceId)),
  setActiveWorkspaceDevTarget: (workspaceId, targetKey) =>
    set((state) => setActiveWorkspaceDevTarget(state, workspaceId, targetKey)),
  setWorkspaceEnvironmentUrl: (input) => set((state) => setWorkspaceEnvironmentUrl(state, input)),
  setWorkspaceThreadClusterExpanded: (workspaceId, expanded) =>
    set((state) => setWorkspaceThreadClusterExpanded(state, workspaceId, expanded)),
  ensureWorkspacePaneState: (workspaceId, fallbackThreadIds) =>
    set((state) => ensureWorkspacePaneState(state, workspaceId, fallbackThreadIds)),
  pruneWorkspacePaneState: (workspaceId, visibleThreadIds) =>
    set((state) => pruneWorkspacePaneState(state, workspaceId, visibleThreadIds)),
  setWorkspacePaneLayoutState: (workspaceId, paneOrder, activePaneId) =>
    set((state) => setWorkspacePaneLayoutState(state, workspaceId, paneOrder, activePaneId)),
  reorderWorkspacePanes: (workspaceId, draggedPaneId, targetPaneId) =>
    set((state) => reorderWorkspacePanes(state, workspaceId, draggedPaneId, targetPaneId)),
  setPaneTier: (workspaceId, paneId, tier) =>
    set((state) => setPaneTier(state, workspaceId, paneId, tier)),
  upsertWorkspacePaneRecord: (workspaceId, pane) =>
    set((state) => upsertWorkspacePaneRecord(state, workspaceId, pane)),
  upsertWorkspaceBrowserTabRecord: (workspaceId, browserTab) =>
    set((state) => upsertWorkspaceBrowserTabRecord(state, workspaceId, browserTab)),
  removeWorkspacePaneRecord: (workspaceId, paneId) =>
    set((state) => removeWorkspacePaneRecord(state, workspaceId, paneId)),
  removeWorkspaceBrowserTabRecord: (workspaceId, browserTabId) =>
    set((state) => removeWorkspaceBrowserTabRecord(state, workspaceId, browserTabId)),
  applyBrowserRuntimeEvent: (event) => set((state) => applyBrowserRuntimeEvent(state, event)),
  hydrateBrowserRuntimeTabs: (tabs) => set((state) => hydrateBrowserRuntimeTabs(state, tabs)),
}));

// Persist state changes with debouncing to avoid localStorage thrashing
useStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

// Flush pending writes synchronously before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
