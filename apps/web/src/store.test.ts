import {
  type BrowserTabSnapshot,
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  TurnId,
  WorkspaceId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  applyBrowserRuntimeEvent,
  ensureWorkspacePaneState,
  forgetVisitedWorkspace,
  markThreadUnread,
  openWorkspaceThreadPane,
  rememberVisitedWorkspace,
  removeWorkspaceBrowserTabRecord,
  reorderProjects,
  setActiveWorkspaceDevTarget,
  setPaneTier,
  setPreferredChildWorkspace,
  setWorkspaceEnvironmentUrl,
  setWorkspaceThreadClusterExpanded,
  upsertWorkspaceBrowserTabRecord,
  setWorkspacePaneLayoutState,
  syncServerReadModel,
  syncWorkspaceReadModel,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
    workspaceProjectId: "workspace-project:workspace:project-1:project-root:root" as any,
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    pullRequestUrl: null,
    previewUrls: [],
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        cwd: "/tmp/project",
        model: "gpt-5-codex",
        expanded: true,
        scripts: [],
      },
    ],
    threads: [thread],
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
    threadsHydrated: true,
    workspacesHydrated: false,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
    workspaceProjectId: "workspace-project:workspace:project-1:project-root:root" as any,
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    pullRequestUrl: null,
    previewUrls: [],
    groupId: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
    threadGroups: [],
    projectMemories: [],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModel: "gpt-5.3-codex",
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("ensureWorkspacePaneState does not override when a chat pane is already open", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [ThreadId.makeUnsafe("thread-global")],
          paneOrder: ["chat:thread-global", "browser:browser-1"],
          activePaneId: "chat:thread-global",
          paneTierById: {},
        },
      },
    };

    const next = ensureWorkspacePaneState(initialState, workspaceId, [
      ThreadId.makeUnsafe("thread-app"),
    ]);

    // Should NOT add the fallback — a chat pane is already open.
    expect(next.workspaceShellById[workspaceId]?.paneOrder).toEqual([
      "chat:thread-global",
      "browser:browser-1",
    ]);
    expect(next.workspaceShellById[workspaceId]?.activePaneId).toBe("chat:thread-global");
  });

  it("ensureWorkspacePaneState adds a fallback thread when no chat pane is open", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [],
          paneOrder: ["browser:browser-1"],
          activePaneId: "browser:browser-1",
          paneTierById: {},
        },
      },
    };

    const next = ensureWorkspacePaneState(initialState, workspaceId, [
      ThreadId.makeUnsafe("thread-app"),
    ]);

    expect(next.workspaceShellById[workspaceId]?.paneOrder).toContain("chat:thread-app");
    expect(next.workspaceShellById[workspaceId]?.activePaneId).toBe("chat:thread-app");
  });

  it("openWorkspaceThreadPane collapses duplicate chat panes before focusing a thread", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-1")],
          paneOrder: ["chat:thread-1", "chat:thread-1", "browser:preview-1"],
          activePaneId: "chat:thread-1",
          paneTierById: {},
        },
      },
    };

    const next = openWorkspaceThreadPane(
      initialState,
      workspaceId,
      ThreadId.makeUnsafe("thread-1"),
    );

    expect(next.workspaceShellById[workspaceId]).toEqual({
      openThreadIds: [ThreadId.makeUnsafe("thread-1")],
      paneOrder: ["chat:thread-1", "browser:preview-1"],
      activePaneId: "chat:thread-1",
      paneTierById: { "chat:thread-1": "project" },
    });
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      projects: [
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          cwd: "/tmp/project-3",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
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
      threadsHydrated: true,
      workspacesHydrated: false,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });

  it("setWorkspacePaneLayoutState preserves mixed chat and browser pane ordering", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState = makeState(makeThread());

    const next = setWorkspacePaneLayoutState(
      initialState,
      workspaceId,
      ["chat:thread-1", "browser:browser-tab-1"],
      "browser:browser-tab-1",
    );

    expect(next.workspaceShellById[workspaceId]).toEqual({
      openThreadIds: [ThreadId.makeUnsafe("thread-1")],
      paneOrder: ["chat:thread-1", "browser:browser-tab-1"],
      activePaneId: "browser:browser-tab-1",
      paneTierById: {},
    });
  });

  it("setWorkspacePaneLayoutState preserves files panes alongside chat panes", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState = makeState(makeThread());

    const next = setWorkspacePaneLayoutState(
      initialState,
      workspaceId,
      ["chat:thread-1", "files:workspace:project-1:project-root"],
      "files:workspace:project-1:project-root",
    );

    expect(next.workspaceShellById[workspaceId]).toEqual({
      openThreadIds: [ThreadId.makeUnsafe("thread-1")],
      paneOrder: ["chat:thread-1", "files:workspace:project-1:project-root"],
      activePaneId: "files:workspace:project-1:project-root",
      paneTierById: {},
    });
  });

  it("applyBrowserRuntimeEvent upserts and removes native browser tab snapshots", () => {
    const initialState = makeState(makeThread());
    const openedTab: BrowserTabSnapshot = {
      id: "browser-tab-1",
      url: "https://example.com",
      title: "Example",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    };

    const openedState = applyBrowserRuntimeEvent(initialState, {
      type: "tab-opened",
      tab: openedTab,
    });
    expect(openedState.browserRuntimeTabsById["browser-tab-1"]).toEqual(openedTab);

    const updatedState = applyBrowserRuntimeEvent(openedState, {
      type: "tab-updated",
      tab: {
        ...openedTab,
        title: "Example App",
        loading: false,
      },
    });
    expect(updatedState.browserRuntimeTabsById["browser-tab-1"]).toEqual({
      ...openedTab,
      title: "Example App",
      loading: false,
    });

    const closedState = applyBrowserRuntimeEvent(updatedState, {
      type: "tab-closed",
      tabId: "browser-tab-1",
    });
    expect(closedState.browserRuntimeTabsById).toEqual({});
  });

  it("upserts workspace browser tabs optimistically", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaces: [
        {
          id: workspaceId,
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Repo",
          source: "root",
          contextKey: "root" as any,
          workspaceRoot: "/tmp/project",
          worktreePath: null,
          linkedThreadIds: [],
          terminalGroups: [],
          browserTabs: [],
          detectedDevServerUrls: [],
          panes: [],
          layout: {
            paneOrder: [],
            activePaneId: null,
          },
          lastFocusedPaneId: null,
          parentWorkspaceId: null,
          rootWorkspaceId: workspaceId,
          originRepoKey: "/tmp/project" as any,
          createdAt: "2026-03-21T00:00:00.000Z",
          updatedAt: "2026-03-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
    };

    const next = upsertWorkspaceBrowserTabRecord(initialState, workspaceId, {
      id: "browser-tab-1",
      url: "https://example.com",
      title: "Example",
      workspaceProjectId: null,
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });

    expect(next.workspaces[0]?.browserTabs).toEqual([
      {
        id: "browser-tab-1",
        url: "https://example.com",
        title: "Example",
        workspaceProjectId: null,
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:00.000Z",
      },
    ]);
  });

  it("removeWorkspaceBrowserTabRecord removes pane, layout, and runtime state together", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      browserRuntimeTabsById: {
        "browser-tab-1": {
          id: "browser-tab-1",
          url: "https://example.com",
          title: "Example",
          loading: false,
          canGoBack: false,
          canGoForward: false,
        },
      },
      workspaces: [
        {
          id: workspaceId,
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Repo",
          source: "root",
          contextKey: "root" as any,
          workspaceRoot: "/tmp/project",
          worktreePath: null,
          linkedThreadIds: [ThreadId.makeUnsafe("thread-1")],
          terminalGroups: [],
          browserTabs: [
            {
              id: "browser-tab-1",
              url: "https://example.com",
              title: "Example",
              workspaceProjectId: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          ],
          detectedDevServerUrls: [],
          panes: [
            {
              id: "chat:thread-1",
              kind: "chat",
              title: "Thread 1",
              threadId: ThreadId.makeUnsafe("thread-1"),
              terminalGroupId: null,
              browserTabId: null,
              filePath: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
            {
              id: "browser:browser-tab-1",
              kind: "browser",
              title: "Example",
              threadId: null,
              terminalGroupId: null,
              browserTabId: "browser-tab-1",
              filePath: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          ],
          layout: {
            paneOrder: ["chat:thread-1", "browser:browser-tab-1"],
            activePaneId: "browser:browser-tab-1",
          },
          lastFocusedPaneId: "browser:browser-tab-1",
          parentWorkspaceId: null,
          rootWorkspaceId: workspaceId,
          originRepoKey: "/tmp/project" as any,
          createdAt: "2026-03-21T00:00:00.000Z",
          updatedAt: "2026-03-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [ThreadId.makeUnsafe("thread-1")],
          paneOrder: ["chat:thread-1", "browser:browser-tab-1"],
          activePaneId: "browser:browser-tab-1",
          paneTierById: {},
        },
      },
    };

    const next = removeWorkspaceBrowserTabRecord(initialState, workspaceId, "browser-tab-1");

    expect(next.workspaces[0]?.browserTabs).toEqual([]);
    expect(next.workspaces[0]?.layout).toEqual({
      paneOrder: ["chat:thread-1"],
      activePaneId: "chat:thread-1",
    });
    expect(next.workspaceShellById[workspaceId]).toEqual({
      openThreadIds: [ThreadId.makeUnsafe("thread-1")],
      paneOrder: ["chat:thread-1"],
      activePaneId: "chat:thread-1",
      paneTierById: {},
    });
    expect(next.browserRuntimeTabsById).toEqual({});
  });

  it("rememberVisitedWorkspace tracks recency without duplicates", () => {
    const workspace1 = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const workspace2 = WorkspaceId.makeUnsafe("workspace:project-1:web");
    const initialState = makeState(makeThread());

    const next = rememberVisitedWorkspace(
      rememberVisitedWorkspace(rememberVisitedWorkspace(initialState, workspace1), workspace2),
      workspace1,
    );

    expect(next.recentWorkspaceIds).toEqual([workspace2, workspace1]);
    expect(next.lastActiveWorkspaceId).toBe(workspace1);
  });

  it("forgetVisitedWorkspace updates the restore fallback when removing the active workspace", () => {
    const workspace1 = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const workspace2 = WorkspaceId.makeUnsafe("workspace:project-1:web");
    const initialState: AppState = {
      ...makeState(makeThread()),
      recentWorkspaceIds: [workspace1, workspace2],
      lastActiveWorkspaceId: workspace2,
    };

    const next = forgetVisitedWorkspace(initialState, workspace2);

    expect(next.recentWorkspaceIds).toEqual([workspace1]);
    expect(next.lastActiveWorkspaceId).toBe(workspace1);
  });

  it("tracks family navigation restore state for child workspaces, dev targets, and clusters", () => {
    const rootWorkspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const childWorkspaceId = WorkspaceId.makeUnsafe("workspace:project-1:web");
    const initialState = makeState(makeThread());

    const next = setWorkspaceThreadClusterExpanded(
      setActiveWorkspaceDevTarget(
        setPreferredChildWorkspace(initialState, rootWorkspaceId, childWorkspaceId),
        childWorkspaceId,
        "preview:http://localhost:3000",
      ),
      `${childWorkspaceId}:workspace`,
      true,
    );

    expect(next.preferredChildWorkspaceIdByRootId[rootWorkspaceId]).toBe(childWorkspaceId);
    expect(next.activeWorkspaceDevTargetByWorkspaceId[childWorkspaceId]).toBe(
      "preview:http://localhost:3000",
    );
    expect(next.expandedWorkspaceThreadClusterIds).toEqual([`${childWorkspaceId}:workspace`]);
  });

  it("stores configured environment URLs by workspace context", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const workspaceProjectId = "workspace-project:workspace:project-1:root:web" as never;
    const initialState = makeState(makeThread());

    const next = setWorkspaceEnvironmentUrl(initialState, {
      workspaceId,
      workspaceProjectId,
      environment: "remote-dev",
      url: "https://dev.example.com",
    });

    expect(next.configuredWorkspaceEnvironmentUrlsByKey).toEqual({
      [`${workspaceId}:${workspaceProjectId}:remote-dev`]: "https://dev.example.com",
    });
  });
});

describe("store read model sync", () => {
  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "claude-opus-4-6",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-opus-4-6");
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "sonnet",
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-sonnet-4-6");
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      projects: [
        {
          id: project2,
          name: "Project 2",
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
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
      threadsHydrated: true,
      workspacesHydrated: false,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
      threadGroups: [],
      projectMemories: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });

  it("prunes missing recent workspace ids during workspace sync", () => {
    const rootWorkspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const staleWorkspaceId = WorkspaceId.makeUnsafe("workspace:project-1:stale");
    const initialState: AppState = {
      ...makeState(makeThread()),
      recentWorkspaceIds: [staleWorkspaceId, rootWorkspaceId],
      lastActiveWorkspaceId: staleWorkspaceId,
      preferredChildWorkspaceIdByRootId: {
        [rootWorkspaceId]: staleWorkspaceId,
      },
      activeWorkspaceDevTargetByWorkspaceId: {
        [staleWorkspaceId]: "preview:http://localhost:3000",
      },
      expandedWorkspaceThreadClusterIds: [`${staleWorkspaceId}:workspace`],
    };

    const next = syncWorkspaceReadModel(initialState, {
      snapshotSequence: 1,
      updatedAt: "2026-03-21T00:00:00.000Z",
      workspaces: [
        {
          id: rootWorkspaceId,
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Repo",
          source: "root",
          contextKey: "root" as any,
          workspaceRoot: "/tmp/project",
          worktreePath: null,
          linkedThreadIds: [],
          terminalGroups: [],
          browserTabs: [],
          detectedDevServerUrls: [],
          panes: [],
          layout: {
            paneOrder: [],
            activePaneId: null,
          },
          lastFocusedPaneId: null,
          parentWorkspaceId: null,
          rootWorkspaceId,
          originRepoKey: "/tmp/project" as any,
          createdAt: "2026-03-21T00:00:00.000Z",
          updatedAt: "2026-03-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      workspaceProjects: [],
    });

    expect(next.recentWorkspaceIds).toEqual([rootWorkspaceId]);
    expect(next.lastActiveWorkspaceId).toBe(rootWorkspaceId);
    expect(next.preferredChildWorkspaceIdByRootId[rootWorkspaceId]).toBeNull();
    expect(next.activeWorkspaceDevTargetByWorkspaceId).toEqual({});
    expect(next.expandedWorkspaceThreadClusterIds).toEqual([]);
  });

  it("reconciles local workspace shell state against the persisted workspace layout", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
          paneOrder: ["chat:thread-2", "browser:missing", "browser:browser-tab-1"],
          activePaneId: "browser:missing",
          paneTierById: {},
        },
      },
    };

    const next = syncWorkspaceReadModel(initialState, {
      snapshotSequence: 1,
      updatedAt: "2026-03-21T00:00:00.000Z",
      workspaces: [
        {
          id: workspaceId,
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Repo",
          source: "root",
          contextKey: "root" as any,
          workspaceRoot: "/tmp/project",
          worktreePath: null,
          linkedThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
          terminalGroups: [],
          browserTabs: [
            {
              id: "browser-tab-1",
              url: "https://example.com",
              title: "Example",
              workspaceProjectId: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          ],
          detectedDevServerUrls: [],
          panes: [
            {
              id: "chat:thread-1",
              kind: "chat",
              title: "Thread 1",
              threadId: ThreadId.makeUnsafe("thread-1"),
              terminalGroupId: null,
              browserTabId: null,
              filePath: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
            {
              id: "browser:browser-tab-1",
              kind: "browser",
              title: "Example",
              threadId: null,
              terminalGroupId: null,
              browserTabId: "browser-tab-1",
              filePath: null,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z",
            },
          ],
          layout: {
            paneOrder: ["browser:browser-tab-1", "chat:thread-1"],
            activePaneId: "browser:browser-tab-1",
          },
          lastFocusedPaneId: "chat:thread-1",
          parentWorkspaceId: null,
          rootWorkspaceId: workspaceId,
          originRepoKey: "/tmp/project" as any,
          createdAt: "2026-03-21T00:00:00.000Z",
          updatedAt: "2026-03-21T00:00:00.000Z",
          deletedAt: null,
        },
      ],
      workspaceProjects: [],
    });

    expect(next.workspaceShellById[workspaceId]).toEqual({
      openThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
      paneOrder: ["browser:browser-tab-1", "chat:thread-1", "chat:thread-2"],
      activePaneId: "browser:browser-tab-1",
      paneTierById: {},
    });
  });

  it("setPaneTier updates the tier of an existing pane", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [ThreadId.makeUnsafe("thread-1")],
          paneOrder: ["chat:thread-1", "browser:preview-1"],
          activePaneId: "chat:thread-1",
          paneTierById: {},
        },
      },
    };

    const next = setPaneTier(initialState, workspaceId, "chat:thread-1", "workspace");

    expect(next.workspaceShellById[workspaceId]?.paneTierById["chat:thread-1"]).toBe("workspace");
  });

  it("setPaneTier triggers ephemeral eviction when demoting", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const paneOrder = [
      ...Array.from({ length: 6 }, (_, index) => `browser:tab-${index + 1}`),
      "chat:thread-1", // at the end (newest)
    ];
    const initialState: AppState = {
      ...makeState(makeThread()),
      workspaceShellById: {
        [workspaceId]: {
          openThreadIds: [ThreadId.makeUnsafe("thread-1")],
          paneOrder,
          activePaneId: "browser:tab-3",
          paneTierById: { "chat:thread-1": "project" },
        },
      },
    };

    // Demote chat pane to ephemeral — now 7 ephemeral panes, should evict oldest browser tab
    const next = setPaneTier(initialState, workspaceId, "chat:thread-1", "ephemeral");

    const nextShell = next.workspaceShellById[workspaceId];
    expect(nextShell?.paneTierById["chat:thread-1"]).toBe("ephemeral");
    expect(nextShell?.paneOrder).toContain("chat:thread-1"); // newest, not evicted
    expect(nextShell?.paneOrder).toContain("browser:tab-3"); // active pane preserved
    expect(nextShell?.paneOrder).not.toContain("browser:tab-1"); // oldest evicted
    expect(nextShell?.paneOrder).toHaveLength(6);
  });

  it("openWorkspaceThreadPane assigns default project tier to new chat panes", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    const initialState = makeState(makeThread());

    const next = openWorkspaceThreadPane(
      initialState,
      workspaceId,
      ThreadId.makeUnsafe("thread-1"),
    );

    expect(next.workspaceShellById[workspaceId]?.paneTierById["chat:thread-1"]).toBe("project");
  });
});
