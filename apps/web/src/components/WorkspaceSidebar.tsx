import {
  ArrowDownIcon,
  FileSearchIcon,
  GitCommitHorizontalIcon,
  LoaderCircleIcon,
  MessageSquareQuoteIcon,
  MoreHorizontalIcon,
  PanelsTopLeftIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  type ProjectId,
  type ThreadId,
  type WorkspaceId,
  type WorkspaceProjectId,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";

import { gitStatusQueryOptions } from "../lib/gitReactQuery";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { refreshImportedThreadState, scanThreadImports } from "../threadImports";
import { useWorkspaceBadgeById } from "../hooks/useWorkspaceBadgeById";
import { deriveWorkspaceActivitySummary } from "../workspaceActivity";
import { openWorkspaceBrowserTab } from "../workspaceBrowser";
import {
  archiveWorkspace,
  createManualWorkspace,
  isSavedViewWorkspace,
  renameWorkspace,
} from "../workspaceEntities";
import {
  ensureWorkspaceFilesPane,
  openWorkspaceFileTarget,
  resolveWorkspacePreviewCwd,
} from "../workspaceFiles";
import { openWorkspaceChatPane } from "../workspacePaneActions";
import { applyWorkspacePreset, WORKSPACE_PRESETS } from "../workspacePresets";
import { resolveDefaultWorkspaceId, resolveResponsibleWorkspaceThreadId } from "../workspaceShell";
import FilesPane from "./FilesPane";
import GitActionsControl from "./GitActionsControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "./ui/sidebar";
import { ImportThreadsDialog } from "./ImportThreadsDialog";

function activityIcon(
  kind: ReturnType<typeof deriveWorkspaceActivitySummary>["items"][number]["kind"],
) {
  switch (kind) {
    case "pending-approval":
      return <SparklesIcon className="size-3.5 shrink-0 text-amber-500" />;
    case "awaiting-input":
      return <MessageSquareQuoteIcon className="size-3.5 shrink-0 text-indigo-500" />;
    case "running":
    case "browser-loading":
      return <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-sky-500" />;
    case "terminal-busy":
      return <TerminalSquareIcon className="size-3.5 shrink-0 text-sky-500" />;
    case "git-attention":
      return <GitCommitHorizontalIcon className="size-3.5 shrink-0 text-amber-500" />;
    case "plan-ready":
      return <SparklesIcon className="size-3.5 shrink-0 text-violet-500" />;
    case "completed":
      return <PanelsTopLeftIcon className="size-3.5 shrink-0 text-emerald-500" />;
    case "preview-available":
      return <PanelsTopLeftIcon className="size-3.5 shrink-0 text-sky-500" />;
  }
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

import type { ActivityPanelId } from "./ActivityBar";
import SearchPanel from "./panels/SearchPanel";

export default function WorkspaceSidebar(props: {
  panelId?: ActivityPanelId | null;
}) {
  const panelId = props.panelId ?? null;
  const navigate = useNavigate();
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const routeWorkspaceId = useParams({
    strict: false,
    select: (params) => params.workspaceId ?? null,
  });

  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const workspaces = useStore((store) => store.workspaces);
  const workspaceProjects = useStore((store) => store.workspaceProjects);
  const workspaceShellById = useStore((store) => store.workspaceShellById);
  const workspaceFilesSidebarById = useStore((store) => store.workspaceFilesSidebarById);
  const browserRuntimeTabsById = useStore((store) => store.browserRuntimeTabsById);
  const rememberVisitedWorkspace = useStore((store) => store.rememberVisitedWorkspace);
  const forgetVisitedWorkspace = useStore((store) => store.forgetVisitedWorkspace);
  const setWorkspaceFilesSidebarOpen = useStore((store) => store.setWorkspaceFilesSidebarOpen);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const syncWorkspaceReadModel = useStore((store) => store.syncWorkspaceReadModel);
  const { workspaceBadgeById, runningTerminalIdsByThreadId } = useWorkspaceBadgeById();
  const setTerminalOpen = useTerminalStateStore((store) => store.setTerminalOpen);
  const autoImportedRootsRef = useRef(new Set<string>());
  const autoImportInFlightRootsRef = useRef(new Set<string>());
  const api = readNativeApi();

  const currentWorkspace =
    (routeWorkspaceId ? workspaces.find((workspace) => workspace.id === routeWorkspaceId) : null) ??
    (resolveDefaultWorkspaceId(workspaces)
      ? workspaces.find((workspace) => workspace.id === resolveDefaultWorkspaceId(workspaces))
      : null);

  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentWorkspaceFilesSidebarState = currentWorkspaceId
    ? (workspaceFilesSidebarById[currentWorkspaceId] ?? null)
    : null;
  const currentWorkspaceShellState = currentWorkspaceId
    ? (workspaceShellById[currentWorkspaceId] ?? null)
    : null;
  const currentProject = currentWorkspace
    ? (projects.find((project) => project.id === currentWorkspace.projectId) ?? null)
    : null;
  const currentProjectWorkspaces = useMemo(
    () =>
      currentProject
        ? workspaces.filter(
            (workspace) =>
              workspace.projectId === currentProject.id && workspace.deletedAt === null,
          )
        : [],
    [currentProject, workspaces],
  );
  const currentProjectSavedViews = useMemo(
    () =>
      currentProjectWorkspaces
        .filter((workspace) => isSavedViewWorkspace(workspace))
        .toSorted((left, right) => left.title.localeCompare(right.title)),
    [currentProjectWorkspaces],
  );

  const currentResponsibleThreadId =
    currentWorkspace && currentWorkspaceId
      ? resolveResponsibleWorkspaceThreadId({
          workspace: currentWorkspace,
          threads,
          paneState: currentWorkspaceShellState,
        })
      : null;
  const currentImportWorkspaceRoot = currentWorkspace
    ? resolveWorkspacePreviewCwd(currentWorkspace)
    : null;

  const gitCwd = currentWorkspace ? resolveWorkspacePreviewCwd(currentWorkspace) : null;
  const gitStatusQuery = useQuery(gitStatusQueryOptions(gitCwd));

  const currentWorkspaceActivity = useMemo(() => {
    if (!currentWorkspace) {
      return { items: [] };
    }
    return deriveWorkspaceActivitySummary({
      workspace: currentWorkspace,
      threads,
      workspaceProjects,
      runningTerminalIdsByThreadId,
      browserRuntimeTabsById,
      gitStatus: gitStatusQuery.data ?? null,
    });
  }, [
    browserRuntimeTabsById,
    currentWorkspace,
    gitStatusQuery.data,
    runningTerminalIdsByThreadId,
    threads,
    workspaceProjects,
  ]);

  const visibleActivityItems = useMemo(
    () => currentWorkspaceActivity.items.filter((item) => item.kind !== "git-attention"),
    [currentWorkspaceActivity.items],
  );

  const gitChangedFiles = gitStatusQuery.data?.workingTree.files ?? [];
  const gitAttentionSummary = useMemo(() => {
    if (!gitStatusQuery.data) {
      return gitStatusQuery.isFetching ? "Refreshing git status..." : "Git status unavailable";
    }
    const parts: string[] = [];
    if (gitStatusQuery.data.hasWorkingTreeChanges) {
      parts.push(`${gitChangedFiles.length} changed`);
    }
    if (gitStatusQuery.data.aheadCount > 0) {
      parts.push(`ahead ${gitStatusQuery.data.aheadCount}`);
    }
    if (gitStatusQuery.data.behindCount > 0) {
      parts.push(`behind ${gitStatusQuery.data.behindCount}`);
    }
    if (gitStatusQuery.data.pr?.state === "open") {
      parts.push("PR open");
    }
    return parts.length > 0 ? parts.join(" • ") : "Working tree clean";
  }, [gitChangedFiles.length, gitStatusQuery.data, gitStatusQuery.isFetching]);

  const openWorkspace = async (workspaceId: WorkspaceId) => {
    rememberVisitedWorkspace(workspaceId);
    await navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
    });
  };

  const openThreadInWorkspace = async (workspaceId: WorkspaceId, threadId: ThreadId) => {
    await openWorkspaceChatPane({
      workspaceId,
      threadId,
    });
    await openWorkspace(workspaceId);
  };

  const openBrowserTab = async (
    workspaceId: WorkspaceId,
    url: string,
    options?: {
      title?: string | null;
      tabId?: string;
      workspaceProjectId?: WorkspaceProjectId | null;
    },
  ) => {
    await openWorkspaceBrowserTab({
      workspaceId,
      url,
      title: options?.title ?? null,
      ...(options?.tabId ? { tabId: options.tabId } : {}),
      ...(options?.workspaceProjectId !== undefined
        ? { workspaceProjectId: options.workspaceProjectId }
        : {}),
    });
    await openWorkspace(workspaceId);
  };

  const openFilesPane = async (workspaceId: WorkspaceId) => {
    await ensureWorkspaceFilesPane(workspaceId);
    await openWorkspace(workspaceId);
  };

  const openGitChangedFile = async (workspaceId: WorkspaceId, relativePath: string) => {
    const workspace = workspaces.find((entry) => entry.id === workspaceId) ?? null;
    if (!workspace) {
      return;
    }
    await openWorkspaceFileTarget({
      workspaceId,
      targetPath: `${resolveWorkspacePreviewCwd(workspace)}/${relativePath}`,
    });
    await openWorkspace(workspaceId);
  };

  const handleCreateSavedView = async (projectId: ProjectId) => {
    const title = window.prompt("Saved view name");
    if (!title?.trim()) {
      return;
    }
    try {
      const workspaceId = await createManualWorkspace({
        projectId,
        title,
      });
      if (workspaceId) {
        await openWorkspace(workspaceId);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to create saved view",
        description: error instanceof Error ? error.message : "Unknown saved view creation error.",
      });
    }
  };

  const handleRenameWorkspace = async (
    workspaceId: WorkspaceId,
    currentTitle: string,
    itemLabel: string,
  ) => {
    const title = window.prompt(`Rename ${itemLabel}`, currentTitle);
    if (!title?.trim() || title.trim() === currentTitle) {
      return;
    }
    try {
      await renameWorkspace({ workspaceId, title });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Unable to rename ${itemLabel}`,
        description: error instanceof Error ? error.message : `Unknown ${itemLabel} rename error.`,
      });
    }
  };

  const handleArchiveWorkspace = async (
    workspaceId: WorkspaceId,
    title: string,
    itemLabel: string,
  ) => {
    const confirmed =
      (await window.desktopBridge?.confirm?.(`Archive ${itemLabel} "${title}"?`)) ??
      window.confirm(`Archive ${itemLabel} "${title}"?`);
    if (!confirmed) {
      return;
    }
    try {
      await archiveWorkspace(workspaceId);
      forgetVisitedWorkspace(workspaceId);
      if (workspaceId === currentWorkspaceId) {
        const fallbackWorkspaceId = resolveDefaultWorkspaceId(useStore.getState().workspaces);
        if (fallbackWorkspaceId) {
          await openWorkspace(fallbackWorkspaceId);
        }
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Unable to archive ${itemLabel}`,
        description: error instanceof Error ? error.message : `Unknown ${itemLabel} archive error.`,
      });
    }
  };

  const openTerminalActivity = async (workspaceId: WorkspaceId, threadId: ThreadId) => {
    await openThreadInWorkspace(workspaceId, threadId);
    setTerminalOpen(threadId, true);
  };

  const handleActivityClick = async (activityId: string) => {
    if (!currentWorkspace || !currentWorkspaceId) {
      return;
    }
    const activity = currentWorkspaceActivity.items.find((item) => item.id === activityId) ?? null;
    if (!activity) {
      return;
    }

    switch (activity.kind) {
      case "pending-approval":
      case "awaiting-input":
      case "running":
      case "plan-ready":
      case "completed":
        if (activity.threadId) {
          await openThreadInWorkspace(currentWorkspaceId, activity.threadId);
        }
        return;
      case "terminal-busy":
        if (activity.threadId) {
          await openTerminalActivity(currentWorkspaceId, activity.threadId);
        }
        return;
      case "git-attention":
        return;
      case "browser-loading":
      case "preview-available":
        if (activity.url) {
          await openBrowserTab(currentWorkspaceId, activity.url, { title: null });
        }
        return;
    }
  };

  useEffect(() => {
    const workspaceRoot = currentImportWorkspaceRoot;
    if (!api || !workspaceRoot) {
      return;
    }
    if (
      autoImportedRootsRef.current.has(workspaceRoot) ||
      autoImportInFlightRootsRef.current.has(workspaceRoot)
    ) {
      return;
    }

    autoImportInFlightRootsRef.current.add(workspaceRoot);
    let cancelled = false;

    void (async () => {
      try {
        const candidates = await scanThreadImports(api, workspaceRoot);
        if (cancelled) {
          return;
        }
        const pendingCandidates = candidates.filter(
          (candidate) => candidate.alreadyImportedThreadId === null,
        );
        if (pendingCandidates.length === 0) {
          autoImportedRootsRef.current.add(workspaceRoot);
          return;
        }

        for (const candidate of pendingCandidates) {
          await api.imports.importSession({
            provider: candidate.provider,
            externalSessionId: candidate.externalSessionId,
            sourcePath: candidate.sourcePath,
          });
          if (cancelled) {
            return;
          }
        }

        await refreshImportedThreadState(api, {
          syncServerReadModel,
          syncWorkspaceReadModel,
        });
        autoImportedRootsRef.current.add(workspaceRoot);
        toastManager.add({
          type: "success",
          title: "Imported local threads",
          description:
            pendingCandidates.length === 1
              ? "Imported 1 local thread for this project."
              : `Imported ${pendingCandidates.length} local threads for this project.`,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Automatic thread import failed", { workspaceRoot, error });
        }
      } finally {
        autoImportInFlightRootsRef.current.delete(workspaceRoot);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, currentImportWorkspaceRoot, syncServerReadModel, syncWorkspaceReadModel]);

  // Panel-specific rendering when an ActivityBar panel is active.
  if (panelId === "files" && currentWorkspace) {
    return (
      <div className="flex h-full flex-col">
        <FilesPane workspaceId={currentWorkspace.id} />
      </div>
    );
  }

  if (panelId === "search" && currentWorkspace) {
    return (
      <div className="flex h-full flex-col">
        <SearchPanel workspace={currentWorkspace} />
      </div>
    );
  }

  if (panelId === "source-control") {
    return (
      <div className="flex h-full flex-col">
        <SidebarHeader className="gap-2 border-b border-sidebar-border/60 px-3 py-3">
          <span className="text-sm font-semibold tracking-tight text-foreground">Source Control</span>
        </SidebarHeader>
        <SidebarContent>
          {currentWorkspace ? (
            <SidebarGroup>
              <div className="space-y-3 px-2">
                <div className="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/12 p-3 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-sidebar-foreground">
                        {gitStatusQuery.data?.branch ?? "Detached HEAD"}
                      </div>
                      <div className="mt-1 text-[11px] text-sidebar-foreground/65">
                        {gitAttentionSummary}
                      </div>
                    </div>
                    <GitCommitHorizontalIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
                  </div>
                  <div className="mt-3">
                    <GitActionsControl gitCwd={gitCwd} activeThreadId={currentResponsibleThreadId} />
                  </div>
                </div>
                <div className="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/8">
                  <div className="border-b border-sidebar-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/60">
                    Changes
                  </div>
                  <div className="max-h-[60vh] overflow-auto p-2">
                    {gitChangedFiles.length > 0 ? (
                      <div className="space-y-1">
                        {gitChangedFiles.map((file) => (
                          <button
                            key={file.path}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/45"
                            onClick={() => void openGitChangedFile(currentWorkspace.id, file.path)}
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-sidebar-foreground/85">
                              {file.path}
                            </span>
                            <span className="shrink-0 text-[10px] text-sidebar-foreground/55">
                              +{file.insertions} / -{file.deletions}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-2 py-1 text-xs text-sidebar-foreground/55">
                        No changed files.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
      </div>
    );
  }

  if (panelId === "activity") {
    return (
      <div className="flex h-full flex-col">
        <SidebarHeader className="gap-2 border-b border-sidebar-border/60 px-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold tracking-tight text-foreground">Activity</span>
            {currentWorkspace ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Apply workspace preset"
                    >
                      <SparklesIcon className="size-3.5" />
                    </button>
                  }
                />
                <DropdownMenuContent align="end">
                  {WORKSPACE_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.id}
                      onClick={() =>
                        void applyWorkspacePreset({
                          workspaceId: currentWorkspace.id,
                          presetId: preset.id,
                          workspace: currentWorkspace,
                          threads,
                          responsibleThreadId: currentResponsibleThreadId,
                          navigate,
                        })
                      }
                    >
                      {preset.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </SidebarHeader>
        <SidebarContent>
          {currentProjectSavedViews.length > 0 ? (
            <SidebarGroup>
              <SidebarGroupLabel>Saved Views</SidebarGroupLabel>
              <SidebarMenu>
                {currentProjectSavedViews.map((workspace) => {
                  const isActive = workspace.id === currentWorkspaceId;
                  const workspaceBadge = workspaceBadgeById[workspace.id] ?? null;
                  return (
                    <SidebarMenuItem key={workspace.id}>
                      <SidebarMenuButton
                        isActive={isActive}
                        size="sm"
                        onClick={() => void openWorkspace(workspace.id)}
                      >
                        <PanelsTopLeftIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{workspace.title}</span>
                      </SidebarMenuButton>
                      {workspaceBadge && workspaceBadge.count > 0 ? (
                        <SidebarMenuBadge
                          className={`${rowBadgeClassName(workspaceBadge.tone)} font-medium`}
                        >
                          {workspaceBadge.count}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}

          {currentWorkspace ? (
            <SidebarGroup>
              <SidebarGroupLabel>Activity</SidebarGroupLabel>
              <SidebarMenu>
                {visibleActivityItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton size="sm" onClick={() => void handleActivityClick(item.id)}>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {activityIcon(item.kind)}
                        <span className="truncate">{item.label}</span>
                        {item.ownerLabel ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {item.ownerLabel}
                          </span>
                        ) : null}
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {visibleActivityItems.length === 0 ? (
                  <SidebarMenuItem>
                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      {gitStatusQuery.isFetching
                        ? "Refreshing workspace activity..."
                        : "No active workspace activity."}
                    </div>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}
        </SidebarContent>
      </div>
    );
  }

  // Default: full sidebar (legacy fallback when no panelId is set)
  return (
    <div className="relative flex h-full flex-col overflow-visible">
      <SidebarHeader className="gap-3 border-b border-sidebar-border/60 px-3 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold tracking-tight text-foreground">T3 Code</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground/80">
              {currentWorkspace ? currentWorkspace.title : "Workspace shell"}
            </div>
          </div>
          {currentProject ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 rounded-xl px-2.5 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    aria-label={`Add workspace item in ${currentProject.name}`}
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void handleCreateSavedView(currentProject.id)}>
                  New saved view
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        {currentProjectSavedViews.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Saved Views</SidebarGroupLabel>
            <SidebarMenu>
              {currentProjectSavedViews.map((workspace) => {
                const isActive = workspace.id === currentWorkspaceId;
                const workspaceBadge = workspaceBadgeById[workspace.id] ?? null;
                return (
                  <SidebarMenuItem key={workspace.id}>
                    <div className="flex items-center gap-1">
                      <SidebarMenuButton
                        size="sm"
                        isActive={isActive}
                        onClick={() => void openWorkspace(workspace.id)}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate">{workspace.title}</span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                            View
                          </span>
                        </div>
                      </SidebarMenuButton>
                      {workspaceBadge ? (
                        <SidebarMenuBadge className={rowBadgeClassName(workspaceBadge.tone)}>
                          {workspaceBadge.count}
                        </SidebarMenuBadge>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              aria-label={`Saved view actions for ${workspace.title}`}
                            >
                              <MoreHorizontalIcon className="size-3.5" />
                            </button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              void handleRenameWorkspace(
                                workspace.id,
                                workspace.title,
                                "saved view",
                              )
                            }
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              void handleArchiveWorkspace(
                                workspace.id,
                                workspace.title,
                                "saved view",
                              )
                            }
                          >
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {currentWorkspace ? (
          <SidebarGroup>
            <div className="mb-2 flex items-center justify-between px-2">
              <SidebarGroupLabel className="px-0">Activity</SidebarGroupLabel>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Apply workspace preset"
                    >
                      <SparklesIcon className="size-3.5" />
                    </button>
                  }
                />
                <DropdownMenuContent align="end">
                  {WORKSPACE_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.id}
                      onClick={() =>
                        void applyWorkspacePreset({
                          workspaceId: currentWorkspace.id,
                          presetId: preset.id,
                          workspace: currentWorkspace,
                          threads,
                          responsibleThreadId: currentResponsibleThreadId,
                          navigate,
                        })
                      }
                    >
                      {preset.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <SidebarMenu>
              {visibleActivityItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton size="sm" onClick={() => void handleActivityClick(item.id)}>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {activityIcon(item.kind)}
                      <span className="truncate">{item.label}</span>
                      {item.ownerLabel ? (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {item.ownerLabel}
                        </span>
                      ) : null}
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {visibleActivityItems.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    {gitStatusQuery.isFetching
                      ? "Refreshing workspace activity..."
                      : "No active workspace activity."}
                  </div>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {currentWorkspace ? (
          <SidebarGroup>
            <SidebarGroupLabel>Source Control</SidebarGroupLabel>
            <div className="space-y-3 px-2">
              <div className="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/12 p-3 shadow-[0_12px_24px_-24px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-sidebar-foreground">
                      {gitStatusQuery.data?.branch ?? "Detached HEAD"}
                    </div>
                    <div className="mt-1 text-[11px] text-sidebar-foreground/65">
                      {gitAttentionSummary}
                    </div>
                  </div>
                  <GitCommitHorizontalIcon className="size-4 shrink-0 text-sidebar-foreground/60" />
                </div>
                <div className="mt-3">
                  <GitActionsControl gitCwd={gitCwd} activeThreadId={currentResponsibleThreadId} />
                </div>
              </div>
              <div className="rounded-xl border border-sidebar-border/60 bg-sidebar-accent/8">
                <div className="border-b border-sidebar-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/60">
                  Changes
                </div>
                <div className="max-h-52 overflow-auto p-2">
                  {gitChangedFiles.length > 0 ? (
                    <div className="space-y-1">
                      {gitChangedFiles.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/45"
                          onClick={() => void openGitChangedFile(currentWorkspace.id, file.path)}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-sidebar-foreground/85">
                            {file.path}
                          </span>
                          <span className="shrink-0 text-[10px] text-sidebar-foreground/55">
                            +{file.insertions} / -{file.deletions}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-2 py-1 text-xs text-sidebar-foreground/55">
                      No changed files.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SidebarGroup>
        ) : null}

        {currentWorkspace ? (
          <SidebarGroup>
            <SidebarGroupLabel>Files</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  isActive={currentWorkspaceFilesSidebarState?.open === true}
                  onClick={() => {
                    if (currentWorkspaceFilesSidebarState?.open) {
                      setWorkspaceFilesSidebarOpen(currentWorkspace.id, false);
                      return;
                    }
                    void openFilesPane(currentWorkspace.id);
                  }}
                >
                  <FileSearchIcon className="size-3.5" />
                  <span>
                    {currentWorkspaceFilesSidebarState?.open ? "Hide files" : "Show files"}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter className="border-t border-sidebar-border/60 px-2 py-2.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" onClick={() => setImportDialogOpen(true)}>
              <ArrowDownIcon className="size-3.5" />
              <span>Import Threads</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" onClick={() => void navigate({ to: "/settings" })}>
              <SettingsIcon className="size-3.5" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {currentWorkspace && currentWorkspaceFilesSidebarState?.open ? (
        <div className="absolute inset-y-0 left-full z-20 hidden w-[min(44rem,48vw)] border-r border-border bg-background shadow-2xl md:block">
          <FilesPane
            workspaceId={currentWorkspace.id}
            onClose={() => setWorkspaceFilesSidebarOpen(currentWorkspace.id, false)}
          />
        </div>
      ) : null}
      <ImportThreadsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        workspaceRoot={currentImportWorkspaceRoot}
      />
    </div>
  );
}
