import { type ThreadId, type TurnId, type WorkspaceId } from "@t3tools/contracts";
import {
  Fragment,
  Suspense,
  lazy,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";


import { useComposerDraftStore } from "../composerDraftStore";
import { type DiffRouteSearch } from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { removeWorkspaceBrowserTab } from "../workspaceBrowser";
import { openWorkspaceChatPane } from "../workspacePaneActions";
import {
  buildChatPaneId,
  isFilesPaneId,
  listWorkspaceThreadIds,
  normalizeWorkspacePaneState,
  parseBrowserPaneTabId,
  parseChatPaneThreadId,
  parseFilePaneInfo,
  resolveActiveWorkspaceProjectId,
  resolveEffectivePaneTier,
  resolveWorkspacePreferredPaneId,
  resolveWorkspacePaneStateFallback,
  resolveThreadOwnershipLabel,
  sortWorkspaceThreadIdsByRecency,
} from "../workspaceShell";
import { cn } from "../lib/utils";
import BrowserPane from "./BrowserPane";
import ChatView from "./ChatView";
import FileCompositorPane from "./FileCompositorPane";
import PaneResizeHandle from "./PaneResizeHandle";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "./DiffPanelShell";
import { Button } from "./ui/button";
import { Sheet, SheetPopup } from "./ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "./ui/sidebar";
import WorkspaceFamilyBar from "./WorkspaceFamilyBar";
import { resolveWorkspacePaneLayout } from "./workspacePaneLayout";

const DiffPanel = lazy(() => import("./DiffPanel"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "workspace_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;

interface WorkspaceShellProps {
  workspaceId: WorkspaceId;
  isWorkspaceActive?: boolean;
  diffSearch: DiffRouteSearch;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onSelectDiffTurn: (turnId: TurnId) => void;
  onSelectWholeConversationDiff: () => void;
}

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: {
  mode: DiffPanelMode;
  threadId: ThreadId | null;
  diffSearch: DiffRouteSearch;
  onSelectTurn: (turnId: TurnId) => void;
  onSelectWholeConversation: () => void;
}) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel
          mode={props.mode}
          threadId={props.threadId}
          diffSearch={props.diffSearch}
          onSelectTurn={props.onSelectTurn}
          onSelectWholeConversation={props.onSelectWholeConversation}
        />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  threadId: ThreadId | null;
  diffSearch: DiffRouteSearch;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  onSelectTurn: (turnId: TurnId) => void;
  onSelectWholeConversation: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? (
          <LazyDiffPanel
            mode="sidebar"
            threadId={props.threadId}
            diffSearch={props.diffSearch}
            onSelectTurn={props.onSelectTurn}
            onSelectWholeConversation={props.onSelectWholeConversation}
          />
        ) : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function isPersistedWorkspacePane(input: {
  paneId: string;
  persistedPaneIds: Set<string>;
}): boolean {
  return input.persistedPaneIds.has(input.paneId);
}

const ThreadWorkspaceEmptyState = (props: {
  contextLabel: string;
  hasThreads: boolean;
  latestThreadId: ThreadId | null;
  onOpenLatestThread: () => void;
  onCreateThread: () => void;
  createLabel: string;
}) => {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-8">
      <div className="w-full max-w-3xl rounded-2xl border border-border/70 bg-card/60 p-8 shadow-sm backdrop-blur-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              {props.contextLabel}
            </div>
            <div className="mt-3 text-xl font-semibold tracking-tight text-foreground">
              {props.hasThreads ? "Thread workspace ready." : "Start a thread in this context."}
            </div>
            <div className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {props.hasThreads
                ? "Resume the latest thread or open another one from the strip above. Multiple threads can stay open side by side in this context."
                : "This context is set up, but nothing is running in it yet. Start a thread here to give this workspace its own chat, terminal, and task flow."}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {props.latestThreadId ? (
              <Button variant="outline" onClick={props.onOpenLatestThread}>
                Resume latest thread
              </Button>
            ) : null}
            <Button onClick={props.onCreateThread}>{props.createLabel}</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function WorkspaceShell(props: WorkspaceShellProps) {
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();
  const workspace = useStore(
    (store) => store.workspaces.find((entry) => entry.id === props.workspaceId) ?? null,
  );
  const threads = useStore((store) => store.threads);
  const workspaceProjects = useStore((store) => store.workspaceProjects);
  const workspaceShellState = useStore(
    (store) => store.workspaceShellById[props.workspaceId] ?? null,
  );
  const activeWorkspaceProjectIdByWorkspaceId = useStore(
    (store) => store.activeWorkspaceProjectIdByWorkspaceId,
  );
  const browserRuntimeTabsById = useStore((store) => store.browserRuntimeTabsById);
  const ensureWorkspacePaneState = useStore((store) => store.ensureWorkspacePaneState);
  const pruneWorkspacePaneState = useStore((store) => store.pruneWorkspacePaneState);
  const focusWorkspacePane = useStore((store) => store.focusWorkspacePane);
  const closeWorkspacePane = useStore((store) => store.closeWorkspacePane);
  const draftThreadsByThreadId = useComposerDraftStore((store) => store.draftThreadsByThreadId);
  const diffOpen = props.diffSearch.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const paneWidthsRef = useRef<Record<string, number>>({});
  const paneContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  const activeWorkspaceProjectId = useMemo(() => {
    if (!workspace) {
      return null;
    }
    return resolveActiveWorkspaceProjectId({
      workspaceId: workspace.id,
      workspaceProjects,
      activeWorkspaceProjectIdByWorkspaceId,
    });
  }, [activeWorkspaceProjectIdByWorkspaceId, workspace, workspaceProjects]);

  const allWorkspaceThreadIds = useMemo(() => {
    if (!workspace) {
      return [] as ThreadId[];
    }
    return listWorkspaceThreadIds({
      workspace,
      threads,
      draftThreadsByThreadId,
      workspaceProjects,
    });
  }, [draftThreadsByThreadId, threads, workspace, workspaceProjects]);

  const workspaceThreadIds = useMemo(() => {
    if (!workspace) {
      return [] as ThreadId[];
    }
    return sortWorkspaceThreadIdsByRecency({
      threadIds: listWorkspaceThreadIds({
        workspace,
        threads,
        draftThreadsByThreadId,
        workspaceProjects,
        workspaceProjectId: activeWorkspaceProjectId,
      }),
      threads,
      draftThreadsByThreadId,
    });
  }, [activeWorkspaceProjectId, draftThreadsByThreadId, threads, workspace, workspaceProjects]);

  useEffect(() => {
    if (!workspace) {
      return;
    }
    const firstVisibleThreadId = workspaceThreadIds[0];
    if (firstVisibleThreadId) {
      ensureWorkspacePaneState(workspace.id, [firstVisibleThreadId]);
    }
    pruneWorkspacePaneState(workspace.id, allWorkspaceThreadIds);
  }, [
    allWorkspaceThreadIds,
    ensureWorkspacePaneState,
    pruneWorkspacePaneState,
    workspace,
    workspaceThreadIds,
  ]);

  useEffect(() => {
    if (diffOpen) {
      setHasOpenedDiff(true);
      return;
    }
    const timer = setTimeout(() => setHasOpenedDiff(false), 30_000);
    return () => clearTimeout(timer);
  }, [diffOpen]);

  useEffect(() => {
    return () => {
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, []);

  const shellState =
    (workspace ? workspaceShellState : null) ??
    normalizeWorkspacePaneState(
      workspace
        ? resolveWorkspacePaneStateFallback(workspace)
        : {
            paneOrder: workspaceThreadIds.slice(0, 1).map((threadId) => buildChatPaneId(threadId)),
          },
    );
  const workspaceThreadIdSet = useMemo(() => new Set(workspaceThreadIds), [workspaceThreadIds]);
  const paneById = useMemo(
    () => new Map(workspace?.panes.map((pane) => [pane.id, pane] as const) ?? []),
    [workspace],
  );
  const browserTabById = useMemo(
    () => new Map(workspace?.browserTabs.map((tab) => [tab.id, tab] as const) ?? []),
    [workspace],
  );
  const workspacePaneIds = useMemo(() => new Set(paneById.keys()), [paneById]);
  const persistedPaneIds = useMemo(() => {
    const ids = new Set<string>(workspacePaneIds);
    for (const threadId of workspaceThreadIds) {
      ids.add(buildChatPaneId(threadId));
    }
    return ids;
  }, [workspacePaneIds, workspaceThreadIds]);

  // Preserve user-defined pane order from store (supports drag-and-drop reordering).
  const openPaneIds = shellState.paneOrder.filter((paneId) => {
    const tier = resolveEffectivePaneTier(paneId, shellState.paneTierById);

    const threadId = parseChatPaneThreadId(paneId);
    if (threadId) {
      if (!workspaceThreadIdSet.has(threadId)) {
        return false;
      }
      return true;
    }
    // File panes are always visible.
    if (isFilesPaneId(paneId) || parseFilePaneInfo(paneId)) {
      return true;
    }
    const pane = paneById.get(paneId);
    if (!pane || pane.kind !== "browser" || !pane.browserTabId) {
      return false;
    }
    const browserTab = browserTabById.get(pane.browserTabId) ?? null;
    if (!browserTab) {
      return false;
    }
    // Workspace-tier browser panes bypass the project-scoping filter.
    if (tier === "workspace") {
      return true;
    }
    return (browserTab.workspaceProjectId ?? null) === (activeWorkspaceProjectId ?? null);
  });
  const activePaneId =
    resolveWorkspacePreferredPaneId({
      paneOrder: openPaneIds,
      activePaneId: shellState.activePaneId,
      lastFocusedPaneId: workspace?.lastFocusedPaneId ?? null,
    }) ?? null;
  const activePaneThreadId =
    (activePaneId ? parseChatPaneThreadId(activePaneId) : null) ??
    openPaneIds
      .toReversed()
      .map((paneId) => parseChatPaneThreadId(paneId))
      .find((threadId): threadId is ThreadId => Boolean(threadId)) ??
    null;
  const activeContextLabel = useMemo(
    () =>
      resolveThreadOwnershipLabel({
        workspaceProjectId: activeWorkspaceProjectId,
        workspaceProjects,
      }),
    [activeWorkspaceProjectId, workspaceProjects],
  );
  const latestWorkspaceThreadId = workspaceThreadIds[0] ?? null;
  const openPaneCount = openPaneIds.length;
  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;

  const persistWorkspaceLayout = useCallback(
    async (input: {
      paneOrder: string[];
      activePaneId: string | null;
      lastFocusedPaneId?: string | null;
    }) => {
      if (!workspace) {
        return;
      }
      const api = readNativeApi();
      if (!api) {
        return;
      }
      const persistedPaneOrder = input.paneOrder.filter((paneId) => persistedPaneIds.has(paneId));
      const persistedActivePaneId =
        input.activePaneId && persistedPaneOrder.includes(input.activePaneId)
          ? input.activePaneId
          : null;
      const lastFocusedPaneId =
        input.lastFocusedPaneId !== undefined ? input.lastFocusedPaneId : persistedActivePaneId;
      await api.workspace.dispatchCommand({
        type: "workspace.layout.update",
        workspaceId: workspace.id,
        paneOrder: persistedPaneOrder,
        activePaneId: persistedActivePaneId,
        lastFocusedPaneId,
        updatedAt: new Date().toISOString(),
      });
    },
    [persistedPaneIds, workspace],
  );

  const openThread = useCallback(
    async (threadId: ThreadId) => {
      await openWorkspaceChatPane({
        workspaceId: props.workspaceId,
        threadId,
      });
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: props.workspaceId },
      });
    },
    [navigate, props.workspaceId],
  );

  const createContextThread = useCallback(async () => {
    if (!workspace) {
      return;
    }
    await handleNewThread(workspace.projectId, {
      target: {
        workspaceId: workspace.id,
        workspaceProjectId: activeWorkspaceProjectId ?? null,
      },
    });
  }, [activeWorkspaceProjectId, handleNewThread, workspace]);

  const focusPane = useCallback(
    (paneId: string) => {
      focusWorkspacePane(props.workspaceId, paneId);
      if (!isPersistedWorkspacePane({ paneId, persistedPaneIds })) {
        return;
      }
      void persistWorkspaceLayout({
        paneOrder: openPaneIds,
        activePaneId: paneId,
        lastFocusedPaneId: paneId,
      });
    },
    [focusWorkspacePane, openPaneIds, persistWorkspaceLayout, persistedPaneIds, props.workspaceId],
  );

  const closePane = useCallback(
    (paneId: string) => {
      if (!workspace) {
        return;
      }
      const pane = paneById.get(paneId) ?? null;
      closeWorkspacePane(workspace.id, paneId);
      const browserTabId = parseBrowserPaneTabId(paneId);
      if (browserTabId) {
        void removeWorkspaceBrowserTab({
          tabId: browserTabId,
          closeNative: true,
        });
        return;
      }
      if (pane?.kind === "files") {
        const api = readNativeApi();
        if (!api) {
          return;
        }
        useStore.getState().removeWorkspacePaneRecord(workspace.id, paneId);
        void api.workspace
          .dispatchCommand({
            type: "workspace.pane.remove",
            workspaceId: workspace.id,
            paneId,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => undefined);
        return;
      }
      if (!isPersistedWorkspacePane({ paneId, persistedPaneIds })) {
        return;
      }
      const nextPaneOrder = openPaneIds.filter((candidate) => candidate !== paneId);
      const nextActivePaneId =
        activePaneId === paneId ? (nextPaneOrder.at(-1) ?? nextPaneOrder[0] ?? null) : activePaneId;
      void persistWorkspaceLayout({
        paneOrder: nextPaneOrder,
        activePaneId: nextActivePaneId,
        lastFocusedPaneId: nextActivePaneId,
      });
    },
    [
      activePaneId,
      closeWorkspacePane,
      openPaneIds,
      paneById,
      persistWorkspaceLayout,
      persistedPaneIds,
      workspace,
    ],
  );

  const renderPane = useCallback(
    (paneId: string) => {
      const pane = paneById.get(paneId) ?? null;
      const threadId = parseChatPaneThreadId(paneId);
      const browserTabId = pane?.browserTabId ?? parseBrowserPaneTabId(paneId);
      const browserTab = browserTabId
        ? (browserRuntimeTabsById[browserTabId] ?? browserTabById.get(browserTabId) ?? null)
        : null;
      const filePaneInfo = parseFilePaneInfo(paneId);
      const isFilesPane = pane?.kind === "files" || isFilesPaneId(paneId) || filePaneInfo !== null;
      const filesSelection = pane?.kind === "files" ? pane.filePath : null;
      const isActivePane = activePaneId === paneId;
      const thread = threadId ? (threads.find((entry) => entry.id === threadId) ?? null) : null;
      const draftThread = threadId ? (draftThreadsByThreadId[threadId] ?? null) : null;
      const paneTitle =
        browserTab?.title ??
        pane?.title ??
        thread?.title ??
        (draftThread
          ? "New thread"
          : (filePaneInfo?.relativePath.split("/").at(-1) ??
            filesSelection?.split("/").at(-1) ??
            browserTab?.url ??
            "Untitled pane"));
      const paneLayout = resolveWorkspacePaneLayout({
        paneCount: openPaneCount,
        isActive: isActivePane,
        stacked: shouldUseDiffSheet,
      });
      return (
        <section
          key={paneId}
          data-workspace-pane="true"
          data-workspace-pane-active={isActivePane ? "true" : "false"}
          data-workspace-pane-kind={threadId ? "chat" : (pane?.kind ?? "browser")}
          className={cn(
            "group/pane flex min-h-0 self-stretch flex-col overflow-hidden border-r border-border/50",
            shouldUseDiffSheet || openPaneCount <= 1
              ? "min-w-full flex-1"
              : "flex-none",
            isActivePane
              ? "bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]"
              : "bg-muted/[0.12]",
          )}
          style={
            shouldUseDiffSheet || openPaneCount <= 1
              ? undefined
              : {
                  width: `${100 / openPaneCount}%`,
                  minWidth: `${paneLayout.minWidthPx}px`,
                }
          }
          onMouseDownCapture={() => focusPane(paneId)}
          onFocusCapture={() => focusPane(paneId)}
        >
          {threadId ? (
            <ChatView
              key={threadId}
              threadId={threadId}
              diffOpen={diffOpen && isActivePane}
              isActivePane={isActivePane}
              showHeaderTitle
              onCloseThread={() => closePane(paneId)}
              onOpenThread={openThread}
              onOpenTurnDiff={props.onOpenTurnDiff}
              onToggleDiff={() => {
                if (diffOpen && isActivePane) {
                  props.onCloseDiff();
                  return;
                }
                props.onOpenDiff();
              }}
            />
          ) : browserTabId && browserTab ? (
            <BrowserPane
              paneId={paneId}
              tabId={browserTabId}
              title={browserTab.title}
              url={browserTab.url}
              isActive={isActivePane}
              isWorkspaceActive={props.isWorkspaceActive !== false}
            />
          ) : isFilesPane && workspace ? (
            <FileCompositorPane workspaceId={workspace.id} />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              Pane unavailable.
            </div>
          )}
        </section>
      );
    },
    [
      activePaneId,
      browserRuntimeTabsById,
      browserTabById,
      closePane,
      diffOpen,
      draftThreadsByThreadId,
      focusPane,
      openThread,
      paneById,
      props,
      openPaneCount,
      shellState.paneTierById,
      shouldUseDiffSheet,
      threads,
      workspace,
    ],
  );

  if (!workspace) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
          Workspace not found.
        </div>
      </SidebarInset>
    );
  }

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
          <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.92)_0%,rgba(248,250,252,0.72)_100%)] dark:bg-[linear-gradient(180deg,rgba(10,15,23,0.96)_0%,rgba(10,15,23,0.9)_100%)]">
            <WorkspaceFamilyBar workspaceId={props.workspaceId} />
            <div
              ref={paneContainerRef}
              className="relative flex min-h-0 min-w-0 flex-1 gap-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
              data-workspace-pane-count={openPaneIds.length}
            >
              {openPaneIds.length === 0 ? (
                <ThreadWorkspaceEmptyState
                  contextLabel={activeContextLabel}
                  hasThreads={workspaceThreadIds.length > 0}
                  latestThreadId={latestWorkspaceThreadId}
                  onOpenLatestThread={() => {
                    if (!latestWorkspaceThreadId) {
                      return;
                    }
                    void openThread(latestWorkspaceThreadId);
                  }}
                  onCreateThread={() => void createContextThread()}
                  createLabel={activeWorkspaceProjectId ? "Start app thread" : "Start repo thread"}
                />
              ) : (
                openPaneIds.map((paneId, index) => (
                  <Fragment key={paneId}>
                    {index > 0 ? (
                      <PaneResizeHandle
                        onResize={(deltaX) => {
                          const container = paneContainerRef.current;
                          if (!container) return;
                          const defaultWidth = container.clientWidth / openPaneIds.length;
                          const leftPaneId = openPaneIds[index - 1]!;
                          const current = paneWidthsRef.current;
                          current[leftPaneId] = Math.max(200, (current[leftPaneId] ?? defaultWidth) + deltaX);
                          if (!resizeRafRef.current) {
                            resizeRafRef.current = requestAnimationFrame(() => {
                              resizeRafRef.current = null;
                              const allPanes = paneContainerRef.current?.querySelectorAll<HTMLElement>("[data-workspace-pane]");
                              if (!allPanes) return;
                              allPanes.forEach((el, i) => {
                                const id = openPaneIds[i];
                                if (id && current[id] != null) {
                                  el.style.width = `${current[id]}px`;
                                }
                              });
                            });
                          }
                        }}
                      />
                    ) : null}
                    {renderPane(paneId)}
                  </Fragment>
                ))
              )}
            </div>
          </div>
        </SidebarInset>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          threadId={activePaneThreadId}
          diffSearch={props.diffSearch}
          onCloseDiff={props.onCloseDiff}
          onOpenDiff={props.onOpenDiff}
          onSelectTurn={props.onSelectDiffTurn}
          onSelectWholeConversation={props.onSelectWholeConversationDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
        <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(248,250,252,0.92)_0%,rgba(248,250,252,0.72)_100%)] dark:bg-[linear-gradient(180deg,rgba(10,15,23,0.96)_0%,rgba(10,15,23,0.9)_100%)]">
          <WorkspaceFamilyBar workspaceId={props.workspaceId} />
          <div
            className="flex min-h-0 min-w-0 flex-1 gap-0 overflow-x-auto overscroll-x-contain"
            data-workspace-pane-count={openPaneIds.length}
          >
            {openPaneIds.length === 0 ? (
              <ThreadWorkspaceEmptyState
                contextLabel={activeContextLabel}
                hasThreads={workspaceThreadIds.length > 0}
                latestThreadId={latestWorkspaceThreadId}
                onOpenLatestThread={() => {
                  if (!latestWorkspaceThreadId) {
                    return;
                  }
                  void openThread(latestWorkspaceThreadId);
                }}
                onCreateThread={() => void createContextThread()}
                createLabel={activeWorkspaceProjectId ? "Start app thread" : "Start repo thread"}
              />
            ) : (
              openPaneIds.map((paneId, index) => (
                <Fragment key={paneId}>
                  {index > 0 ? (
                    <PaneResizeHandle
                      onResize={(deltaX) => {
                        const container = paneContainerRef.current;
                        if (!container) return;
                        const defaultWidth = container.clientWidth / openPaneIds.length;
                        const leftPaneId = openPaneIds[index - 1]!;
                        const current = paneWidthsRef.current;
                        const leftWidth = current[leftPaneId] ?? defaultWidth;
                        const rightWidth = current[paneId] ?? defaultWidth;
                        current[leftPaneId] = Math.max(200, leftWidth + deltaX);
                        current[paneId] = Math.max(200, rightWidth - deltaX);
                        if (!resizeRafRef.current) {
                          resizeRafRef.current = requestAnimationFrame(() => {
                            resizeRafRef.current = null;
                            const allPanes = paneContainerRef.current?.querySelectorAll<HTMLElement>("[data-workspace-pane]");
                            if (!allPanes) return;
                            allPanes.forEach((el, i) => {
                              const id = openPaneIds[i];
                              if (id && current[id] != null) {
                                el.style.width = `${current[id]}px`;
                              }
                            });
                          });
                        }
                      }}
                    />
                  ) : null}
                  {renderPane(paneId)}
                </Fragment>
              ))
            )}
          </div>
        </div>
      </SidebarInset>
      <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={props.onCloseDiff}>
        {shouldRenderDiffContent ? (
          <LazyDiffPanel
            mode="sheet"
            threadId={activePaneThreadId}
            diffSearch={props.diffSearch}
            onSelectTurn={props.onSelectDiffTurn}
            onSelectWholeConversation={props.onSelectWholeConversationDiff}
          />
        ) : null}
      </DiffPanelSheet>
    </>
  );
}
