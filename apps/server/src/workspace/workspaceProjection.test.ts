import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId, WorkspaceId, type WorkspaceSurface } from "@t3tools/contracts";

import { applyWorkspaceCommandToProjection } from "./workspaceProjection.ts";

function makeWorkspace(): WorkspaceSurface {
  return {
    id: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Project 1",
    source: "project-default",
    contextKey: "project-default",
    workspaceRoot: "/tmp/project",
    worktreePath: null,
    linkedThreadIds: [],
    terminalGroups: [],
    browserTabs: [
      {
        id: "browser-tab-1",
        url: "https://example.com",
        title: "Example",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    detectedDevServerUrls: ["http://localhost:3000"],
    panes: [
      {
        id: "chat:thread-1",
        kind: "chat",
        title: "Thread 1",
        threadId: ThreadId.makeUnsafe("thread-1"),
        terminalGroupId: null,
        browserTabId: null,
        filePath: null,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
      {
        id: "browser:browser-tab-1",
        kind: "browser",
        title: "Example",
        threadId: null,
        terminalGroupId: null,
        browserTabId: "browser-tab-1",
        filePath: null,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ],
    layout: {
      paneOrder: ["chat:thread-1", "browser:browser-tab-1"],
      activePaneId: "browser:browser-tab-1",
    },
    lastFocusedPaneId: "browser:browser-tab-1",
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("workspaceProjection", () => {
  it("removes browser panes from layout when removing a browser tab", () => {
    const next = applyWorkspaceCommandToProjection({
      workspace: makeWorkspace(),
      command: {
        type: "workspace.browserTab.remove",
        workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
        browserTabId: "browser-tab-1",
        updatedAt: "2026-03-20T01:00:00.000Z",
      },
    });

    expect(next.browserTabs).toEqual([]);
    expect(next.panes.map((pane) => pane.id)).toEqual(["chat:thread-1"]);
    expect(next.layout).toEqual({
      paneOrder: ["chat:thread-1"],
      activePaneId: "chat:thread-1",
    });
    expect(next.lastFocusedPaneId).toBe("chat:thread-1");
  });

  it("sanitizes pane order during layout updates", () => {
    const next = applyWorkspaceCommandToProjection({
      workspace: makeWorkspace(),
      command: {
        type: "workspace.layout.update",
        workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
        paneOrder: ["browser:browser-tab-1", "missing-pane", "chat:thread-1"],
        activePaneId: "missing-pane",
        lastFocusedPaneId: "missing-pane",
        updatedAt: "2026-03-20T01:00:00.000Z",
      },
    });

    expect(next.layout).toEqual({
      paneOrder: ["browser:browser-tab-1", "chat:thread-1"],
      activePaneId: "chat:thread-1",
    });
    expect(next.lastFocusedPaneId).toBe("chat:thread-1");
  });
});
