import { ProjectId, WorkspaceId, type WorkspaceReadModel } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionWorkspaceProjectRepositoryLive } from "../../persistence/Layers/ProjectionWorkspaceProjects.ts";
import { ProjectionWorkspaceRepositoryLive } from "../../persistence/Layers/ProjectionWorkspaces.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionWorkspaceRepository } from "../../persistence/Services/ProjectionWorkspaces.ts";
import { WorkspaceSnapshotQuery } from "../Services/WorkspaceSnapshotQuery.ts";
import { WorkspaceCommandService } from "../Services/WorkspaceCommandService.ts";
import { WorkspaceCommandServiceLive } from "./WorkspaceCommandService.ts";

const emptyWorkspaceReadModel = {
  snapshotSequence: 0,
  workspaces: [],
  workspaceProjects: [],
  updatedAt: "2026-03-22T00:00:00.000Z",
} satisfies WorkspaceReadModel;

const layer = it.layer(
  WorkspaceCommandServiceLive.pipe(
    Layer.provideMerge(
      Layer.succeed(WorkspaceSnapshotQuery, {
        getSnapshot: () => Effect.succeed(emptyWorkspaceReadModel),
      }),
    ),
    Layer.provideMerge(ProjectionProjectRepositoryLive),
    Layer.provideMerge(ProjectionWorkspaceRepositoryLive),
    Layer.provideMerge(ProjectionWorkspaceProjectRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

layer("WorkspaceCommandServiceLive", (it) => {
  it.effect("reuses the legacy project root when creating a root workspace", () =>
    Effect.gen(function* () {
      const projectRepository = yield* ProjectionProjectRepository;
      const workspaceRepository = yield* ProjectionWorkspaceRepository;
      const workspaceCommandService = yield* WorkspaceCommandService;
      const projectId = ProjectId.makeUnsafe("project-1");
      const legacyRootWorkspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");

      yield* projectRepository.upsert({
        projectId,
        title: "Project 1",
        workspaceRoot: "/tmp/project-1",
        defaultModel: "gpt-5-codex",
        scripts: [],
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        deletedAt: null,
      });

      yield* workspaceRepository.upsert({
        workspaceId: legacyRootWorkspaceId,
        projectId,
        title: "Project 1",
        source: "root",
        contextKey: "project-default",
        parentWorkspaceId: null,
        rootWorkspaceId: legacyRootWorkspaceId,
        originRepoKey: "repo:project-1",
        workspaceRoot: "/tmp/project-1",
        worktreePath: null,
        panes: [],
        terminalGroups: [],
        browserTabs: [],
        detectedDevServerUrls: [],
        layout: {
          paneOrder: [],
          activePaneId: null,
        },
        lastFocusedPaneId: null,
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        deletedAt: null,
      });

      const result = yield* workspaceCommandService.dispatch({
        type: "workspace.create",
        projectId,
        source: "root",
        createdAt: "2026-03-22T00:00:00.000Z",
      });

      const workspaces = yield* workspaceRepository.listByProjectId({ projectId });

      assert.equal(result.workspaceId, legacyRootWorkspaceId);
      assert.equal(workspaces.length, 1);
      assert.deepStrictEqual(
        workspaces.map((workspace) => ({
          workspaceId: workspace.workspaceId,
          source: workspace.source,
          contextKey: workspace.contextKey,
          rootWorkspaceId: workspace.rootWorkspaceId,
        })),
        [
          {
            workspaceId: legacyRootWorkspaceId,
            source: "root",
            contextKey: "root",
            rootWorkspaceId: legacyRootWorkspaceId,
          },
        ],
      );
    }),
  );
});
