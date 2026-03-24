import {
  ProjectId,
  ThreadId,
  TurnId,
  WorkspaceId,
  type BrowserTabSnapshot,
  type WorkspaceProjectSurface,
  type WorkspaceSurface,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveWorkspaceActivitySummary, deriveWorkspaceRowBadge } from "./workspaceActivity";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:root"),
    workspaceProjectId: null,
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-20T00:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: "2026-03-20T00:00:00.000Z",
    branch: null,
    worktreePath: null,
    pullRequestUrl: null,
    previewUrls: [],
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeWorkspace(): WorkspaceSurface {
  return {
    id: WorkspaceId.makeUnsafe("workspace:project-1:root"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    source: "project-default",
    contextKey: "project-default",
    workspaceRoot: "/tmp/project",
    worktreePath: null,
    linkedThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
    terminalGroups: [],
    browserTabs: [
      {
        id: "browser-tab-1",
        url: "http://localhost:3000",
        title: "Preview",
        workspaceProjectId: null,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    detectedDevServerUrls: ["http://localhost:3000"],
    panes: [],
    layout: {
      paneOrder: ["chat:thread-1", "browser:browser-tab-1"],
      activePaneId: "chat:thread-1",
    },
    lastFocusedPaneId: "chat:thread-1",
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    deletedAt: null,
  };
}

function makeWorkspaceProjects(): WorkspaceProjectSurface[] {
  const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
  return [
    {
      id: "workspace-project:root" as any,
      workspaceId,
      title: "Project",
      path: "",
      kind: "root",
      contextKey: "root",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      deletedAt: null,
    },
    {
      id: "workspace-project:apps:web" as any,
      workspaceId,
      title: "@repo/web",
      path: "apps/web",
      kind: "app",
      contextKey: "path:apps/web",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
      deletedAt: null,
    },
  ];
}

describe("workspaceActivity", () => {
  it("derives ordered workspace activity items from threads, terminals, git, browser, and preview", () => {
    const workspace = makeWorkspace();
    const workspaceProjects = makeWorkspaceProjects();
    const threads = [
      makeThread({
        activities: [
          {
            id: "activity-1",
            turnId: TurnId.makeUnsafe("turn-1"),
            tone: "approval",
            kind: "approval.requested",
            summary: "Approval requested",
            payload: {
              requestId: "request-1",
              requestKind: "command",
            },
            createdAt: "2026-03-20T00:00:01.000Z",
          } as Thread["activities"][number],
        ],
        session: {
          provider: "codex",
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.makeUnsafe("turn-1"),
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:01.000Z",
        },
        workspaceProjectId: "workspace-project:apps:web" as any,
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        title: "Review",
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-2"),
          state: "completed",
          requestedAt: "2026-03-20T00:00:00.000Z",
          startedAt: "2026-03-20T00:00:01.000Z",
          completedAt: "2026-03-20T00:00:03.000Z",
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-03-20T00:00:02.000Z",
      }),
    ];
    const browserRuntimeTabsById: Record<string, BrowserTabSnapshot> = {
      "browser-tab-1": {
        id: "browser-tab-1",
        url: "http://localhost:3000",
        title: "Preview",
        loading: true,
        canGoBack: false,
        canGoForward: false,
      },
    };

    const summary = deriveWorkspaceActivitySummary({
      workspace,
      threads,
      workspaceProjects,
      runningTerminalIdsByThreadId: {
        "thread-1": ["terminal-1"],
      },
      browserRuntimeTabsById,
      gitStatus: {
        branch: "feature/workspace",
        hasWorkingTreeChanges: true,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 2,
        pr: null,
      },
    });

    expect(summary.items.map((item) => item.kind)).toEqual([
      "pending-approval",
      "running",
      "terminal-busy",
      "git-attention",
      "browser-loading",
      "completed",
      "preview-available",
    ]);
    expect(summary.items[0]?.ownerLabel).toBe("@repo/web");
    expect(summary.items.at(-1)?.ownerLabel).toBeNull();
  });

  it("derives an urgent row badge for pending input and background work", () => {
    const workspace = makeWorkspace();
    const badge = deriveWorkspaceRowBadge({
      workspace,
      threads: [
        makeThread({
          activities: [
            {
              id: "activity-2",
              turnId: TurnId.makeUnsafe("turn-1"),
              tone: "info",
              kind: "user-input.requested",
              summary: "Need input",
              payload: {
                requestId: "request-2",
                questions: [
                  {
                    id: "q-1",
                    header: "Scope",
                    question: "Choose",
                    options: [{ label: "A", description: "A" }],
                  },
                ],
              },
              createdAt: "2026-03-20T00:00:01.000Z",
            } as Thread["activities"][number],
          ],
        }),
      ],
      runningTerminalIdsByThreadId: {},
      browserRuntimeTabsById: {},
    });

    expect(badge).toEqual({
      count: 1,
      tone: "urgent",
    });
  });
});
