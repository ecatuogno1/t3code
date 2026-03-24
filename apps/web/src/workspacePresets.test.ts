import {
  ProjectId,
  ThreadId,
  TurnId,
  WorkspaceId,
  type WorkspaceSurface,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveWorkspacePresetPlan } from "./workspacePresets";
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
    linkedThreadIds: [ThreadId.makeUnsafe("thread-1")],
    terminalGroups: [],
    browserTabs: [
      {
        id: "browser-tab-pr",
        url: "https://github.com/t3tools/t3code/pull/42",
        title: "Pull Request",
        workspaceProjectId: null,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    detectedDevServerUrls: ["http://localhost:3000"],
    panes: [],
    layout: {
      paneOrder: ["chat:thread-1"],
      activePaneId: "chat:thread-1",
    },
    lastFocusedPaneId: "chat:thread-1",
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("workspacePresets", () => {
  it("uses preview context for agent build", () => {
    const plan = resolveWorkspacePresetPlan({
      presetId: "agent-build",
      workspace: makeWorkspace(),
      threads: [makeThread()],
      responsibleThreadId: ThreadId.makeUnsafe("thread-1"),
    });

    expect(plan).toMatchObject({
      focusThreadId: ThreadId.makeUnsafe("thread-1"),
      ensureFilesPane: true,
      browserTarget: {
        url: "http://localhost:3000",
        title: "Preview",
      },
      openDiffForThreadId: null,
    });
  });

  it("uses pull request context and diff for pr review when diff data exists", () => {
    const plan = resolveWorkspacePresetPlan({
      presetId: "pr-review",
      workspace: makeWorkspace(),
      threads: [
        makeThread({
          turnDiffSummaries: [
            {
              turnId: TurnId.makeUnsafe("turn-1"),
              completedAt: "2026-03-20T00:00:02.000Z",
              files: [],
            },
          ],
        }),
      ],
      responsibleThreadId: ThreadId.makeUnsafe("thread-1"),
    });

    expect(plan.browserTarget).toEqual({
      url: "https://github.com/t3tools/t3code/pull/42",
      title: "Pull Request",
    });
    expect(plan.openDiffForThreadId).toBe(ThreadId.makeUnsafe("thread-1"));
  });

  it("keeps diff closed for bug hunt", () => {
    const plan = resolveWorkspacePresetPlan({
      presetId: "bug-hunt",
      workspace: makeWorkspace(),
      threads: [makeThread()],
      responsibleThreadId: ThreadId.makeUnsafe("thread-1"),
    });

    expect(plan.openDiffForThreadId).toBeNull();
  });
});
