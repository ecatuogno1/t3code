import {
  type ProjectId,
  ThreadId,
  type WorkspaceId,
  type WorkspacePaneTier,
  type WorkspaceProjectId,
  type WorkspaceProjectSurface,
  type WorkspaceSurface,
} from "@t3tools/contracts";
import type { DraftThreadState } from "./composerDraftStore";
import type { Thread } from "./types";
import {
  isPrimaryWorkspace,
  normalizeWorkspaceSource,
  resolveProjectDefaultWorkspace,
} from "./workspaceEntities";

export const CHAT_PANE_ID_PREFIX = "chat:";
export const BROWSER_PANE_ID_PREFIX = "browser:";
export const FILES_PANE_ID_PREFIX = "files:";
export const FILE_PANE_ID_PREFIX = "file:";
const MAX_OPEN_CHAT_PANES = 12;
export const MAX_EPHEMERAL_PANES = 6;

export interface WorkspacePaneState {
  openThreadIds: ThreadId[];
  paneOrder: string[];
  activePaneId: string | null;
  paneTierById: Record<string, WorkspacePaneTier>;
}

export interface WorkspaceFamilySelection {
  activeWorkspace: WorkspaceSurface | null;
  rootWorkspace: WorkspaceSurface | null;
  childWorkspaces: WorkspaceSurface[];
  activeChildWorkspace: WorkspaceSurface | null;
  activeWorkspaceContext: WorkspaceSurface | null;
}

export interface WorkspaceThreadCluster {
  id: string;
  workspaceId: WorkspaceId;
  workspaceProjectId: WorkspaceProjectId | null;
  label: string;
  caption: string;
  threadIds: ThreadId[];
  isRoot: boolean;
}

export function buildChatPaneId(threadId: ThreadId): string {
  return `${CHAT_PANE_ID_PREFIX}${threadId}`;
}

export function parseChatPaneThreadId(paneId: string): ThreadId | null {
  if (!paneId.startsWith(CHAT_PANE_ID_PREFIX)) {
    return null;
  }
  const threadId = paneId.slice(CHAT_PANE_ID_PREFIX.length).trim();
  return threadId.length > 0 ? ThreadId.makeUnsafe(threadId) : null;
}

export function buildBrowserPaneId(browserTabId: string): string {
  return `${BROWSER_PANE_ID_PREFIX}${browserTabId}`;
}

export function parseBrowserPaneTabId(paneId: string): string | null {
  if (!paneId.startsWith(BROWSER_PANE_ID_PREFIX)) {
    return null;
  }
  const browserTabId = paneId.slice(BROWSER_PANE_ID_PREFIX.length).trim();
  return browserTabId.length > 0 ? browserTabId : null;
}

export function buildFilesPaneId(workspaceId: WorkspaceId): string {
  return `${FILES_PANE_ID_PREFIX}${workspaceId}`;
}

export function isFilesPaneId(paneId: string): boolean {
  return paneId.startsWith(FILES_PANE_ID_PREFIX);
}

const FILE_PANE_SEPARATOR = "||";

export function buildFilePaneId(workspaceId: WorkspaceId, relativePath: string): string {
  return `${FILE_PANE_ID_PREFIX}${workspaceId}${FILE_PANE_SEPARATOR}${relativePath}`;
}

export function parseFilePaneInfo(
  paneId: string,
): { workspaceId: string; relativePath: string } | null {
  if (!paneId.startsWith(FILE_PANE_ID_PREFIX)) {
    return null;
  }
  // Exclude legacy "files:" prefix panes.
  if (paneId.startsWith(FILES_PANE_ID_PREFIX)) {
    return null;
  }
  const rest = paneId.slice(FILE_PANE_ID_PREFIX.length);
  const separatorIndex = rest.indexOf(FILE_PANE_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }
  const workspaceId = rest.slice(0, separatorIndex);
  const relativePath = rest.slice(separatorIndex + FILE_PANE_SEPARATOR.length);
  return workspaceId.length > 0 && relativePath.length > 0
    ? { workspaceId, relativePath }
    : null;
}

export function resolveDefaultPaneTier(paneId: string): WorkspacePaneTier {
  if (paneId.startsWith(CHAT_PANE_ID_PREFIX)) {
    return "project";
  }
  if (paneId.startsWith(BROWSER_PANE_ID_PREFIX)) {
    return "ephemeral";
  }
  // Check FILE_PANE_ID_PREFIX ("file:") before FILES_PANE_ID_PREFIX ("files:")
  // since "file:" is a prefix of "files:".
  if (paneId.startsWith(FILES_PANE_ID_PREFIX)) {
    return "workspace";
  }
  if (paneId.startsWith(FILE_PANE_ID_PREFIX)) {
    return "ephemeral";
  }
  return "project";
}

export function resolveEffectivePaneTier(
  paneId: string,
  paneTierById: Record<string, WorkspacePaneTier>,
): WorkspacePaneTier {
  return paneTierById[paneId] ?? resolveDefaultPaneTier(paneId);
}

const TIER_SORT_PRIORITY: Record<WorkspacePaneTier, number> = {
  workspace: 0,
  project: 1,
  ephemeral: 2,
};

export function sortPaneIdsByTier(
  paneIds: ReadonlyArray<string>,
  paneTierById: Record<string, WorkspacePaneTier>,
): string[] {
  return [...paneIds].sort((a, b) => {
    const aTier = resolveEffectivePaneTier(a, paneTierById);
    const bTier = resolveEffectivePaneTier(b, paneTierById);
    return TIER_SORT_PRIORITY[aTier] - TIER_SORT_PRIORITY[bTier];
  });
}

export function resolveWorkspacePreferredPaneId(input: {
  paneOrder: ReadonlyArray<string>;
  activePaneId?: string | null;
  lastFocusedPaneId?: string | null;
}): string | null {
  if (input.activePaneId && input.paneOrder.includes(input.activePaneId)) {
    return input.activePaneId;
  }
  if (input.lastFocusedPaneId && input.paneOrder.includes(input.lastFocusedPaneId)) {
    return input.lastFocusedPaneId;
  }
  return input.paneOrder.at(-1) ?? input.paneOrder[0] ?? null;
}

export function reconcileWorkspacePaneState(input: {
  workspace: Pick<WorkspaceSurface, "linkedThreadIds" | "panes" | "layout" | "lastFocusedPaneId">;
  shellState?: WorkspacePaneState | null;
}): WorkspacePaneState {
  const linkedChatPaneIds = input.workspace.linkedThreadIds.map((threadId) =>
    buildChatPaneId(threadId),
  );
  const linkedChatPaneIdSet = new Set(linkedChatPaneIds);
  const persistedPaneIdSet = new Set<string>([
    ...input.workspace.panes.map((pane) => pane.id),
    ...linkedChatPaneIds,
  ]);
  const paneOrder: string[] = [];
  const seenPaneIds = new Set<string>();

  for (const paneId of input.workspace.layout.paneOrder) {
    if (!persistedPaneIdSet.has(paneId) || seenPaneIds.has(paneId)) {
      continue;
    }
    seenPaneIds.add(paneId);
    paneOrder.push(paneId);
  }

  for (const paneId of input.shellState?.paneOrder ?? []) {
    if (seenPaneIds.has(paneId)) {
      continue;
    }
    const threadId = parseChatPaneThreadId(paneId);
    if (!threadId || !linkedChatPaneIdSet.has(paneId)) {
      continue;
    }
    seenPaneIds.add(paneId);
    paneOrder.push(paneId);
  }

  // Build paneTierById: start from shell state, overlay persisted pane tiers.
  const paneTierById: Record<string, WorkspacePaneTier> = {
    ...input.shellState?.paneTierById,
  };
  for (const pane of input.workspace.panes) {
    if (pane.tier) {
      paneTierById[pane.id] = pane.tier;
    }
  }

  const activePaneId =
    input.shellState?.activePaneId &&
    !input.workspace.layout.paneOrder.includes(input.shellState.activePaneId) &&
    linkedChatPaneIdSet.has(input.shellState.activePaneId)
      ? input.shellState.activePaneId
      : input.workspace.layout.activePaneId;

  return normalizeWorkspacePaneState({
    paneOrder,
    activePaneId: resolveWorkspacePreferredPaneId({
      paneOrder,
      activePaneId,
      lastFocusedPaneId: input.workspace.lastFocusedPaneId,
    }),
    paneTierById,
  });
}

export function normalizeWorkspacePaneState(input: {
  openThreadIds?: ReadonlyArray<ThreadId>;
  paneOrder?: ReadonlyArray<string>;
  activePaneId?: string | null;
  paneTierById?: Record<string, WorkspacePaneTier>;
}): WorkspacePaneState {
  const paneTierById: Record<string, WorkspacePaneTier> = { ...input.paneTierById };
  const paneOrder: string[] = [];
  const seenPaneIds = new Set<string>();
  for (const paneId of input.paneOrder ?? []) {
    if (typeof paneId !== "string" || paneId.trim().length === 0 || seenPaneIds.has(paneId)) {
      continue;
    }
    seenPaneIds.add(paneId);
    paneOrder.push(paneId);
  }

  // Chat pane clamping (legacy safety rail).
  const activeChatPaneId =
    input.activePaneId && parseChatPaneThreadId(input.activePaneId) ? input.activePaneId : null;
  const chatPaneIds = paneOrder.filter((paneId) => parseChatPaneThreadId(paneId) !== null);
  const clampedChatPaneIds = new Set<string>();
  if (activeChatPaneId) {
    clampedChatPaneIds.add(activeChatPaneId);
  }
  for (let index = paneOrder.length - 1; index >= 0; index -= 1) {
    const paneId = paneOrder[index] ?? "";
    if (!parseChatPaneThreadId(paneId)) {
      continue;
    }
    clampedChatPaneIds.add(paneId);
    if (clampedChatPaneIds.size >= MAX_OPEN_CHAT_PANES) {
      break;
    }
  }
  let normalizedPaneOrder =
    chatPaneIds.length > MAX_OPEN_CHAT_PANES
      ? paneOrder.filter((paneId) => {
          const threadId = parseChatPaneThreadId(paneId);
          return threadId ? clampedChatPaneIds.has(paneId) : true;
        })
      : paneOrder;

  // Ephemeral tier eviction: evict oldest ephemeral panes when over the cap.
  const ephemeralPaneIds = normalizedPaneOrder.filter(
    (paneId) => resolveEffectivePaneTier(paneId, paneTierById) === "ephemeral",
  );
  if (ephemeralPaneIds.length > MAX_EPHEMERAL_PANES) {
    const keepEphemeralIds = new Set<string>();
    if (input.activePaneId && ephemeralPaneIds.includes(input.activePaneId)) {
      keepEphemeralIds.add(input.activePaneId);
    }
    for (let index = ephemeralPaneIds.length - 1; index >= 0; index -= 1) {
      const paneId = ephemeralPaneIds[index] ?? "";
      keepEphemeralIds.add(paneId);
      if (keepEphemeralIds.size >= MAX_EPHEMERAL_PANES) {
        break;
      }
    }
    const evictedIds = new Set(
      ephemeralPaneIds.filter((paneId) => !keepEphemeralIds.has(paneId)),
    );
    if (evictedIds.size > 0) {
      normalizedPaneOrder = normalizedPaneOrder.filter((paneId) => !evictedIds.has(paneId));
      for (const paneId of evictedIds) {
        delete paneTierById[paneId];
      }
    }
  }

  const openThreadIds: ThreadId[] = [];
  const seenThreadIds = new Set<ThreadId>();
  for (const threadId of input.openThreadIds ?? []) {
    if (seenThreadIds.has(threadId)) {
      continue;
    }
    seenThreadIds.add(threadId);
    openThreadIds.push(threadId);
  }
  for (const paneId of normalizedPaneOrder) {
    const threadId = parseChatPaneThreadId(paneId);
    if (!threadId || seenThreadIds.has(threadId)) {
      continue;
    }
    seenThreadIds.add(threadId);
    openThreadIds.push(threadId);
  }

  const activePaneId =
    input.activePaneId && normalizedPaneOrder.includes(input.activePaneId)
      ? input.activePaneId
      : (normalizedPaneOrder[0] ?? null);

  return {
    openThreadIds,
    paneOrder: normalizedPaneOrder,
    activePaneId,
    paneTierById,
  };
}

export function listWorkspaceThreadStripIds(input: {
  categoryThreadIds: ReadonlyArray<ThreadId>;
  paneOrder?: ReadonlyArray<string>;
}): ThreadId[] {
  const threadIds: ThreadId[] = [];
  const seenThreadIds = new Set<ThreadId>();

  for (const paneId of input.paneOrder ?? []) {
    const threadId = parseChatPaneThreadId(paneId);
    if (!threadId || seenThreadIds.has(threadId)) {
      continue;
    }
    seenThreadIds.add(threadId);
    threadIds.push(threadId);
  }

  for (const threadId of input.categoryThreadIds) {
    if (seenThreadIds.has(threadId)) {
      continue;
    }
    seenThreadIds.add(threadId);
    threadIds.push(threadId);
  }

  return threadIds;
}

export function upsertWorkspaceThreadPane(
  state: WorkspacePaneState,
  threadId: ThreadId,
): WorkspacePaneState {
  const paneId = buildChatPaneId(threadId);
  const openThreadIds = state.openThreadIds.includes(threadId)
    ? state.openThreadIds
    : [...state.openThreadIds, threadId];
  const paneOrder = state.paneOrder.includes(paneId)
    ? state.paneOrder
    : [...state.paneOrder, paneId];
  const paneTierById =
    paneId in state.paneTierById
      ? state.paneTierById
      : { ...state.paneTierById, [paneId]: resolveDefaultPaneTier(paneId) };

  if (
    openThreadIds === state.openThreadIds &&
    paneOrder === state.paneOrder &&
    state.activePaneId === paneId &&
    paneTierById === state.paneTierById
  ) {
    return state;
  }

  return {
    openThreadIds,
    paneOrder,
    activePaneId: paneId,
    paneTierById,
  };
}

export function removeWorkspacePane(state: WorkspacePaneState, paneId: string): WorkspacePaneState {
  if (!state.paneOrder.includes(paneId)) {
    return state;
  }
  const nextPaneOrder = state.paneOrder.filter((candidate) => candidate !== paneId);
  const removedThreadId = parseChatPaneThreadId(paneId);
  const nextOpenThreadIds = removedThreadId
    ? state.openThreadIds.filter((threadId) => threadId !== removedThreadId)
    : state.openThreadIds;
  const nextActivePaneId =
    state.activePaneId === paneId
      ? (nextPaneOrder.at(-1) ?? nextPaneOrder[0] ?? null)
      : state.activePaneId;
  const nextPaneTierById = { ...state.paneTierById };
  delete nextPaneTierById[paneId];

  return {
    openThreadIds: nextOpenThreadIds,
    paneOrder: nextPaneOrder,
    activePaneId: nextActivePaneId,
    paneTierById: nextPaneTierById,
  };
}

export function resolveDefaultWorkspaceId(
  workspaces: ReadonlyArray<WorkspaceSurface>,
): WorkspaceId | null {
  return (
    workspaces.find(
      (workspace) =>
        workspace.deletedAt === null && normalizeWorkspaceSource(workspace.source) === "root",
    )?.id ??
    workspaces.find((workspace) => workspace.deletedAt === null && isPrimaryWorkspace(workspace))
      ?.id ??
    workspaces.find((workspace) => workspace.deletedAt === null)?.id ??
    null
  );
}

export function resolveWorkspaceRootId(input: {
  workspace: WorkspaceSurface;
  workspaces: ReadonlyArray<WorkspaceSurface>;
}): WorkspaceId {
  const canonicalProjectRootWorkspace = resolveProjectDefaultWorkspace(
    input.workspaces,
    input.workspace.projectId,
  );
  if (input.workspace.rootWorkspaceId) {
    if (
      canonicalProjectRootWorkspace &&
      input.workspace.rootWorkspaceId !== canonicalProjectRootWorkspace.id &&
      normalizeWorkspaceSource(input.workspace.source) === "root"
    ) {
      return canonicalProjectRootWorkspace.id;
    }
    return input.workspace.rootWorkspaceId;
  }
  if (input.workspace.parentWorkspaceId) {
    const parentWorkspace =
      input.workspaces.find((workspace) => workspace.id === input.workspace.parentWorkspaceId) ??
      null;
    if (parentWorkspace?.rootWorkspaceId) {
      if (
        canonicalProjectRootWorkspace &&
        parentWorkspace.rootWorkspaceId !== canonicalProjectRootWorkspace.id
      ) {
        return canonicalProjectRootWorkspace.id;
      }
      return parentWorkspace.rootWorkspaceId;
    }
    if (parentWorkspace) {
      return canonicalProjectRootWorkspace?.id ?? parentWorkspace.id;
    }
  }
  const normalizedSource = normalizeWorkspaceSource(input.workspace.source);
  if (normalizedSource === "root") {
    return canonicalProjectRootWorkspace?.id ?? input.workspace.id;
  }
  return canonicalProjectRootWorkspace?.id ?? input.workspace.id;
}

export function listRootWorkspaces(
  workspaces: ReadonlyArray<WorkspaceSurface>,
): WorkspaceSurface[] {
  const rootWorkspaceByProjectId = new Map<ProjectId, WorkspaceSurface>();
  for (const workspace of workspaces) {
    if (workspace.deletedAt !== null || normalizeWorkspaceSource(workspace.source) !== "root") {
      continue;
    }
    const existingWorkspace = rootWorkspaceByProjectId.get(workspace.projectId) ?? null;
    if (
      !existingWorkspace ||
      workspace.id === (`workspace:${workspace.projectId}:project-root` as WorkspaceId) ||
      (existingWorkspace.id !==
        (`workspace:${existingWorkspace.projectId}:project-root` as WorkspaceId) &&
        (workspace.createdAt < existingWorkspace.createdAt ||
          (workspace.createdAt === existingWorkspace.createdAt &&
            workspace.id.localeCompare(existingWorkspace.id) < 0)))
    ) {
      rootWorkspaceByProjectId.set(workspace.projectId, workspace);
    }
  }

  const canonicalRootWorkspaces = [...rootWorkspaceByProjectId.values()];
  const visibleRootWorkspaces = canonicalRootWorkspaces.filter((candidate) => {
    const candidateRoot = normalizeWorkspaceRootPath(candidate.workspaceRoot);
    if (!candidateRoot) {
      return true;
    }
    return !canonicalRootWorkspaces.some((otherWorkspace) => {
      if (otherWorkspace.id === candidate.id) {
        return false;
      }
      const otherRoot = normalizeWorkspaceRootPath(otherWorkspace.workspaceRoot);
      return otherRoot !== null && isNestedWorkspaceRoot(candidateRoot, otherRoot);
    });
  });

  return visibleRootWorkspaces.toSorted((left, right) => {
    const byTitle = left.title.localeCompare(right.title);
    if (byTitle !== 0) {
      return byTitle;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizeWorkspaceRootPath(workspaceRoot: string | null | undefined): string | null {
  const trimmedRoot = workspaceRoot?.trim();
  if (!trimmedRoot) {
    return null;
  }
  return trimmedRoot.replace(/\/+$/, "") || "/";
}

function isNestedWorkspaceRoot(candidateRoot: string, parentRoot: string): boolean {
  if (candidateRoot === parentRoot) {
    return false;
  }
  if (parentRoot === "/") {
    return candidateRoot.startsWith("/");
  }
  return candidateRoot.startsWith(`${parentRoot}/`);
}

export function listChildWorkspaces(input: {
  rootWorkspaceId: WorkspaceId;
  workspaces: ReadonlyArray<WorkspaceSurface>;
}): WorkspaceSurface[] {
  return input.workspaces
    .filter((workspace) => {
      if (workspace.deletedAt !== null) {
        return false;
      }
      const normalizedSource = normalizeWorkspaceSource(workspace.source);
      if (normalizedSource !== "worktree" && normalizedSource !== "pull-request") {
        return false;
      }
      return (
        resolveWorkspaceRootId({ workspace, workspaces: input.workspaces }) ===
        input.rootWorkspaceId
      );
    })
    .toSorted((left, right) => {
      const leftSource = normalizeWorkspaceSource(left.source);
      const rightSource = normalizeWorkspaceSource(right.source);
      if (leftSource !== rightSource) {
        return leftSource === "worktree" ? -1 : 1;
      }
      const byTitle = left.title.localeCompare(right.title);
      if (byTitle !== 0) {
        return byTitle;
      }
      return left.id.localeCompare(right.id);
    });
}

export function resolveWorkspaceFamilySelection(input: {
  workspaceId: WorkspaceId;
  workspaces: ReadonlyArray<WorkspaceSurface>;
}): WorkspaceFamilySelection {
  const activeWorkspace =
    input.workspaces.find((workspace) => workspace.id === input.workspaceId) ?? null;
  if (!activeWorkspace) {
    return {
      activeWorkspace: null,
      rootWorkspace: null,
      childWorkspaces: [],
      activeChildWorkspace: null,
      activeWorkspaceContext: null,
    };
  }
  const rootWorkspaceId = resolveWorkspaceRootId({
    workspace: activeWorkspace,
    workspaces: input.workspaces,
  });
  const rootWorkspace =
    input.workspaces.find((workspace) => workspace.id === rootWorkspaceId) ?? activeWorkspace;
  const childWorkspaces = listChildWorkspaces({
    rootWorkspaceId: rootWorkspace.id,
    workspaces: input.workspaces,
  });
  const normalizedSource = normalizeWorkspaceSource(activeWorkspace.source);
  const activeChildWorkspace =
    normalizedSource === "worktree" || normalizedSource === "pull-request" ? activeWorkspace : null;
  return {
    activeWorkspace,
    rootWorkspace,
    childWorkspaces,
    activeChildWorkspace,
    activeWorkspaceContext: activeWorkspace,
  };
}

export function resolveWorkspacePaneStateFallback(
  workspace: WorkspaceSurface,
): Pick<WorkspacePaneState, "paneOrder" | "activePaneId" | "paneTierById"> {
  const paneTierById: Record<string, WorkspacePaneTier> = {};
  for (const pane of workspace.panes) {
    if (pane.tier) {
      paneTierById[pane.id] = pane.tier;
    }
  }
  return {
    paneOrder: [...workspace.layout.paneOrder],
    activePaneId: workspace.layout.activePaneId,
    paneTierById,
  };
}

export function resolveWorkspaceForThread(
  workspaces: ReadonlyArray<WorkspaceSurface>,
  threadId: ThreadId,
): WorkspaceSurface | null {
  return workspaces.find((workspace) => workspace.linkedThreadIds.includes(threadId)) ?? null;
}

export function resolveWorkspaceForThreadContext(input: {
  workspaces: ReadonlyArray<WorkspaceSurface>;
  projectId: ProjectId;
  worktreePath: string | null;
  pullRequestUrl?: string | null;
}): WorkspaceSurface | null {
  void input.worktreePath;
  void input.pullRequestUrl;
  return resolveProjectDefaultWorkspace(input.workspaces, input.projectId);
}

export function resolveResponsibleWorkspaceThreadId(input: {
  workspace: WorkspaceSurface;
  threads: ReadonlyArray<Pick<Thread, "id" | "workspaceId">>;
  paneState?: Pick<WorkspacePaneState, "paneOrder" | "activePaneId"> | null;
}): ThreadId | null {
  const workspaceThreadIds = new Set(
    input.threads
      .filter((thread) => thread.workspaceId === input.workspace.id)
      .map((thread) => thread.id),
  );

  const activeThreadId = input.paneState?.activePaneId
    ? parseChatPaneThreadId(input.paneState.activePaneId)
    : null;
  if (activeThreadId && workspaceThreadIds.has(activeThreadId)) {
    return activeThreadId;
  }

  const lastFocusedThreadId = input.workspace.lastFocusedPaneId
    ? parseChatPaneThreadId(input.workspace.lastFocusedPaneId)
    : null;
  if (lastFocusedThreadId && workspaceThreadIds.has(lastFocusedThreadId)) {
    return lastFocusedThreadId;
  }

  const orderedPaneIds = input.paneState?.paneOrder ?? input.workspace.layout.paneOrder;
  for (let index = orderedPaneIds.length - 1; index >= 0; index -= 1) {
    const threadId = parseChatPaneThreadId(orderedPaneIds[index] ?? "");
    if (threadId && workspaceThreadIds.has(threadId)) {
      return threadId;
    }
  }

  return input.threads.find((thread) => thread.workspaceId === input.workspace.id)?.id ?? null;
}

export function sortWorkspaceThreadIdsByRecency(input: {
  threadIds: ReadonlyArray<ThreadId>;
  threads: ReadonlyArray<Thread>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
}): ThreadId[] {
  return [...input.threadIds].toSorted((leftId, rightId) => {
    const leftThread = input.threads.find((thread) => thread.id === leftId) ?? null;
    const rightThread = input.threads.find((thread) => thread.id === rightId) ?? null;
    const leftCreatedAt =
      leftThread?.createdAt ?? input.draftThreadsByThreadId[leftId]?.createdAt ?? "";
    const rightCreatedAt =
      rightThread?.createdAt ?? input.draftThreadsByThreadId[rightId]?.createdAt ?? "";
    return rightCreatedAt.localeCompare(leftCreatedAt);
  });
}

function findWorkspaceProjectById(input: {
  workspaceProjectId: WorkspaceProjectId | null | undefined;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
}): WorkspaceProjectSurface | null {
  if (!input.workspaceProjectId) {
    return null;
  }
  return (
    input.workspaceProjects.find(
      (workspaceProject) => workspaceProject.id === input.workspaceProjectId,
    ) ?? null
  );
}

export function normalizeThreadWorkspaceProjectId(input: {
  workspaceProjectId: WorkspaceProjectId | null | undefined;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
}): WorkspaceProjectId | null {
  const workspaceProject = findWorkspaceProjectById(input);
  if (!workspaceProject || workspaceProject.kind === "root") {
    return null;
  }
  return workspaceProject.id;
}

export function resolveThreadOwnershipLabel(input: {
  workspaceProjectId: WorkspaceProjectId | null | undefined;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
}): string {
  const normalizedWorkspaceProjectId = normalizeThreadWorkspaceProjectId(input);
  if (!normalizedWorkspaceProjectId) {
    return "Repo";
  }
  return (
    findWorkspaceProjectById({
      workspaceProjectId: normalizedWorkspaceProjectId,
      workspaceProjects: input.workspaceProjects,
    })?.title ?? "App"
  );
}

export function resolveActiveWorkspaceProjectId(input: {
  workspaceId: WorkspaceId;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
  activeWorkspaceProjectIdByWorkspaceId: Record<WorkspaceId, WorkspaceProjectId | null>;
}): WorkspaceProjectId | null {
  if (
    Object.prototype.hasOwnProperty.call(
      input.activeWorkspaceProjectIdByWorkspaceId,
      input.workspaceId,
    )
  ) {
    return normalizeThreadWorkspaceProjectId({
      workspaceProjectId: input.activeWorkspaceProjectIdByWorkspaceId[input.workspaceId] ?? null,
      workspaceProjects: input.workspaceProjects,
    });
  }
  return resolveDefaultWorkspaceProjectId({
    workspaceId: input.workspaceId,
    workspaceProjects: input.workspaceProjects,
  });
}

export function draftThreadBelongsToWorkspace(input: {
  draftThread: DraftThreadState;
  workspace: WorkspaceSurface;
}): boolean {
  return input.draftThread.workspaceId === input.workspace.id;
}

export function listWorkspaceThreadIds(input: {
  workspace: WorkspaceSurface;
  threads: ReadonlyArray<Thread>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
  workspaceProjectId?: WorkspaceProjectId | null;
}): ThreadId[] {
  const visibleThreadIds: ThreadId[] = [];
  const seenThreadIds = new Set<ThreadId>();
  const normalizedWorkspaceProjectId =
    input.workspaceProjectId === undefined
      ? undefined
      : normalizeThreadWorkspaceProjectId({
          workspaceProjectId: input.workspaceProjectId,
          workspaceProjects: input.workspaceProjects,
        });

  for (const thread of input.threads) {
    if (thread.workspaceId !== input.workspace.id) {
      continue;
    }
    if (
      normalizedWorkspaceProjectId !== undefined &&
      normalizeThreadWorkspaceProjectId({
        workspaceProjectId: thread.workspaceProjectId,
        workspaceProjects: input.workspaceProjects,
      }) !== normalizedWorkspaceProjectId
    ) {
      continue;
    }
    seenThreadIds.add(thread.id);
    visibleThreadIds.push(thread.id);
  }

  for (const threadId of input.workspace.linkedThreadIds) {
    if (seenThreadIds.has(threadId)) {
      continue;
    }
    const linkedThread = input.threads.find((thread) => thread.id === threadId) ?? null;
    if (
      normalizedWorkspaceProjectId !== undefined &&
      linkedThread &&
      normalizeThreadWorkspaceProjectId({
        workspaceProjectId: linkedThread.workspaceProjectId,
        workspaceProjects: input.workspaceProjects,
      }) !== normalizedWorkspaceProjectId
    ) {
      continue;
    }
    seenThreadIds.add(threadId);
    visibleThreadIds.push(threadId);
  }

  for (const [threadId, draftThread] of Object.entries(input.draftThreadsByThreadId) as Array<
    [ThreadId, DraftThreadState]
  >) {
    if (seenThreadIds.has(threadId)) {
      continue;
    }
    if (!draftThreadBelongsToWorkspace({ draftThread, workspace: input.workspace })) {
      continue;
    }
    if (
      normalizedWorkspaceProjectId !== undefined &&
      normalizeThreadWorkspaceProjectId({
        workspaceProjectId: draftThread.workspaceProjectId,
        workspaceProjects: input.workspaceProjects,
      }) !== normalizedWorkspaceProjectId
    ) {
      continue;
    }
    seenThreadIds.add(threadId);
    visibleThreadIds.push(threadId);
  }

  return visibleThreadIds;
}

export function listWorkspaceProjectScopes(input: {
  workspaceId: WorkspaceId;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
}): WorkspaceProjectSurface[] {
  const visibleProjects = input.workspaceProjects
    .filter(
      (workspaceProject) =>
        workspaceProject.workspaceId === input.workspaceId &&
        workspaceProject.deletedAt === null &&
        workspaceProject.kind !== "root",
    )
    .toSorted(
      (left, right) => left.path.localeCompare(right.path) || left.title.localeCompare(right.title),
    );
  const appProjects = visibleProjects.filter((workspaceProject) => workspaceProject.kind === "app");
  return appProjects.length > 0 ? appProjects : visibleProjects;
}

export function resolveDefaultWorkspaceProjectId(input: {
  workspaceId: WorkspaceId;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
}): WorkspaceProjectId | null {
  const visibleProjects = listWorkspaceProjectScopes(input);
  const workspaceProjects = input.workspaceProjects.filter(
    (workspaceProject) =>
      workspaceProject.workspaceId === input.workspaceId && workspaceProject.deletedAt === null,
  );
  return (
    visibleProjects[0]?.id ??
    workspaceProjects.find((workspaceProject) => workspaceProject.kind !== "root")?.id ??
    workspaceProjects.find((workspaceProject) => workspaceProject.kind === "root")?.id ??
    workspaceProjects[0]?.id ??
    null
  );
}

export function listWorkspaceThreadClusters(input: {
  activeWorkspaceId: WorkspaceId;
  workspaces: ReadonlyArray<WorkspaceSurface>;
  threads: ReadonlyArray<Thread>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
}): WorkspaceThreadCluster[] {
  const activeWorkspace =
    input.workspaces.find((workspace) => workspace.id === input.activeWorkspaceId) ?? null;
  if (!activeWorkspace) {
    return [];
  }
  const normalizedSource = normalizeWorkspaceSource(activeWorkspace.source);
  const clusters: WorkspaceThreadCluster[] = [];
  clusters.push({
    id: `${activeWorkspace.id}:workspace`,
    workspaceId: activeWorkspace.id,
    workspaceProjectId: null,
    label: "Global",
    caption:
      normalizedSource === "root"
        ? "Repo"
        : normalizedSource === "worktree"
          ? "Worktree"
          : "Pull request",
    threadIds: sortWorkspaceThreadIdsByRecency({
      threadIds: listWorkspaceThreadIds({
        workspace: activeWorkspace,
        threads: input.threads,
        draftThreadsByThreadId: input.draftThreadsByThreadId,
        workspaceProjects: input.workspaceProjects,
        workspaceProjectId: null,
      }),
      threads: input.threads,
      draftThreadsByThreadId: input.draftThreadsByThreadId,
    }),
    isRoot: normalizedSource === "root",
  });
  for (const workspaceProject of listWorkspaceProjectScopes({
    workspaceId: activeWorkspace.id,
    workspaceProjects: input.workspaceProjects,
  })) {
    clusters.push({
      id: `${activeWorkspace.id}:project:${workspaceProject.id}`,
      workspaceId: activeWorkspace.id,
      workspaceProjectId: workspaceProject.id,
      label: workspaceProject.title,
      caption: "App",
      threadIds: sortWorkspaceThreadIdsByRecency({
        threadIds: listWorkspaceThreadIds({
          workspace: activeWorkspace,
          threads: input.threads,
          draftThreadsByThreadId: input.draftThreadsByThreadId,
          workspaceProjects: input.workspaceProjects,
          workspaceProjectId: workspaceProject.id,
        }),
        threads: input.threads,
        draftThreadsByThreadId: input.draftThreadsByThreadId,
      }),
      isRoot: normalizedSource === "root",
    });
  }
  return clusters;
}
