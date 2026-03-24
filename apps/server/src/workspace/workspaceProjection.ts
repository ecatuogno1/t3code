import {
  type ProjectId,
  type ThreadId,
  type WorkspaceCommand,
  type WorkspaceBrowserTab,
  type WorkspaceContextKey,
  type WorkspaceId,
  type WorkspaceLayoutState,
  type WorkspacePane,
  type WorkspaceSource,
  type WorkspaceSurface,
  type WorkspaceTerminalGroup,
} from "@t3tools/contracts";

export function defaultChatPaneId(threadId: ThreadId): string {
  return `chat:${threadId}`;
}

function lastPathSegment(path: string): string {
  const trimmed = path.trim();
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts.at(-1) ?? trimmed;
}

export function buildWorkspaceContextKey(input: {
  readonly source: WorkspaceSource;
  readonly worktreePath: string | null;
  readonly pullRequestUrl?: string | null;
}): WorkspaceContextKey | null {
  switch (input.source) {
    case "manual-view":
    case "manual":
      return null;
    case "root":
    case "project-default":
      return "root" as WorkspaceContextKey;
    case "worktree":
      return input.worktreePath?.trim()
        ? (`worktree:${input.worktreePath.trim()}` as WorkspaceContextKey)
        : null;
    case "pull-request":
      if (input.pullRequestUrl?.trim()) {
        return `pull-request:${input.pullRequestUrl.trim()}` as WorkspaceContextKey;
      }
      return input.worktreePath?.trim()
        ? (`pull-request:${input.worktreePath.trim()}` as WorkspaceContextKey)
        : null;
  }
}

export function deriveWorkspaceTitle(input: {
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly source: WorkspaceSource;
  readonly worktreePath: string | null;
  readonly title?: string | null;
}): string {
  if (input.title?.trim()) {
    return input.title.trim();
  }
  switch (input.source) {
    case "manual-view":
    case "manual":
      return `${input.projectTitle} view`;
    case "root":
    case "project-default":
      return input.projectTitle.trim() || lastPathSegment(input.workspaceRoot);
    case "worktree":
      return input.worktreePath?.trim() ? lastPathSegment(input.worktreePath) : input.projectTitle;
    case "pull-request":
      return input.worktreePath?.trim() ? lastPathSegment(input.worktreePath) : "Pull Request";
  }
}

export function createDefaultWorkspaceLayout(activePaneId: string | null): WorkspaceLayoutState {
  return {
    paneOrder: activePaneId ? [activePaneId] : [],
    activePaneId,
  };
}

export function createThreadChatPane(input: {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): WorkspacePane {
  return {
    id: defaultChatPaneId(input.threadId),
    kind: "chat",
    title: input.title,
    threadId: input.threadId,
    terminalGroupId: null,
    browserTabId: null,
    filePath: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createDefaultWorkspaceProjection(input: {
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly source: WorkspaceSource;
  readonly contextKey: WorkspaceContextKey | null;
  readonly parentWorkspaceId: WorkspaceId | null;
  readonly rootWorkspaceId: WorkspaceId;
  readonly originRepoKey: string;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly threadId?: ThreadId;
  readonly threadTitle?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}) {
  const pane =
    input.threadId && input.threadTitle
      ? createThreadChatPane({
          threadId: input.threadId,
          title: input.threadTitle,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
      : null;
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    title: input.title,
    source: input.source,
    contextKey: input.contextKey,
    parentWorkspaceId: input.parentWorkspaceId,
    rootWorkspaceId: input.rootWorkspaceId,
    originRepoKey: input.originRepoKey,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    panes: pane ? ([pane] satisfies ReadonlyArray<WorkspacePane>) : [],
    terminalGroups: [] satisfies ReadonlyArray<WorkspaceTerminalGroup>,
    browserTabs: [] satisfies ReadonlyArray<WorkspaceBrowserTab>,
    detectedDevServerUrls: [] satisfies ReadonlyArray<string>,
    layout: createDefaultWorkspaceLayout(pane?.id ?? null),
    lastFocusedPaneId: pane?.id ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: null,
  };
}

export function ensureWorkspaceHasThreadPane<
  TWorkspace extends Pick<
    WorkspaceSurface,
    | "panes"
    | "layout"
    | "lastFocusedPaneId"
    | "title"
    | "source"
    | "contextKey"
    | "workspaceRoot"
    | "worktreePath"
    | "projectId"
    | "updatedAt"
  >,
>(input: {
  readonly workspace: TWorkspace;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly updatedAt: string;
}) {
  const paneId = defaultChatPaneId(input.threadId);
  const existingPane = input.workspace.panes.find((pane) => pane.id === paneId);
  const panes = existingPane
    ? input.workspace.panes.map((pane) =>
        pane.id === paneId
          ? {
              ...pane,
              title: input.threadTitle,
              updatedAt: input.updatedAt,
            }
          : pane,
      )
    : [
        ...input.workspace.panes,
        createThreadChatPane({
          threadId: input.threadId,
          title: input.threadTitle,
          createdAt: input.updatedAt,
          updatedAt: input.updatedAt,
        }),
      ];
  const paneOrder = input.workspace.layout.paneOrder.includes(paneId)
    ? input.workspace.layout.paneOrder
    : [...input.workspace.layout.paneOrder, paneId];

  return {
    ...input.workspace,
    panes,
    layout: {
      ...input.workspace.layout,
      paneOrder,
      activePaneId: input.workspace.layout.activePaneId ?? paneId,
    },
    lastFocusedPaneId: input.workspace.lastFocusedPaneId ?? paneId,
    updatedAt: input.updatedAt,
  };
}

export function upsertWorkspacePaneRecord(
  panes: ReadonlyArray<WorkspacePane>,
  pane: WorkspacePane,
): ReadonlyArray<WorkspacePane> {
  const existingIndex = panes.findIndex((candidate) => candidate.id === pane.id);
  if (existingIndex === -1) {
    return [...panes, pane];
  }
  return panes.map((candidate, index) => (index === existingIndex ? pane : candidate));
}

export function removeWorkspacePaneRecord(
  panes: ReadonlyArray<WorkspacePane>,
  paneId: string,
): ReadonlyArray<WorkspacePane> {
  return panes.filter((pane) => pane.id !== paneId);
}

export function upsertWorkspaceBrowserTabRecord(
  browserTabs: ReadonlyArray<WorkspaceBrowserTab>,
  tab: WorkspaceBrowserTab,
): ReadonlyArray<WorkspaceBrowserTab> {
  const existingIndex = browserTabs.findIndex((candidate) => candidate.id === tab.id);
  if (existingIndex === -1) {
    return [...browserTabs, tab];
  }
  return browserTabs.map((candidate, index) => (index === existingIndex ? tab : candidate));
}

export function removeWorkspaceBrowserTabRecord(
  browserTabs: ReadonlyArray<WorkspaceBrowserTab>,
  browserTabId: string,
): ReadonlyArray<WorkspaceBrowserTab> {
  return browserTabs.filter((tab) => tab.id !== browserTabId);
}

export function sanitizeWorkspaceLayout(input: {
  readonly layout: WorkspaceLayoutState;
  readonly panes: ReadonlyArray<WorkspacePane>;
  readonly lastFocusedPaneId: string | null;
}): WorkspaceLayoutState & { readonly lastFocusedPaneId: string | null } {
  const availablePaneIds = new Set(input.panes.map((pane) => pane.id));
  const paneOrder = input.layout.paneOrder.filter((paneId, index, allPaneIds) => {
    return availablePaneIds.has(paneId) && allPaneIds.indexOf(paneId) === index;
  });
  const activePaneId =
    input.layout.activePaneId && availablePaneIds.has(input.layout.activePaneId)
      ? input.layout.activePaneId
      : (paneOrder.at(-1) ?? paneOrder[0] ?? null);
  const lastFocusedPaneId =
    input.lastFocusedPaneId && availablePaneIds.has(input.lastFocusedPaneId)
      ? input.lastFocusedPaneId
      : activePaneId;
  return {
    paneOrder,
    activePaneId,
    lastFocusedPaneId,
  };
}

export function applyWorkspaceCommandToProjection<
  TWorkspace extends Pick<
    WorkspaceSurface,
    | "browserTabs"
    | "contextKey"
    | "customTopics"
    | "detectedDevServerUrls"
    | "lastFocusedPaneId"
    | "layout"
    | "panes"
    | "source"
    | "title"
    | "updatedAt"
  >,
>(input: { readonly workspace: TWorkspace; readonly command: WorkspaceCommand }): TWorkspace {
  const { workspace, command } = input;
  switch (command.type) {
    case "workspace.create": {
      return workspace;
    }

    case "workspaceProject.create": {
      return workspace;
    }

    case "workspace.rename": {
      return {
        ...workspace,
        title: command.title,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.archive": {
      return {
        ...workspace,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.browserTab.upsert": {
      return {
        ...workspace,
        browserTabs: upsertWorkspaceBrowserTabRecord(workspace.browserTabs, command.tab),
        updatedAt: command.tab.updatedAt,
      };
    }

    case "workspace.browserTab.remove": {
      const panes = workspace.panes.filter((pane) => pane.browserTabId !== command.browserTabId);
      const layout = sanitizeWorkspaceLayout({
        layout: {
          ...workspace.layout,
          paneOrder: workspace.layout.paneOrder.filter((paneId) =>
            panes.some((pane) => pane.id === paneId),
          ),
        },
        panes,
        lastFocusedPaneId: workspace.lastFocusedPaneId,
      });
      return {
        ...workspace,
        browserTabs: removeWorkspaceBrowserTabRecord(workspace.browserTabs, command.browserTabId),
        panes,
        layout: {
          paneOrder: layout.paneOrder,
          activePaneId: layout.activePaneId,
        },
        lastFocusedPaneId: layout.lastFocusedPaneId,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.pane.upsert": {
      const panes = upsertWorkspacePaneRecord(workspace.panes, command.pane);
      const layout = sanitizeWorkspaceLayout({
        layout: {
          paneOrder: workspace.layout.paneOrder.includes(command.pane.id)
            ? workspace.layout.paneOrder
            : [...workspace.layout.paneOrder, command.pane.id],
          activePaneId: workspace.layout.activePaneId ?? command.pane.id,
        },
        panes,
        lastFocusedPaneId: workspace.lastFocusedPaneId ?? command.pane.id,
      });
      return {
        ...workspace,
        panes,
        layout: {
          paneOrder: layout.paneOrder,
          activePaneId: layout.activePaneId,
        },
        lastFocusedPaneId: layout.lastFocusedPaneId,
        updatedAt: command.pane.updatedAt,
      };
    }

    case "workspace.pane.remove": {
      const panes = removeWorkspacePaneRecord(workspace.panes, command.paneId);
      const layout = sanitizeWorkspaceLayout({
        layout: {
          paneOrder: workspace.layout.paneOrder.filter((paneId) => paneId !== command.paneId),
          activePaneId:
            workspace.layout.activePaneId === command.paneId ? null : workspace.layout.activePaneId,
        },
        panes,
        lastFocusedPaneId:
          workspace.lastFocusedPaneId === command.paneId ? null : workspace.lastFocusedPaneId,
      });
      return {
        ...workspace,
        panes,
        layout: {
          paneOrder: layout.paneOrder,
          activePaneId: layout.activePaneId,
        },
        lastFocusedPaneId: layout.lastFocusedPaneId,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.layout.update": {
      const layout = sanitizeWorkspaceLayout({
        layout: {
          paneOrder: command.paneOrder ?? workspace.layout.paneOrder,
          activePaneId:
            command.activePaneId !== undefined
              ? command.activePaneId
              : workspace.layout.activePaneId,
        },
        panes: workspace.panes,
        lastFocusedPaneId:
          command.lastFocusedPaneId !== undefined
            ? command.lastFocusedPaneId
            : workspace.lastFocusedPaneId,
      });
      return {
        ...workspace,
        layout: {
          paneOrder: layout.paneOrder,
          activePaneId: layout.activePaneId,
        },
        lastFocusedPaneId: layout.lastFocusedPaneId,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.detectedDevServerUrl.upsert": {
      const detectedDevServerUrls = workspace.detectedDevServerUrls.includes(command.url)
        ? workspace.detectedDevServerUrls
        : [...workspace.detectedDevServerUrls, command.url];
      return {
        ...workspace,
        detectedDevServerUrls,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.detectedDevServerUrl.remove": {
      return {
        ...workspace,
        detectedDevServerUrls: workspace.detectedDevServerUrls.filter((url) => url !== command.url),
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.topic.upsert": {
      const customTopics = (workspace.customTopics ?? []).includes(command.label)
        ? (workspace.customTopics ?? [])
        : [...(workspace.customTopics ?? []), command.label];
      return {
        ...workspace,
        customTopics,
        updatedAt: command.updatedAt,
      };
    }

    case "workspace.topic.remove": {
      return {
        ...workspace,
        customTopics: (workspace.customTopics ?? []).filter((label) => label !== command.label),
        updatedAt: command.updatedAt,
      };
    }
  }
}
