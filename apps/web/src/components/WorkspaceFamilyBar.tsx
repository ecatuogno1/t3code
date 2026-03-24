import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileIcon,
  GitBranchIcon,
  GlobeIcon,
  Layers3Icon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
  PlusIcon,
  Rows4Icon,
  XIcon,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis, restrictToFirstScrollableAncestor } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  type ThreadId,
  type WorkspaceId,
} from "@t3tools/contracts";

import { useAppSettings } from "../appSettings";
import { cn } from "../lib/utils";
import { useWorkspaceLogo } from "../hooks/useWorkspaceLogo";
import { normalizeBrowserUrlInput } from "../browserUrl";
import { type DraftThreadState, useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useWorkspaceBadgeById } from "../hooks/useWorkspaceBadgeById";
import { readNativeApi } from "../nativeApi";
import { createProjectAtPath } from "../projectEntities";
import { useStore } from "../store";
import { refreshServerReadModels } from "../threadImports";
import type { Thread } from "../types";
import { navigateWorkspaceBrowserTab, openWorkspaceBrowserTab } from "../workspaceBrowser";
import { closeWorkspaceChatPane, openWorkspaceChatPane } from "../workspacePaneActions";
import {
  createWorkspaceProject,
  ensureWorkspaceEntity,
  resolveProjectDefaultWorkspace,
} from "../workspaceEntities";
import {
  buildWorkspaceEnvironmentTargetKey,
  resolveWorkspaceEnvironmentBrowserTargets,
  type WorkspaceBrowserEnvironment,
} from "../workspaceBrowserTargets";
import {
  listRootWorkspaces,
  listWorkspaceThreadClusters,
  normalizeThreadWorkspaceProjectId,
  parseBrowserPaneTabId,
  parseChatPaneThreadId,
  parseFilePaneInfo,
  resolveActiveWorkspaceProjectId,
  resolveEffectivePaneTier,
  resolveWorkspaceFamilySelection,
  resolveWorkspacePreferredPaneId,
} from "../workspaceShell";
import type { WorkspacePaneTier } from "@t3tools/contracts";
import {
  listWorkspaceThreadCategories,
  resolveDefaultWorkspaceThreadCategoryId,
  type WorkspaceThreadCategoryId,
} from "../workspaceThreadCategories";
import {
  workspaceStripAddButtonClassName,
  workspaceStripClassName,
  workspaceStripCountClassName,
  workspaceStripLabelClassName,
  workspaceStripMetaClassName,
  workspaceStripScrollerClassName,
  workspaceStripTabClassName,
} from "./workspaceChrome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "./ui/input-group";

interface WorkspaceFamilyBarProps {
  workspaceId: WorkspaceId;
}

const EMPTY_THREAD_IDS: ThreadId[] = [];
const NEW_BROWSER_TAB_KEY = "browser:new";

function resolveThreadTitle(input: {
  threadId: ThreadId;
  threads: ReadonlyArray<Thread>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
}): string {
  const thread = input.threads.find((entry) => entry.id === input.threadId) ?? null;
  if (thread?.title?.trim()) {
    return thread.title;
  }
  return input.draftThreadsByThreadId[input.threadId] ? "New thread" : input.threadId;
}

function rowBadgeClassName(tone: "urgent" | "active" | "complete"): string {
  switch (tone) {
    case "urgent":
      return "text-amber-600 dark:text-amber-300/90";
    case "active":
      return "text-sky-600 dark:text-sky-300/90";
    case "complete":
      return "text-emerald-600 dark:text-emerald-300/90";
  }
  return "text-muted-foreground";
}

function RepoStripTab(props: {
  workspace: { id: WorkspaceId; title: string; workspaceRoot: string };
  isActive: boolean;
  badge: { count: number; tone: "urgent" | "active" | "complete" } | null;
  onClick: () => void;
}) {
  const { logoUrl } = useWorkspaceLogo(props.workspace.workspaceRoot);
  return (
    <button
      type="button"
      className={workspaceStripTabClassName({ active: props.isActive, dense: true })}
      onClick={props.onClick}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="size-3.5 shrink-0 rounded-sm object-contain"
        />
      ) : (
        <Rows4Icon className="size-3.5" />
      )}
      <span className="truncate">{props.workspace.title}</span>
      <span className={workspaceStripMetaClassName}>Repo</span>
      {props.badge ? (
        <span
          className={`${workspaceStripCountClassName(props.isActive)} font-medium ${rowBadgeClassName(props.badge.tone)}`}
        >
          {props.badge.count}
        </span>
      ) : null}
    </button>
  );
}

function SortableTab(props: { paneId: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.paneId,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn("flex shrink-0 items-center gap-1", isDragging && "z-10 opacity-80")}
      {...attributes}
      {...listeners}
    >
      {props.children}
    </div>
  );
}

function threadTabClassName(input: { active: boolean }): string {
  return workspaceStripTabClassName({
    active: input.active,
    dense: true,
    quiet: true,
  });
}

export default function WorkspaceFamilyBar(props: WorkspaceFamilyBarProps) {
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();
  const { settings } = useAppSettings();
  const projects = useStore((store) => store.projects);
  const workspaces = useStore((store) => store.workspaces);
  const threads = useStore((store) => store.threads);
  const workspaceProjects = useStore((store) => store.workspaceProjects);
  const workspaceShellById = useStore((store) => store.workspaceShellById);
  const activeWorkspaceProjectIdByWorkspaceId = useStore(
    (store) => store.activeWorkspaceProjectIdByWorkspaceId,
  );
  const browserRuntimeTabsById = useStore((store) => store.browserRuntimeTabsById);
  const activeWorkspaceDevTargetByWorkspaceId = useStore(
    (store) => store.activeWorkspaceDevTargetByWorkspaceId,
  );
  const expandedWorkspaceThreadClusterIds = useStore(
    (store) => store.expandedWorkspaceThreadClusterIds,
  );
  const rememberVisitedWorkspace = useStore((store) => store.rememberVisitedWorkspace);
  const setPreferredChildWorkspace = useStore((store) => store.setPreferredChildWorkspace);
  const setActiveWorkspaceDevTarget = useStore((store) => store.setActiveWorkspaceDevTarget);
  const setWorkspaceEnvironmentUrl = useStore((store) => store.setWorkspaceEnvironmentUrl);
  const setWorkspaceThreadClusterExpanded = useStore(
    (store) => store.setWorkspaceThreadClusterExpanded,
  );
  const setActiveWorkspaceProject = useStore((store) => store.setActiveWorkspaceProject);
  const setPaneTier = useStore((store) => store.setPaneTier);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const syncWorkspaceReadModel = useStore((store) => store.syncWorkspaceReadModel);
  const configuredWorkspaceEnvironmentUrlsByKey = useStore(
    (store) => store.configuredWorkspaceEnvironmentUrlsByKey,
  );
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const { workspaceBadgeById } = useWorkspaceBadgeById();
  const categorizationRunByProjectRef = useRef(new Map<string, string>());
  const [selectedThreadCategoryByClusterId, setSelectedThreadCategoryByClusterId] = useState<
    Partial<Record<string, WorkspaceThreadCategoryId>>
  >({});
  const [browserConfigOpenKey, setBrowserConfigOpenKey] = useState<string | null>(null);
  const [browserConfigDraftByKey, setBrowserConfigDraftByKey] = useState<Record<string, string>>(
    {},
  );
  const [topicCreateOpen, setTopicCreateOpen] = useState(false);
  const [topicCreateDraft, setTopicCreateDraft] = useState("");
  const [familyBarCollapsed, setFamilyBarCollapsed] = useState(false);

  const familySelection = useMemo(
    () =>
      resolveWorkspaceFamilySelection({
        workspaceId: props.workspaceId,
        workspaces,
      }),
    [props.workspaceId, workspaces],
  );
  const activeWorkspace = familySelection.activeWorkspace;
  const rootWorkspace = familySelection.rootWorkspace;
  const childWorkspaces = familySelection.childWorkspaces;
  const activeChildWorkspace = familySelection.activeChildWorkspace;
  const rootWorkspaces = useMemo(() => listRootWorkspaces(workspaces), [workspaces]);
  const activeWorkspaceProjectId =
    (activeWorkspace
      ? resolveActiveWorkspaceProjectId({
          workspaceId: activeWorkspace.id,
          workspaceProjects,
          activeWorkspaceProjectIdByWorkspaceId,
        })
      : null) ?? null;
  const threadClusters = useMemo(
    () =>
      listWorkspaceThreadClusters({
        activeWorkspaceId: props.workspaceId,
        workspaces,
        threads,
        draftThreadsByThreadId,
        workspaceProjects,
      }),
    [draftThreadsByThreadId, props.workspaceId, threads, workspaceProjects, workspaces],
  );
  const shellState =
    activeWorkspace && workspaceShellById[activeWorkspace.id]
      ? workspaceShellById[activeWorkspace.id]
      : activeWorkspace
        ? {
            paneOrder: activeWorkspace.layout.paneOrder as string[],
            activePaneId: activeWorkspace.layout.activePaneId,
            paneTierById: {} as Record<string, WorkspacePaneTier>,
          }
        : null;
  const activePaneId = activeWorkspace
    ? resolveWorkspacePreferredPaneId({
        paneOrder: shellState?.paneOrder ?? activeWorkspace.layout.paneOrder,
        activePaneId: shellState?.activePaneId ?? activeWorkspace.layout.activePaneId,
        lastFocusedPaneId: activeWorkspace.lastFocusedPaneId,
      })
    : null;
  const activeThreadId = activePaneId ? parseChatPaneThreadId(activePaneId) : null;
  const activeThread = activeThreadId
    ? (threads.find((thread) => thread.id === activeThreadId) ?? null)
    : null;
  const activeDraftThread = activeThreadId
    ? (draftThreadsByThreadId[activeThreadId] ?? null)
    : null;
  const activeBrowserTabId = activePaneId ? parseBrowserPaneTabId(activePaneId) : null;
  const activeThreadClusterId =
    threadClusters.find((cluster) => expandedWorkspaceThreadClusterIds.includes(cluster.id))?.id ??
    (activeWorkspace
      ? (threadClusters.find(
          (cluster) =>
            cluster.workspaceId === activeWorkspace.id &&
            (cluster.workspaceProjectId ?? null) === (activeWorkspaceProjectId ?? null),
        )?.id ?? null)
      : null) ??
    threadClusters[0]?.id ??
    null;
  const activeThreadCluster =
    threadClusters.find((cluster) => cluster.id === activeThreadClusterId) ?? null;
  const activeContextWorkspaceProjectId =
    activeThreadCluster?.workspaceProjectId ?? activeWorkspaceProjectId ?? null;
  const activeThreadCategories = useMemo(
    () =>
      activeThreadCluster
        ? listWorkspaceThreadCategories({
            threadIds: activeThreadCluster.threadIds,
            threads,
            draftThreadsByThreadId,
            customTopics: activeWorkspace?.customTopics ?? [],
          })
        : [],
    [activeThreadCluster, activeWorkspace?.customTopics, draftThreadsByThreadId, threads],
  );
  const activeThreadCategoryId = activeThreadCluster
    ? selectedThreadCategoryByClusterId[activeThreadCluster.id] &&
      activeThreadCategories.some(
        (category) => category.id === selectedThreadCategoryByClusterId[activeThreadCluster.id],
      )
      ? (selectedThreadCategoryByClusterId[activeThreadCluster.id] ?? "all")
      : resolveDefaultWorkspaceThreadCategoryId(activeThreadCategories)
    : "all";
  const activeThreadCategory =
    activeThreadCategories.find((category) => category.id === activeThreadCategoryId) ??
    activeThreadCategories[0] ??
    null;
  const openThreadStripIds = useMemo(() => {
    const threadIds: ThreadId[] = [];
    const seenThreadIds = new Set<ThreadId>();
    for (const paneId of shellState?.paneOrder ?? []) {
      const threadId = parseChatPaneThreadId(paneId);
      if (!threadId || seenThreadIds.has(threadId)) {
        continue;
      }
      seenThreadIds.add(threadId);
      threadIds.push(threadId);
    }
    return threadIds;
  }, [shellState?.paneOrder]);
  const activeCategoryThreadIds = activeThreadCategory?.threadIds ?? EMPTY_THREAD_IDS;
  // Show only threads belonging to the selected topic — open panes are shown in the Tabs strip.
  const visibleThreadStripIds = activeCategoryThreadIds;

  useEffect(() => {
    if (!activeThreadCluster) {
      return;
    }
    const selectedCategoryId = selectedThreadCategoryByClusterId[activeThreadCluster.id] ?? null;
    if (
      selectedCategoryId &&
      activeThreadCategories.some((category) => category.id === selectedCategoryId)
    ) {
      return;
    }
    const defaultCategoryId = resolveDefaultWorkspaceThreadCategoryId(activeThreadCategories);
    setSelectedThreadCategoryByClusterId((current) =>
      current[activeThreadCluster.id] === defaultCategoryId
        ? current
        : {
            ...current,
            [activeThreadCluster.id]: defaultCategoryId,
          },
    );
  }, [activeThreadCategories, activeThreadCluster, selectedThreadCategoryByClusterId]);

  const activeProjectCategorizationSignature = useMemo(() => {
    if (!activeWorkspace) {
      return null;
    }
    const projectThreads = threads
      .filter((thread) => thread.projectId === activeWorkspace.projectId)
      .toSorted((left, right) => left.id.localeCompare(right.id));
    const lastUpdatedAt = projectThreads.reduce((latest, thread) => {
      const candidate =
        thread.latestTurn?.completedAt ??
        thread.latestTurn?.startedAt ??
        thread.latestTurn?.requestedAt ??
        thread.lastVisitedAt ??
        thread.createdAt;
      return candidate > latest ? candidate : latest;
    }, "");
    return `${settings.threadCategorizationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL}:${projectThreads.length}:${lastUpdatedAt}`;
  }, [activeWorkspace, settings.threadCategorizationModel, threads]);

  useEffect(() => {
    if (!activeWorkspace || !activeProjectCategorizationSignature) {
      return;
    }
    const api = readNativeApi();
    if (!api) {
      return;
    }
    const previousSignature = categorizationRunByProjectRef.current.get(activeWorkspace.projectId);
    if (previousSignature === activeProjectCategorizationSignature) {
      return;
    }
    categorizationRunByProjectRef.current.set(
      activeWorkspace.projectId,
      activeProjectCategorizationSignature,
    );

    let cancelled = false;
    const requestedModel = settings.threadCategorizationModel ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;

    const run = async () => {
      for (;;) {
        if (cancelled) {
          return;
        }
        const result = await api.threadCategorization.categorizeProjectThreads({
          projectId: activeWorkspace.projectId,
          model: requestedModel,
          maxThreads: 24,
        });
        if (cancelled) {
          return;
        }
        if (result.updatedThreadIds.length > 0) {
          await refreshServerReadModels(api, {
            syncServerReadModel,
            syncWorkspaceReadModel,
          });
        }
        if (!result.hasMore || result.processedCount === 0) {
          return;
        }
      }
    };

    void run().catch(() => {
      categorizationRunByProjectRef.current.delete(activeWorkspace.projectId);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectCategorizationSignature,
    activeWorkspace,
    settings.threadCategorizationModel,
    syncServerReadModel,
    syncWorkspaceReadModel,
  ]);

  const configuredEnvironmentUrlsByEnvironment = useMemo<
    Partial<Record<WorkspaceBrowserEnvironment, string | null>>
  >(() => {
    if (!activeWorkspace) {
      return {};
    }
    return {
      "local-dev":
        configuredWorkspaceEnvironmentUrlsByKey[
          buildWorkspaceEnvironmentTargetKey({
            workspaceId: activeWorkspace.id,
            workspaceProjectId: activeContextWorkspaceProjectId,
            environment: "local-dev",
          })
        ] ?? null,
      "remote-dev":
        configuredWorkspaceEnvironmentUrlsByKey[
          buildWorkspaceEnvironmentTargetKey({
            workspaceId: activeWorkspace.id,
            workspaceProjectId: activeContextWorkspaceProjectId,
            environment: "remote-dev",
          })
        ] ?? null,
      production:
        configuredWorkspaceEnvironmentUrlsByKey[
          buildWorkspaceEnvironmentTargetKey({
            workspaceId: activeWorkspace.id,
            workspaceProjectId: activeContextWorkspaceProjectId,
            environment: "production",
          })
        ] ?? null,
    };
  }, [activeContextWorkspaceProjectId, activeWorkspace, configuredWorkspaceEnvironmentUrlsByKey]);

  const devTargets = useMemo(() => {
    if (!activeWorkspace) {
      return [];
    }
    const contextBrowserTabs = activeWorkspace.browserTabs.filter(
      (tab) => (tab.workspaceProjectId ?? null) === activeContextWorkspaceProjectId,
    );
    const environmentTargets = resolveWorkspaceEnvironmentBrowserTargets({
      workspace: activeWorkspace,
      workspaceProjectId: activeContextWorkspaceProjectId,
      configuredUrlsByEnvironment: configuredEnvironmentUrlsByEnvironment,
    });
    const claimedBrowserTabIds = new Set(
      environmentTargets.flatMap((target) => (target.tabId ? [target.tabId] : [])),
    );
    const claimedBrowserUrls = new Set(
      environmentTargets.flatMap((target) => (target.url ? [target.url] : [])),
    );
    const existingBrowserUrls = new Set(contextBrowserTabs.map((tab) => tab.url));
    const selectedThreadWorkspaceProjectId = normalizeThreadWorkspaceProjectId({
      workspaceProjectId:
        activeThread?.workspaceProjectId ?? activeDraftThread?.workspaceProjectId ?? null,
      workspaceProjects,
    });
    const showActiveThreadTargets =
      activeThreadId !== null &&
      selectedThreadWorkspaceProjectId === activeContextWorkspaceProjectId;
    const threadOverlayTargets = showActiveThreadTargets
      ? [
          ...((activeThread?.pullRequestUrl ?? activeDraftThread?.pullRequestUrl)
            ? [
                {
                  key: `thread-pr:${activeThreadId}`,
                  kind: "thread-pr" as const,
                  tabId: null,
                  url: activeThread?.pullRequestUrl ?? activeDraftThread?.pullRequestUrl ?? "",
                  title: "Pull Request",
                },
              ]
            : []),
          ...((activeThread?.previewUrls ?? []).map((url, index) => ({
            key: `thread-preview:${activeThreadId}:${index}`,
            kind: "thread-preview" as const,
            tabId: null,
            url,
            title: "Preview",
          })) ?? []),
        ]
      : [];
    return [
      ...environmentTargets,
      ...contextBrowserTabs
        .map((tab) => ({
          key: `tab:${tab.id}`,
          kind: "tab" as const,
          tabId: tab.id,
          url: tab.url,
          title: tab.title ?? tab.url,
        }))
        .filter((tab) => !claimedBrowserTabIds.has(tab.tabId)),
      ...activeWorkspace.detectedDevServerUrls
        .filter((url) => !existingBrowserUrls.has(url) && !claimedBrowserUrls.has(url))
        .map((url) => ({
          key: `preview:${url}`,
          kind: "preview" as const,
          tabId: null,
          url,
          title: "Preview",
        })),
      ...threadOverlayTargets.filter((target) => !existingBrowserUrls.has(target.url)),
    ];
  }, [
    activeContextWorkspaceProjectId,
    activeDraftThread?.pullRequestUrl,
    activeDraftThread?.workspaceProjectId,
    activeThread?.pullRequestUrl,
    activeThread?.previewUrls,
    activeThread?.workspaceProjectId,
    activeThreadId,
    activeWorkspace,
    configuredEnvironmentUrlsByEnvironment,
    workspaceProjects,
  ]);

  const activeDevTargetKey =
    (activeBrowserTabId
      ? (devTargets.find((target) => target.tabId === activeBrowserTabId)?.key ?? null)
      : null) ??
    (activeWorkspace
      ? activeWorkspaceDevTargetByWorkspaceId[activeWorkspace.id] &&
        devTargets.some(
          (target) => target.key === activeWorkspaceDevTargetByWorkspaceId[activeWorkspace.id],
        )
        ? activeWorkspaceDevTargetByWorkspaceId[activeWorkspace.id]
        : null
      : null);

  const contextTabs = threadClusters;

  const openWorkspace = async (workspaceId: WorkspaceId) => {
    rememberVisitedWorkspace(workspaceId);
    await navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
    });
  };

  const openRootWorkspace = async (rootWorkspaceId: WorkspaceId) => {
    setPreferredChildWorkspace(rootWorkspaceId, null);
    await openWorkspace(rootWorkspaceId);
  };

  const openChildWorkspace = async (
    rootWorkspaceId: WorkspaceId,
    childWorkspaceId: WorkspaceId,
  ) => {
    setPreferredChildWorkspace(rootWorkspaceId, childWorkspaceId);
    await openWorkspace(childWorkspaceId);
  };

  const openThread = async (workspaceId: WorkspaceId, threadId: ThreadId) => {
    const thread = threads.find((entry) => entry.id === threadId) ?? null;
    const draftThread = draftThreadsByThreadId[threadId] ?? null;
    setActiveWorkspaceProject(
      workspaceId,
      normalizeThreadWorkspaceProjectId({
        workspaceProjectId: thread?.workspaceProjectId ?? draftThread?.workspaceProjectId ?? null,
        workspaceProjects,
      }),
    );
    await openWorkspaceChatPane({
      workspaceId,
      threadId,
    });
    await openWorkspace(workspaceId);
  };

  const closeThread = async (workspaceId: WorkspaceId, threadId: ThreadId) => {
    await closeWorkspaceChatPane({
      workspaceId,
      threadId,
    });
  };

  const handleCreateRepo = async () => {
    const api = readNativeApi();
    let rawWorkspaceRoot: string | null = null;
    if (api) {
      try {
        rawWorkspaceRoot = await api.dialogs.pickFolder();
      } catch {
        rawWorkspaceRoot = null;
      }
    }
    if (!rawWorkspaceRoot) {
      rawWorkspaceRoot = window.prompt("Repository path");
    }
    const workspaceRoot = rawWorkspaceRoot?.trim() ?? "";
    if (!workspaceRoot) {
      return;
    }

    const existingProject = projects.find((project) => project.cwd === workspaceRoot) ?? null;
    const projectId = existingProject?.id ?? (await createProjectAtPath(workspaceRoot));
    if (!projectId) {
      return;
    }

    const workspace =
      resolveProjectDefaultWorkspace(useStore.getState().workspaces, projectId) ??
      (await ensureWorkspaceEntity({
        projectId,
        source: "root",
      }));
    if (!workspace) {
      return;
    }
    await openWorkspace(workspace.id);
  };

  const handleCreateBrowserTab = async () => {
    setBrowserConfigOpenKey(NEW_BROWSER_TAB_KEY);
  };

  const setBrowserConfigDraft = (key: string, value: string) => {
    setBrowserConfigDraftByKey((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resolveBrowserConfigDraft = (input: {
    key: string;
    defaultValue?: string | null | undefined;
  }): string => {
    if (Object.prototype.hasOwnProperty.call(browserConfigDraftByKey, input.key)) {
      return browserConfigDraftByKey[input.key] ?? "";
    }
    return input.defaultValue ?? "";
  };

  const submitBrowserConfig = async (input: {
    key: string;
    title: string | null;
    workspaceProjectId?: typeof activeContextWorkspaceProjectId | undefined;
    environment?: WorkspaceBrowserEnvironment | undefined;
    tabId?: string | null | undefined;
  }) => {
    if (!activeWorkspace) {
      return;
    }
    const draftValue = resolveBrowserConfigDraft({
      key: input.key,
    });
    const url = normalizeBrowserUrlInput(draftValue);
    if (!url) {
      return;
    }
    const workspaceProjectId = input.workspaceProjectId ?? activeContextWorkspaceProjectId ?? null;
    if (input.environment) {
      setWorkspaceEnvironmentUrl({
        workspaceId: activeWorkspace.id,
        workspaceProjectId,
        environment: input.environment,
        url,
      });
      if (input.tabId) {
        await navigateWorkspaceBrowserTab({
          tabId: input.tabId,
          url,
        });
      }
      setBrowserConfigOpenKey(null);
      setBrowserConfigDraft(input.key, url);
      return;
    }
    await openWorkspaceBrowserTab({
      workspaceId: activeWorkspace.id,
      workspaceProjectId,
      url,
      title: input.title,
      ...(input.tabId ? { tabId: input.tabId } : {}),
    });
    setBrowserConfigOpenKey(null);
    setBrowserConfigDraft(input.key, url);
    await openWorkspace(activeWorkspace.id);
  };

  const openBrowserTarget = async (
    target: (typeof devTargets)[number] & {
      kind: "environment" | "tab" | "preview" | "thread-pr" | "thread-preview";
    },
  ) => {
    if (!activeWorkspace) {
      return;
    }

    let url = target.url;
    if (!url) {
      return;
    }

    setActiveWorkspaceDevTarget(activeWorkspace.id, target.key);
    await openWorkspaceBrowserTab({
      workspaceId: activeWorkspace.id,
      workspaceProjectId: activeContextWorkspaceProjectId,
      url,
      title: target.title,
      ...(target.tabId ? { tabId: target.tabId } : {}),
    });
    await openWorkspace(activeWorkspace.id);
  };

  const editConfiguredEnvironmentTarget = async (
    target: Extract<(typeof devTargets)[number], { kind: "environment" }>,
  ) => {
    const initialValue = target.url ?? "";
    const nextValue = window.prompt(`${target.title} URL`, initialValue);
    if (nextValue === null) {
      return;
    }
    const url = normalizeBrowserUrlInput(nextValue);
    if (!url || !activeWorkspace) {
      return;
    }
    const workspaceProjectId = activeContextWorkspaceProjectId ?? null;
    setWorkspaceEnvironmentUrl({
      workspaceId: activeWorkspace.id,
      workspaceProjectId,
      environment: target.environment,
      url,
    });
    setBrowserConfigDraft(target.key, url);
    if (target.tabId) {
      await navigateWorkspaceBrowserTab({
        tabId: target.tabId,
        url,
      });
    }
  };

  const renderBrowserConfigPopover = (input: {
    configKey: string;
    title: string;
    placeholder: string;
    submitLabel: string;
    trigger: ReactElement;
    workspaceProjectId?: typeof activeContextWorkspaceProjectId | undefined;
    environment?: WorkspaceBrowserEnvironment | undefined;
    tabId?: string | null | undefined;
    defaultValue?: string | null | undefined;
  }) => {
    const draftValue = resolveBrowserConfigDraft({
      key: input.configKey,
      defaultValue: input.defaultValue,
    });

    return (
      <Popover
        open={browserConfigOpenKey === input.configKey}
        onOpenChange={(open) => {
          setBrowserConfigOpenKey(open ? input.configKey : null);
          if (open) {
            setBrowserConfigDraft(input.configKey, draftValue);
          }
        }}
      >
        <PopoverTrigger render={input.trigger} />
        <PopoverPopup align="start" className="w-80 p-0">
          <div className="space-y-3 p-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">{input.title}</div>
              <div className="text-xs text-muted-foreground">
                Enter a valid `http(s)` URL for this browser target.
              </div>
            </div>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submitBrowserConfig({
                  key: input.configKey,
                  title: input.title === "Browser" ? null : input.title,
                  workspaceProjectId: input.workspaceProjectId,
                  environment: input.environment,
                  ...(input.tabId ? { tabId: input.tabId } : {}),
                });
              }}
            >
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>
                    <GlobeIcon className="size-3.5" />
                  </InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  type="url"
                  value={draftValue}
                  onChange={(event) => setBrowserConfigDraft(input.configKey, event.target.value)}
                  placeholder={input.placeholder}
                  aria-label={`${input.title} URL`}
                  autoFocus
                />
              </InputGroup>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setBrowserConfigOpenKey(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  {input.submitLabel}
                </Button>
              </div>
            </form>
          </div>
        </PopoverPopup>
      </Popover>
    );
  };

  const handleCreateRepoThread = async () => {
    if (!activeWorkspace) {
      return;
    }
    await handleNewThread(activeWorkspace.projectId, {
      target: {
        workspaceId: activeWorkspace.id,
        workspaceProjectId: null,
      },
    });
  };

  const handleCreateAppThread = async () => {
    if (!activeWorkspace) {
      return;
    }
    const workspaceProjectId =
      activeThreadCluster?.workspaceProjectId ??
      activeWorkspaceProjectId ??
      threadClusters.find(
        (cluster) => cluster.workspaceId === activeWorkspace.id && cluster.workspaceProjectId,
      )?.workspaceProjectId ??
      null;
    if (!workspaceProjectId) {
      return;
    }
    setActiveWorkspaceProject(activeWorkspace.id, workspaceProjectId);
    await handleNewThread(activeWorkspace.projectId, {
      target: {
        workspaceId: activeWorkspace.id,
        workspaceProjectId,
      },
    });
  };

  const handleCreateApp = async () => {
    if (!activeWorkspace) {
      return;
    }
    const title = window.prompt("App name");
    if (!title?.trim()) {
      return;
    }
    const defaultPath = `apps/${title.trim().toLowerCase().replace(/\s+/g, "-")}`;
    const path = window.prompt("App path", defaultPath);
    const workspaceProjectId = await createWorkspaceProject({
      workspaceId: activeWorkspace.id,
      title,
      path: path ?? "",
      kind: "app",
    });
    if (workspaceProjectId) {
      setActiveWorkspaceProject(activeWorkspace.id, workspaceProjectId);
    }
  };

  const tabDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleTabDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !activeWorkspace) return;
      useStore.getState().reorderWorkspacePanes(
        activeWorkspace.id,
        active.id as string,
        over.id as string,
      );
      // Persist to backend
      const api = readNativeApi();
      if (!api) return;
      const shell = useStore.getState().workspaceShellById[activeWorkspace.id];
      if (!shell) return;
      void api.workspace.dispatchCommand({
        type: "workspace.layout.update",
        workspaceId: activeWorkspace.id,
        paneOrder: shell.paneOrder,
        activePaneId: shell.activePaneId,
        lastFocusedPaneId: activeWorkspace.lastFocusedPaneId,
        updatedAt: new Date().toISOString(),
      });
    },
    [activeWorkspace],
  );

  if (!activeWorkspace || !rootWorkspace) {
    return null;
  }

  return (
    <div className="border-b border-border/65 bg-background/92 backdrop-blur-sm">
      <div className={workspaceStripClassName()}>
        <span className={workspaceStripLabelClassName}>Repos</span>
        <div className={workspaceStripScrollerClassName}>
          {rootWorkspaces.map((workspace) => (
            <RepoStripTab
              key={workspace.id}
              workspace={workspace}
              isActive={workspace.id === rootWorkspace.id}
              badge={workspaceBadgeById[workspace.id] ?? null}
              onClick={() => void openRootWorkspace(workspace.id)}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Add repo"
          title="Add repo"
          className={workspaceStripAddButtonClassName}
          onClick={() => void handleCreateRepo()}
        >
          <PlusIcon className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={familyBarCollapsed ? "Expand navigation" : "Collapse navigation"}
          title={familyBarCollapsed ? "Expand navigation" : "Collapse navigation"}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-muted/30 hover:text-muted-foreground"
          onClick={() => setFamilyBarCollapsed((v) => !v)}
        >
          {familyBarCollapsed ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronUpIcon className="size-3.5" />
          )}
        </button>
      </div>

      {!familyBarCollapsed ? (
      <>

      {childWorkspaces.length > 0 ? (
        <div className={workspaceStripClassName({ muted: true })}>
          <span className={workspaceStripLabelClassName}>Branches</span>
          <div className={workspaceStripScrollerClassName}>
            <button
              type="button"
              className={workspaceStripTabClassName({
                active: activeWorkspace.id === rootWorkspace.id,
                dense: true,
                quiet: true,
              })}
              onClick={() => void openRootWorkspace(rootWorkspace.id)}
            >
              <Rows4Icon className="size-3.5" />
              <span className="truncate">{rootWorkspace.title}</span>
              <span className={workspaceStripMetaClassName}>Repo</span>
            </button>
            {childWorkspaces.map((workspace) => {
              const normalizedSource = workspace.source === "pull-request" ? "PR" : "Worktree";
              return (
                <button
                  key={workspace.id}
                  type="button"
                  className={workspaceStripTabClassName({
                    active: activeChildWorkspace?.id === workspace.id,
                    dense: true,
                    quiet: true,
                  })}
                  onClick={() => void openChildWorkspace(rootWorkspace.id, workspace.id)}
                >
                  <GitBranchIcon className="size-3.5" />
                  <span className="truncate">{workspace.title}</span>
                  <span className={workspaceStripMetaClassName}>{normalizedSource}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeWorkspace ? (
        <div className={workspaceStripClassName({ muted: true })}>
          <span className={workspaceStripLabelClassName}>Contexts</span>
          <div className={workspaceStripScrollerClassName}>
            {contextTabs.length > 0 ? (
              contextTabs.map((cluster) => {
                const isActive = cluster.id === activeThreadClusterId;
                return (
                  <button
                    key={cluster.id}
                    type="button"
                    className={workspaceStripTabClassName({ active: isActive, dense: true })}
                    onClick={() => {
                      setActiveWorkspaceProject(activeWorkspace.id, cluster.workspaceProjectId);
                      for (const candidate of contextTabs) {
                        setWorkspaceThreadClusterExpanded(
                          candidate.id,
                          candidate.id === cluster.id,
                        );
                      }
                    }}
                  >
                    {cluster.workspaceProjectId ? (
                      <Layers3Icon className="size-3.5 shrink-0" />
                    ) : (
                      <GitBranchIcon className="size-3.5" />
                    )}
                    <span className="truncate">{cluster.label}</span>
                    <span className={workspaceStripMetaClassName}>{cluster.caption}</span>
                    <span className={workspaceStripCountClassName(isActive)}>
                      {cluster.threadIds.length}
                    </span>
                  </button>
                );
              })
            ) : (
              <span className="text-[11px] text-muted-foreground">No app contexts yet.</span>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Add app or worktree"
                  title="Add app or worktree"
                  className={workspaceStripAddButtonClassName}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleCreateApp()}>New app</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {activeWorkspace ? (
        <div className={workspaceStripClassName({ muted: true })}>
          <span className={workspaceStripLabelClassName}>Browser</span>
          <div className={workspaceStripScrollerClassName}>
            {devTargets.length > 0 ? (
              devTargets.map((target) => {
                const isActive =
                  activeDevTargetKey === target.key ||
                  (target.kind === "preview" &&
                    activeBrowserTabId !== null &&
                    activeWorkspace.browserTabs.some(
                      (tab) => tab.id === activeBrowserTabId && tab.url === target.url,
                    ));
                const trigger = (
                  <button
                    key={target.key}
                    type="button"
                    className={workspaceStripTabClassName({
                      active: isActive,
                      dense: true,
                      quiet: true,
                    })}
                    title={
                      target.kind === "environment" && target.configured
                        ? `${target.title} (Alt+click to edit URL)`
                        : target.title
                    }
                    onClick={(event) => {
                      if (target.kind === "environment" && target.configured) {
                        if (event.altKey) {
                          event.preventDefault();
                          void editConfiguredEnvironmentTarget(target);
                          return;
                        }
                      }
                      if (target.kind === "environment" && !target.configured) {
                        return;
                      }
                      void openBrowserTarget(target);
                    }}
                  >
                    {target.kind === "preview" ? (
                      <PanelsTopLeftIcon className="size-3.5" />
                    ) : (
                      <GlobeIcon className="size-3.5" />
                    )}
                    <span className="truncate">{target.title}</span>
                    {target.kind === "environment" && !target.configured ? (
                      <span className={workspaceStripMetaClassName}>Set URL</span>
                    ) : null}
                  </button>
                );

                if (target.kind === "environment" && !target.configured) {
                  const placeholder =
                    target.environment === "local-dev"
                      ? "http://localhost:3000"
                      : target.environment === "remote-dev"
                        ? "https://dev.example.com"
                        : "https://app.example.com";
                  return (
                    <div key={target.key} className="shrink-0">
                      {renderBrowserConfigPopover({
                        configKey: target.key,
                        title: target.title,
                        placeholder,
                        submitLabel: "Save URL",
                        trigger,
                        workspaceProjectId: activeContextWorkspaceProjectId,
                        environment: target.environment,
                        tabId: target.tabId,
                        defaultValue: target.url,
                      })}
                    </div>
                  );
                }

                return (
                  <div key={target.key} className="shrink-0">
                    {trigger}
                  </div>
                );
              })
            ) : (
              <span className="text-[11px] text-muted-foreground">No browser tabs yet.</span>
            )}
          </div>
          {renderBrowserConfigPopover({
            configKey: NEW_BROWSER_TAB_KEY,
            title: "Browser",
            placeholder: "https://example.com",
            submitLabel: "Open tab",
            trigger: (
              <button
                type="button"
                aria-label="Add browser tab"
                title="Add browser tab"
                className={workspaceStripAddButtonClassName}
                onClick={() => void handleCreateBrowserTab()}
              >
                <PlusIcon className="size-3.5" />
              </button>
            ),
            workspaceProjectId: activeContextWorkspaceProjectId,
          })}
        </div>
      ) : null}

      {activeWorkspace ? (
        <div className={workspaceStripClassName({ muted: true })}>
          <span className={workspaceStripLabelClassName}>Topics</span>
          <div className={workspaceStripScrollerClassName}>
            {activeThreadCategories.length > 0 ? (
              activeThreadCategories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={workspaceStripTabClassName({
                    active: category.id === activeThreadCategoryId,
                    dense: true,
                    quiet: true,
                  })}
                  onClick={() => {
                    if (!activeThreadCluster) {
                      return;
                    }
                    setSelectedThreadCategoryByClusterId((current) => ({
                      ...current,
                      [activeThreadCluster.id]: category.id,
                    }));
                  }}
                >
                  <span className="truncate">{category.label}</span>
                  <span
                    className={workspaceStripCountClassName(category.id === activeThreadCategoryId)}
                  >
                    {category.threadIds.length}
                  </span>
                </button>
              ))
            ) : (
              <span className="text-[11px] text-muted-foreground">No thread categories yet.</span>
            )}
          </div>
          <Popover open={topicCreateOpen} onOpenChange={setTopicCreateOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Add topic"
                  title="Add topic"
                  className={workspaceStripAddButtonClassName}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              }
            />
            <PopoverPopup align="end" className="w-64 p-3">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const label = topicCreateDraft.trim();
                  if (!label || !activeWorkspace) {
                    return;
                  }
                  const api = readNativeApi();
                  if (!api) {
                    return;
                  }
                  void api.workspace
                    .dispatchCommand({
                      type: "workspace.topic.upsert",
                      workspaceId: activeWorkspace.id,
                      label,
                      updatedAt: new Date().toISOString(),
                    })
                    .then(() =>
                      refreshServerReadModels(api, {
                        syncServerReadModel,
                        syncWorkspaceReadModel,
                      }),
                    );
                  setTopicCreateDraft("");
                  setTopicCreateOpen(false);
                }}
              >
                <InputGroup>
                  <InputGroupInput
                    placeholder="Topic name"
                    value={topicCreateDraft}
                    onChange={(event) => setTopicCreateDraft(event.target.value)}
                    autoFocus
                  />
                  <InputGroupAddon>
                    <Button type="submit" size="sm" variant="ghost" disabled={!topicCreateDraft.trim()}>
                      Create
                    </Button>
                  </InputGroupAddon>
                </InputGroup>
              </form>
            </PopoverPopup>
          </Popover>
        </div>
      ) : null}

      {activeWorkspace ? (
        <div className={workspaceStripClassName({ muted: true })}>
          <span className={workspaceStripLabelClassName}>Threads</span>
          {(() => {
            if (!activeThreadCluster) {
              return <div className="min-w-0 flex-1" />;
            }
            return (
              <div className={workspaceStripScrollerClassName}>
                {visibleThreadStripIds.length > 0 ? (
                  visibleThreadStripIds.map((threadId) => {
                    const threadPaneId = `chat:${threadId}`;
                    const isActive =
                      activeThreadCluster.workspaceId === activeWorkspace.id &&
                      parseChatPaneThreadId(activePaneId ?? "") === threadId;
                    const isOpen = shellState?.paneOrder.includes(threadPaneId) ?? false;
                    const isInActiveCategory = activeCategoryThreadIds.includes(threadId);
                    const paneTier: WorkspacePaneTier | null =
                      isOpen && shellState
                        ? resolveEffectivePaneTier(threadPaneId, shellState.paneTierById)
                        : null;
                    const tierIcon =
                      paneTier === "workspace" ? (
                        <Layers3Icon className="size-3 text-muted-foreground/60" />
                      ) : paneTier === "ephemeral" ? (
                        <span className="inline-block size-1.5 rounded-full bg-muted-foreground/40" />
                      ) : null;
                    return (
                      <div key={threadId} className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className={threadTabClassName({ active: isActive })}
                          onClick={() => void openThread(activeThreadCluster.workspaceId, threadId)}
                        >
                          {tierIcon}
                          <span className="max-w-[16rem] truncate">
                            {resolveThreadTitle({
                              threadId,
                              threads,
                              draftThreadsByThreadId,
                            })}
                          </span>
                          {isOpen ? (
                            <span className={workspaceStripMetaClassName}>
                              {isActive ? "Active" : isInActiveCategory ? "Open" : "Open window"}
                            </span>
                          ) : !isInActiveCategory ? (
                            <span className={workspaceStripMetaClassName}>Related</span>
                          ) : null}
                        </button>
                        {isOpen ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <button
                                  type="button"
                                  aria-label="Pane options"
                                  title="Pane options"
                                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                                >
                                  <XIcon className="size-3.5" />
                                </button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setPaneTier(
                                    activeThreadCluster.workspaceId,
                                    threadPaneId,
                                    "workspace",
                                  );
                                }}
                              >
                                <Layers3Icon className="size-3.5" />
                                Pin to workspace
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setPaneTier(
                                    activeThreadCluster.workspaceId,
                                    threadPaneId,
                                    "project",
                                  );
                                }}
                              >
                                <PanelsTopLeftIcon className="size-3.5" />
                                Scope to project
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setPaneTier(
                                    activeThreadCluster.workspaceId,
                                    threadPaneId,
                                    "ephemeral",
                                  );
                                }}
                              >
                                <span className="inline-block size-1.5 rounded-full bg-muted-foreground/60" />
                                Make ephemeral
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  void closeThread(activeThreadCluster.workspaceId, threadId)
                                }
                              >
                                <XIcon className="size-3.5" />
                                Close
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">
                    {activeThreadCategory
                      ? `No ${activeThreadCategory.label.toLowerCase()} threads or open windows in this context.`
                      : "No threads yet for this context."}
                  </div>
                )}
              </div>
            );
          })()}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Add thread"
                  title="Add thread"
                  className={workspaceStripAddButtonClassName}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleCreateRepoThread()}>
                New repo thread
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCreateAppThread()}>
                New app thread
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      </>
      ) : null}

      {activeWorkspace && shellState && shellState.paneOrder.length > 0 ? (
        <div className={workspaceStripClassName({ muted: true })}>
          <span className={workspaceStripLabelClassName}>Tabs</span>
          <DndContext
            sensors={tabDndSensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis, restrictToFirstScrollableAncestor]}
            onDragEnd={handleTabDragEnd}
          >
            <SortableContext
              items={shellState.paneOrder}
              strategy={horizontalListSortingStrategy}
            >
              <div className={workspaceStripScrollerClassName}>
                {shellState.paneOrder.map((paneId) => {
                  const threadId = parseChatPaneThreadId(paneId);
                  const browserTabId = parseBrowserPaneTabId(paneId);
                  const filePaneInfo = parseFilePaneInfo(paneId);
                  const isActive = activePaneId === paneId;

                  let tabTitle: string;
                  let tabIcon: React.ReactNode;
                  if (threadId) {
                    const thread = threads.find((entry) => entry.id === threadId) ?? null;
                    const draftThread = draftThreadsByThreadId[threadId] ?? null;
                    tabTitle = thread?.title?.trim() || (draftThread ? "New thread" : threadId);
                    tabIcon = <MessageSquareIcon className="size-3.5" />;
                  } else if (browserTabId) {
                    const tab =
                      browserRuntimeTabsById[browserTabId] ??
                      activeWorkspace.browserTabs.find((t) => t.id === browserTabId) ??
                      null;
                    tabTitle = tab?.title ?? tab?.url ?? "Browser";
                    tabIcon = <GlobeIcon className="size-3.5" />;
                  } else if (filePaneInfo) {
                    tabTitle =
                      filePaneInfo.relativePath.split("/").at(-1) ?? filePaneInfo.relativePath;
                    tabIcon = <FileIcon className="size-3.5" />;
                  } else {
                    tabTitle = "Pane";
                    tabIcon = <Rows4Icon className="size-3.5" />;
                  }

                  const paneTier = resolveEffectivePaneTier(paneId, shellState.paneTierById);
                  const tierIcon =
                    paneTier === "workspace" ? (
                      <Layers3Icon className="size-2.5 text-muted-foreground/60" />
                    ) : paneTier === "ephemeral" ? (
                      <span className="inline-block size-1.5 rounded-full bg-muted-foreground/40" />
                    ) : null;

                  return (
                    <SortableTab key={paneId} paneId={paneId}>
                      <button
                        type="button"
                        className={workspaceStripTabClassName({
                          active: isActive,
                          dense: true,
                          quiet: true,
                        })}
                        onClick={() => {
                          useStore.getState().focusWorkspacePane(activeWorkspace.id, paneId);
                        }}
                      >
                        {tierIcon}
                        {tabIcon}
                        <span className="max-w-[16rem] truncate">{tabTitle}</span>
                        {isActive ? (
                          <span className={workspaceStripMetaClassName}>Active</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        aria-label="Close tab"
                        title="Close tab"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                        onClick={() => {
                          useStore.getState().closeWorkspacePane(activeWorkspace.id, paneId);
                        }}
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </SortableTab>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}
    </div>
  );
}
