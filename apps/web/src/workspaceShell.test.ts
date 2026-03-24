import {
  ProjectId,
  ThreadId,
  WorkspaceId,
  type WorkspaceProjectSurface,
  type WorkspaceSurface,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildFilePaneId,
  listChildWorkspaces,
  listRootWorkspaces,
  listWorkspaceThreadIds,
  listWorkspaceThreadStripIds,
  listWorkspaceThreadClusters,
  listWorkspaceProjectScopes,
  normalizeThreadWorkspaceProjectId,
  normalizeWorkspacePaneState,
  parseFilePaneInfo,
  reconcileWorkspacePaneState,
  resolveDefaultPaneTier,
  resolveDefaultWorkspaceId,
  resolveDefaultWorkspaceProjectId,
  resolveEffectivePaneTier,
  resolveResponsibleWorkspaceThreadId,
  resolveThreadOwnershipLabel,
  resolveWorkspaceFamilySelection,
  resolveWorkspacePreferredPaneId,
  sortPaneIdsByTier,
} from "./workspaceShell";

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
    browserTabs: [],
    detectedDevServerUrls: [],
    panes: [],
    layout: {
      paneOrder: ["chat:thread-1", "browser:browser-tab-1", "chat:thread-2"],
      activePaneId: "browser:browser-tab-1",
    },
    lastFocusedPaneId: "chat:thread-2",
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

describe("workspaceShell helpers", () => {
  it("prefers the last focused pane when the active pane is unavailable", () => {
    expect(
      resolveWorkspacePreferredPaneId({
        paneOrder: ["chat:thread-1", "chat:thread-2"],
        activePaneId: "browser:browser-tab-1",
        lastFocusedPaneId: "chat:thread-2",
      }),
    ).toBe("chat:thread-2");
  });

  it("reconciles local pane state against persisted workspace panes", () => {
    const workspace = {
      ...makeWorkspace(),
      linkedThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
      panes: [
        {
          id: "chat:thread-1",
          kind: "chat" as const,
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
          kind: "browser" as const,
          title: "Preview",
          threadId: null,
          terminalGroupId: null,
          browserTabId: "browser-tab-1",
          filePath: null,
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      ],
      layout: {
        paneOrder: ["browser:browser-tab-1", "chat:thread-1"],
        activePaneId: "browser:browser-tab-1",
      },
      lastFocusedPaneId: "chat:thread-1",
    };

    expect(
      reconcileWorkspacePaneState({
        workspace,
        shellState: {
          openThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
          paneOrder: [
            "chat:thread-2",
            "browser:missing-tab",
            "browser:browser-tab-1",
            "chat:thread-1",
          ],
          activePaneId: "browser:missing-tab",
          paneTierById: {},
        },
      }),
    ).toEqual({
      openThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
      paneOrder: ["browser:browser-tab-1", "chat:thread-1", "chat:thread-2"],
      activePaneId: "browser:browser-tab-1",
      paneTierById: {},
    });
  });

  it("resolves the responsible thread from active pane, last focused pane, then pane order", () => {
    const workspace = makeWorkspace();
    const threads = [
      {
        id: ThreadId.makeUnsafe("thread-1"),
        workspaceId: workspace.id,
      },
      {
        id: ThreadId.makeUnsafe("thread-2"),
        workspaceId: workspace.id,
      },
    ];

    expect(
      resolveResponsibleWorkspaceThreadId({
        workspace,
        threads,
        paneState: {
          paneOrder: ["chat:thread-1", "chat:thread-2"],
          activePaneId: "chat:thread-1",
        },
      }),
    ).toBe(ThreadId.makeUnsafe("thread-1"));

    expect(
      resolveResponsibleWorkspaceThreadId({
        workspace,
        threads,
        paneState: {
          paneOrder: ["chat:thread-1", "chat:thread-2"],
          activePaneId: "browser:browser-tab-1",
        },
      }),
    ).toBe(ThreadId.makeUnsafe("thread-2"));
  });

  it("caps oversized chat pane layouts while preserving the active pane", () => {
    const paneOrder = Array.from({ length: 20 }, (_, index) => `chat:thread-${index + 1}`);

    const next = normalizeWorkspacePaneState({
      paneOrder,
      activePaneId: "chat:thread-3",
    });

    expect(next.paneOrder).toHaveLength(12);
    expect(next.paneOrder).toContain("chat:thread-3");
    expect(next.activePaneId).toBe("chat:thread-3");
  });

  it("keeps open chat panes visible in the thread strip even outside the active category", () => {
    expect(
      listWorkspaceThreadStripIds({
        paneOrder: ["chat:thread-2", "browser:preview-1", "chat:thread-3"],
        categoryThreadIds: [ThreadId.makeUnsafe("thread-1"), ThreadId.makeUnsafe("thread-2")],
      }),
    ).toEqual([
      ThreadId.makeUnsafe("thread-2"),
      ThreadId.makeUnsafe("thread-3"),
      ThreadId.makeUnsafe("thread-1"),
    ]);
  });

  it("prefers repo-root workspaces over saved views for default navigation", () => {
    const rootWorkspace = makeWorkspace();
    const savedViewWorkspace: WorkspaceSurface = {
      ...rootWorkspace,
      id: WorkspaceId.makeUnsafe("workspace:project-1:view"),
      title: "Debug layout",
      source: "manual-view",
      contextKey: null,
    };

    expect(resolveDefaultWorkspaceId([savedViewWorkspace, rootWorkspace])).toBe(rootWorkspace.id);
  });

  it("builds workspace families from root and child workspace relationships", () => {
    const rootWorkspace = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-1:root"),
      source: "root" as const,
      parentWorkspaceId: null,
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:root"),
    };
    const worktreeWorkspace: WorkspaceSurface = {
      ...rootWorkspace,
      id: WorkspaceId.makeUnsafe("workspace:project-1:web-worktree"),
      title: "viewer-web",
      source: "worktree",
      parentWorkspaceId: rootWorkspace.id,
      rootWorkspaceId: rootWorkspace.id,
      worktreePath: "/tmp/project-viewer-web",
    };
    const pullRequestWorkspace: WorkspaceSurface = {
      ...rootWorkspace,
      id: WorkspaceId.makeUnsafe("workspace:project-1:pr-42"),
      title: "PR #42",
      source: "pull-request",
      parentWorkspaceId: rootWorkspace.id,
      rootWorkspaceId: rootWorkspace.id,
      worktreePath: "/tmp/project-pr-42",
    };
    const savedViewWorkspace: WorkspaceSurface = {
      ...rootWorkspace,
      id: WorkspaceId.makeUnsafe("workspace:project-1:view"),
      title: "Debug view",
      source: "manual-view",
      parentWorkspaceId: null,
      rootWorkspaceId: rootWorkspace.id,
    };

    expect(listRootWorkspaces([savedViewWorkspace, worktreeWorkspace, rootWorkspace])).toEqual([
      rootWorkspace,
    ]);
    expect(
      listChildWorkspaces({
        rootWorkspaceId: rootWorkspace.id,
        workspaces: [savedViewWorkspace, pullRequestWorkspace, worktreeWorkspace, rootWorkspace],
      }).map((workspace) => workspace.id),
    ).toEqual([worktreeWorkspace.id, pullRequestWorkspace.id]);
    expect(
      resolveWorkspaceFamilySelection({
        workspaceId: worktreeWorkspace.id,
        workspaces: [savedViewWorkspace, pullRequestWorkspace, worktreeWorkspace, rootWorkspace],
      }),
    ).toMatchObject({
      rootWorkspace: rootWorkspace,
      activeChildWorkspace: worktreeWorkspace,
      childWorkspaces: [worktreeWorkspace, pullRequestWorkspace],
    });
  });

  it("deduplicates legacy and imported repo roots for the same project", () => {
    const legacyRootWorkspace: WorkspaceSurface = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
      source: "root",
      contextKey: "project-default",
      parentWorkspaceId: null,
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
      createdAt: "2026-03-20T00:00:00.000Z",
    };
    const importedRootWorkspace: WorkspaceSurface = {
      ...legacyRootWorkspace,
      id: WorkspaceId.makeUnsafe("workspace:project-1:import-root"),
      contextKey: "root",
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:import-root"),
      createdAt: "2026-03-21T00:00:00.000Z",
    };

    expect(listRootWorkspaces([importedRootWorkspace, legacyRootWorkspace])).toEqual([
      legacyRootWorkspace,
    ]);
    expect(
      resolveWorkspaceFamilySelection({
        workspaceId: importedRootWorkspace.id,
        workspaces: [importedRootWorkspace, legacyRootWorkspace],
      }).rootWorkspace?.id,
    ).toBe(legacyRootWorkspace.id);
  });

  it("hides nested repo roots from the top-level repo strip", () => {
    const clawbusterRootWorkspace: WorkspaceSurface = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-1:clawbuster"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Clawbuster",
      source: "root",
      contextKey: "root",
      workspaceRoot: "/Users/emanuelcatuogno/Developer/Clawbuster",
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:clawbuster"),
    };
    const serverRootWorkspace: WorkspaceSurface = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-2:server"),
      projectId: ProjectId.makeUnsafe("project-2"),
      title: "server",
      source: "root",
      contextKey: "root",
      workspaceRoot: "/Users/emanuelcatuogno/Developer/Clawbuster/server",
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-2:server"),
    };
    const webRootWorkspace: WorkspaceSurface = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-3:web"),
      projectId: ProjectId.makeUnsafe("project-3"),
      title: "web",
      source: "root",
      contextKey: "root",
      workspaceRoot: "/Users/emanuelcatuogno/Developer/Clawbuster/web",
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-3:web"),
    };
    const siblingRootWorkspace: WorkspaceSurface = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-4:other"),
      projectId: ProjectId.makeUnsafe("project-4"),
      title: "Other Repo",
      source: "root",
      contextKey: "root",
      workspaceRoot: "/Users/emanuelcatuogno/Developer/OtherRepo",
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-4:other"),
    };

    expect(
      listRootWorkspaces([
        serverRootWorkspace,
        clawbusterRootWorkspace,
        webRootWorkspace,
        siblingRootWorkspace,
      ]),
    ).toEqual([clawbusterRootWorkspace, siblingRootWorkspace]);
  });

  it("surfaces monorepo apps ahead of root and package scopes", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const workspaceProjects = [
      ...makeWorkspaceProjects(),
      {
        id: "workspace-project:apps:ios" as any,
        workspaceId,
        title: "@repo/ios",
        path: "apps/ios",
        kind: "app" as const,
        contextKey: "path:apps/ios",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: "workspace-project:packages:types" as any,
        workspaceId,
        title: "@repo/types",
        path: "packages/types",
        kind: "package" as const,
        contextKey: "path:packages/types",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        deletedAt: null,
      },
    ];

    expect(
      listWorkspaceProjectScopes({
        workspaceId,
        workspaceProjects,
      }).map((workspaceProject) => workspaceProject.title),
    ).toEqual(["@repo/ios", "@repo/web"]);
    expect(
      resolveDefaultWorkspaceProjectId({
        workspaceId,
        workspaceProjects,
      }),
    ).toBe("workspace-project:apps:ios");
  });

  it("treats root-project threads as repo threads and keeps app threads separate", () => {
    const workspace = makeWorkspace();
    const workspaceProjects = makeWorkspaceProjects();
    const threads = [
      {
        id: ThreadId.makeUnsafe("thread-1"),
        codexThreadId: null,
        projectId: ProjectId.makeUnsafe("project-1"),
        workspaceId: workspace.id,
        workspaceProjectId: "workspace-project:root" as any,
        title: "Repo thread",
        model: "gpt-5-codex",
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
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
      },
      {
        id: ThreadId.makeUnsafe("thread-2"),
        codexThreadId: null,
        projectId: ProjectId.makeUnsafe("project-1"),
        workspaceId: workspace.id,
        workspaceProjectId: "workspace-project:apps:web" as any,
        title: "App thread",
        model: "gpt-5-codex",
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
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
      },
    ];

    expect(
      listWorkspaceThreadIds({
        workspace,
        threads,
        draftThreadsByThreadId: {},
        workspaceProjects,
        workspaceProjectId: null,
      }),
    ).toEqual([ThreadId.makeUnsafe("thread-1")]);
    expect(
      listWorkspaceThreadIds({
        workspace,
        threads,
        draftThreadsByThreadId: {},
        workspaceProjects,
        workspaceProjectId: "workspace-project:apps:web" as any,
      }),
    ).toEqual([ThreadId.makeUnsafe("thread-2")]);
    expect(
      normalizeThreadWorkspaceProjectId({
        workspaceProjectId: "workspace-project:root" as any,
        workspaceProjects,
      }),
    ).toBeNull();
    expect(
      resolveThreadOwnershipLabel({
        workspaceProjectId: "workspace-project:root" as any,
        workspaceProjects,
      }),
    ).toBe("Repo");
  });

  it("groups thread clusters by global and app contexts in the active workspace", () => {
    const rootWorkspace = {
      ...makeWorkspace(),
      id: WorkspaceId.makeUnsafe("workspace:project-1:root"),
      source: "root" as const,
      parentWorkspaceId: null,
      rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:root"),
    };
    const childWorkspace: WorkspaceSurface = {
      ...rootWorkspace,
      id: WorkspaceId.makeUnsafe("workspace:project-1:worktree"),
      title: "viewer-web",
      source: "worktree",
      parentWorkspaceId: rootWorkspace.id,
      rootWorkspaceId: rootWorkspace.id,
      linkedThreadIds: [ThreadId.makeUnsafe("thread-3")],
      worktreePath: "/tmp/project-viewer-web",
    };
    const workspaceProjects = makeWorkspaceProjects();
    const threads = [
      {
        id: ThreadId.makeUnsafe("thread-1"),
        workspaceId: rootWorkspace.id,
        workspaceProjectId: "workspace-project:root" as any,
        createdAt: "2026-03-20T00:00:00.000Z",
      },
      {
        id: ThreadId.makeUnsafe("thread-2"),
        workspaceId: rootWorkspace.id,
        workspaceProjectId: "workspace-project:apps:web" as any,
        createdAt: "2026-03-21T00:00:00.000Z",
      },
      {
        id: ThreadId.makeUnsafe("thread-3"),
        workspaceId: childWorkspace.id,
        workspaceProjectId: null,
        createdAt: "2026-03-22T00:00:00.000Z",
      },
    ] as any;

    expect(
      listWorkspaceThreadClusters({
        activeWorkspaceId: childWorkspace.id,
        workspaces: [rootWorkspace, childWorkspace],
        threads,
        draftThreadsByThreadId: {},
        workspaceProjects,
      }),
    ).toEqual([
      {
        id: `${childWorkspace.id}:workspace`,
        workspaceId: childWorkspace.id,
        workspaceProjectId: null,
        label: "Global",
        caption: "Worktree",
        threadIds: [ThreadId.makeUnsafe("thread-3")],
        isRoot: false,
      },
    ]);
  });

  it("resolveDefaultPaneTier assigns sensible defaults by pane ID prefix", () => {
    expect(resolveDefaultPaneTier("chat:thread-1")).toBe("project");
    expect(resolveDefaultPaneTier("browser:tab-1")).toBe("ephemeral");
    expect(resolveDefaultPaneTier("files:workspace-1")).toBe("workspace");
    expect(resolveDefaultPaneTier("unknown:pane")).toBe("project");
  });

  it("resolveEffectivePaneTier respects explicit overrides and falls back to defaults", () => {
    const paneTierById = { "chat:thread-1": "workspace" as const };
    expect(resolveEffectivePaneTier("chat:thread-1", paneTierById)).toBe("workspace");
    expect(resolveEffectivePaneTier("chat:thread-2", paneTierById)).toBe("project");
    expect(resolveEffectivePaneTier("browser:tab-1", paneTierById)).toBe("ephemeral");
  });

  it("sortPaneIdsByTier groups panes by tier while preserving relative order within each tier", () => {
    const paneTierById = {
      "chat:thread-1": "workspace" as const,
      "browser:tab-1": "project" as const,
    };
    const sorted = sortPaneIdsByTier(
      ["browser:tab-1", "chat:thread-2", "chat:thread-1", "browser:tab-2"],
      paneTierById,
    );
    expect(sorted).toEqual([
      "chat:thread-1",   // workspace (explicit)
      "browser:tab-1",   // project (explicit override from ephemeral)
      "chat:thread-2",   // project (default)
      "browser:tab-2",   // ephemeral (default)
    ]);
  });

  it("evicts the oldest ephemeral panes when exceeding the cap", () => {
    const paneOrder = Array.from({ length: 10 }, (_, index) => `browser:tab-${index + 1}`);
    const next = normalizeWorkspacePaneState({
      paneOrder,
      activePaneId: "browser:tab-3",
    });

    expect(next.paneOrder).toHaveLength(6);
    expect(next.paneOrder).toContain("browser:tab-3"); // active pane preserved
    expect(next.paneOrder).toContain("browser:tab-10"); // newest preserved
    expect(next.paneOrder).not.toContain("browser:tab-1"); // oldest evicted
  });

  it("never evicts workspace or project tier panes during ephemeral eviction", () => {
    const paneOrder = [
      "chat:thread-1",
      ...Array.from({ length: 10 }, (_, index) => `browser:tab-${index + 1}`),
    ];
    const paneTierById = { "chat:thread-1": "workspace" as const };
    const next = normalizeWorkspacePaneState({
      paneOrder,
      activePaneId: "browser:tab-5",
      paneTierById,
    });

    expect(next.paneOrder).toContain("chat:thread-1"); // workspace tier never evicted
    expect(next.paneOrder).toContain("browser:tab-5"); // active pane preserved
    const ephemeralCount = next.paneOrder.filter((id) => id.startsWith("browser:")).length;
    expect(ephemeralCount).toBe(6); // at the cap
  });

  it("reconcileWorkspacePaneState builds paneTierById from persisted pane tiers", () => {
    const workspace = {
      ...makeWorkspace(),
      panes: [
        {
          id: "browser:browser-tab-1",
          kind: "browser" as const,
          title: "Preview",
          threadId: null,
          terminalGroupId: null,
          browserTabId: "browser-tab-1",
          filePath: null,
          tier: "workspace" as const,
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      ],
      layout: {
        paneOrder: ["browser:browser-tab-1", "chat:thread-1"],
        activePaneId: "browser:browser-tab-1",
      },
      lastFocusedPaneId: null,
    };

    const result = reconcileWorkspacePaneState({ workspace });
    expect(result.paneTierById["browser:browser-tab-1"]).toBe("workspace");
  });

  it("buildFilePaneId and parseFilePaneInfo round-trip correctly", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const paneId = buildFilePaneId(workspaceId, "src/main.ts");
    expect(paneId).toBe("file:workspace:project-1:root||src/main.ts");

    const info = parseFilePaneInfo(paneId);
    expect(info).toEqual({
      workspaceId: "workspace:project-1:root",
      relativePath: "src/main.ts",
    });
  });

  it("parseFilePaneInfo rejects legacy files: prefix panes", () => {
    expect(parseFilePaneInfo("files:workspace:project-1:root")).toBeNull();
  });

  it("parseFilePaneInfo rejects invalid pane IDs", () => {
    expect(parseFilePaneInfo("chat:thread-1")).toBeNull();
    expect(parseFilePaneInfo("file:")).toBeNull();
    expect(parseFilePaneInfo("file:workspace-only")).toBeNull();
  });

  it("resolveDefaultPaneTier returns ephemeral for file pane IDs", () => {
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:root");
    const filePaneId = buildFilePaneId(workspaceId, "src/index.ts");
    expect(resolveDefaultPaneTier(filePaneId)).toBe("ephemeral");
  });

  it("resolveDefaultPaneTier returns workspace for legacy files pane IDs", () => {
    expect(resolveDefaultPaneTier("files:workspace:project-1:root")).toBe("workspace");
  });
});
