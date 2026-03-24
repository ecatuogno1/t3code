import { ProjectId, ThreadId, WorkspaceId, type OrchestrationReadModel } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionWorkspaceProjectRepositoryLive } from "../../persistence/Layers/ProjectionWorkspaceProjects.ts";
import { ProjectionWorkspaceRepositoryLive } from "../../persistence/Layers/ProjectionWorkspaces.ts";
import { ProjectionWorkspaceRepository } from "../../persistence/Services/ProjectionWorkspaces.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorkspaceSnapshotQuery } from "../Services/WorkspaceSnapshotQuery.ts";
import { WorkspaceSnapshotQueryLive } from "./WorkspaceSnapshotQuery.ts";

const layer = it.layer(
  WorkspaceSnapshotQueryLive.pipe(
    Layer.provideMerge(ProjectionWorkspaceProjectRepositoryLive),
    Layer.provideMerge(ProjectionWorkspaceRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(
      Layer.succeed(ProjectionSnapshotQuery, {
        getSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 7,
            projects: [],
            threads: [
              {
                id: ThreadId.makeUnsafe("thread-1"),
                projectId: ProjectId.makeUnsafe("project-1"),
                workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
                workspaceProjectId:
                  "workspace-project:workspace:project-1:project-root:root" as any,
                title: "Thread 1",
                model: "gpt-5-codex",
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                groupId: null,
                latestTurn: null,
                createdAt: "2026-03-20T00:00:00.000Z",
                updatedAt: "2026-03-20T00:00:00.000Z",
                deletedAt: null,
                messages: [],
                proposedPlans: [],
                activities: [],
                checkpoints: [],
                session: null,
              },
            ],
            threadGroups: [],
            projectMemories: [],
            updatedAt: "2026-03-20T00:00:00.000Z",
          } satisfies OrchestrationReadModel),
      }),
    ),
  ),
);

layer("WorkspaceSnapshotQuery", (it) => {
  it.effect("hydrates persisted workspaces and links active thread ids", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionWorkspaceRepository;
      const query = yield* WorkspaceSnapshotQuery;

      yield* repository.upsert({
        workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Project 1",
        source: "root",
        contextKey: "root",
        parentWorkspaceId: null,
        rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
        originRepoKey: "repo:project-1",
        workspaceRoot: "/tmp/project-1",
        worktreePath: null,
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
        ],
        terminalGroups: [],
        browserTabs: [],
        detectedDevServerUrls: [],
        layout: {
          paneOrder: ["chat:thread-1"],
          activePaneId: "chat:thread-1",
        },
        lastFocusedPaneId: "chat:thread-1",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
        deletedAt: null,
      });

      const snapshot = yield* query.getSnapshot();

      assert.equal(snapshot.snapshotSequence, 7);
      assert.deepEqual(snapshot.workspaces, [
        {
          id: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Project 1",
          source: "root",
          contextKey: "root",
          parentWorkspaceId: null,
          rootWorkspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
          originRepoKey: "repo:project-1",
          workspaceRoot: "/tmp/project-1",
          worktreePath: null,
          linkedThreadIds: [ThreadId.makeUnsafe("thread-1")],
          terminalGroups: [],
          browserTabs: [],
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
              createdAt: "2026-03-20T00:00:00.000Z",
              updatedAt: "2026-03-20T00:00:00.000Z",
            },
          ],
          layout: {
            paneOrder: ["chat:thread-1"],
            activePaneId: "chat:thread-1",
          },
          lastFocusedPaneId: "chat:thread-1",
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
          deletedAt: null,
        },
      ]);
      assert.deepEqual(snapshot.workspaceProjects, [
        {
          id: "workspace-project:workspace:project-1:project-root:root" as any,
          workspaceId: WorkspaceId.makeUnsafe("workspace:project-1:project-root"),
          title: "project-1",
          path: "",
          kind: "root",
          contextKey: "root",
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
          deletedAt: null,
        },
      ]);
    }),
  );
});
