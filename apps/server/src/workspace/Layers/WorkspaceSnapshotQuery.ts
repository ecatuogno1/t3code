import { WorkspaceReadModel } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError } from "../../persistence/Errors.ts";
import { ProjectionWorkspaceRepository } from "../../persistence/Services/ProjectionWorkspaces.ts";
import { ProjectionWorkspaceProjectRepository } from "../../persistence/Services/ProjectionWorkspaceProjects.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  WorkspaceSnapshotQuery,
  type WorkspaceSnapshotQueryShape,
} from "../Services/WorkspaceSnapshotQuery.ts";
import { syncWorkspaceProjects } from "../workspaceProjects.ts";

const decodeWorkspaceReadModel = Schema.decodeUnknownEffect(WorkspaceReadModel);

const makeWorkspaceSnapshotQuery = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const projectionWorkspaceRepository = yield* ProjectionWorkspaceRepository;
  const projectionWorkspaceProjectRepository = yield* ProjectionWorkspaceProjectRepository;

  const getSnapshot: WorkspaceSnapshotQueryShape["getSnapshot"] = () =>
    Effect.gen(function* () {
      const [orchestrationSnapshot, workspaceRows] = yield* Effect.all([
        projectionSnapshotQuery.getSnapshot(),
        projectionWorkspaceRepository.list(),
      ]);
      const syncedWorkspaceProjects = yield* Effect.forEach(
        workspaceRows,
        (workspaceRow) =>
          projectionWorkspaceProjectRepository
            .listByWorkspaceId({
              workspaceId: workspaceRow.workspaceId,
            })
            .pipe(
              Effect.flatMap((existingProjects) =>
                Effect.promise(() =>
                  syncWorkspaceProjects({
                    workspace: workspaceRow,
                    existingProjects,
                  }),
                ),
              ),
              Effect.flatMap((projects) =>
                Effect.forEach(
                  projects,
                  (project) => projectionWorkspaceProjectRepository.upsert(project),
                  { concurrency: 1 },
                ).pipe(Effect.as(projects)),
              ),
            ),
        { concurrency: 1 },
      ).pipe(Effect.map((groups) => groups.flat()));

      const visibleWorkspaceRows = workspaceRows.filter(
        (workspaceRow) =>
          workspaceRow.source !== "worktree" && workspaceRow.source !== "pull-request",
      );
      const childWorkspaceRows = workspaceRows.filter(
        (workspaceRow) =>
          workspaceRow.source === "worktree" || workspaceRow.source === "pull-request",
      );
      const childRowsByRootId = new Map<string, typeof childWorkspaceRows>();
      for (const childWorkspaceRow of childWorkspaceRows) {
        const existingRows = childRowsByRootId.get(childWorkspaceRow.rootWorkspaceId) ?? [];
        existingRows.push(childWorkspaceRow);
        childRowsByRootId.set(childWorkspaceRow.rootWorkspaceId, existingRows);
      }
      const visibleWorkspaceIds = new Set(
        visibleWorkspaceRows.map((workspaceRow) => workspaceRow.workspaceId),
      );

      const linkedThreadIdsByWorkspace = new Map<string, string[]>();
      for (const thread of orchestrationSnapshot.threads.filter(
        (thread) => thread.deletedAt === null,
      )) {
        const existing = linkedThreadIdsByWorkspace.get(thread.workspaceId) ?? [];
        existing.push(thread.id);
        linkedThreadIdsByWorkspace.set(thread.workspaceId, existing);
      }

      const snapshot = {
        snapshotSequence: orchestrationSnapshot.snapshotSequence,
        workspaces: visibleWorkspaceRows.map((row) => {
          const mergedChildRows = childRowsByRootId.get(row.workspaceId) ?? [];
          const mergedBrowserTabs = [
            ...row.browserTabs.map((browserTab) => ({
              ...browserTab,
              workspaceProjectId: browserTab.workspaceProjectId ?? null,
            })),
            ...mergedChildRows.flatMap((childWorkspaceRow) =>
              childWorkspaceRow.browserTabs.map((browserTab) => ({
                ...browserTab,
                workspaceProjectId: null,
              })),
            ),
          ].filter(
            (browserTab, index, browserTabs) =>
              browserTabs.findIndex(
                (candidate) => candidate.id === browserTab.id || candidate.url === browserTab.url,
              ) === index,
          );
          const mergedDetectedDevServerUrls = Array.from(
            new Set([
              ...row.detectedDevServerUrls,
              ...mergedChildRows.flatMap(
                (childWorkspaceRow) => childWorkspaceRow.detectedDevServerUrls,
              ),
            ]),
          );
          return {
            id: row.workspaceId,
            projectId: row.projectId,
            title: row.title,
            source: row.source,
            contextKey: row.contextKey,
            parentWorkspaceId: row.parentWorkspaceId,
            rootWorkspaceId: row.rootWorkspaceId,
            originRepoKey: row.originRepoKey,
            workspaceRoot: row.workspaceRoot,
            worktreePath: row.worktreePath,
            linkedThreadIds: linkedThreadIdsByWorkspace.get(row.workspaceId) ?? [],
            terminalGroups: row.terminalGroups,
            browserTabs: mergedBrowserTabs,
            detectedDevServerUrls: mergedDetectedDevServerUrls,
            panes: row.panes,
            layout: row.layout,
            lastFocusedPaneId: row.lastFocusedPaneId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          };
        }),
        workspaceProjects: syncedWorkspaceProjects
          .filter((row) => visibleWorkspaceIds.has(row.workspaceId))
          .map((row) => ({
            id: row.workspaceProjectId,
            workspaceId: row.workspaceId,
            title: row.title,
            path: row.path,
            kind: row.kind,
            contextKey: row.contextKey,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          })),
        updatedAt: visibleWorkspaceRows.reduce(
          (latest, row) => (row.updatedAt > latest ? row.updatedAt : latest),
          orchestrationSnapshot.updatedAt,
        ),
      };

      return yield* decodeWorkspaceReadModel(snapshot).pipe(
        Effect.mapError(toPersistenceDecodeError("WorkspaceSnapshotQuery.getSnapshot:decode")),
      );
    });

  return {
    getSnapshot,
  } satisfies WorkspaceSnapshotQueryShape;
});

export const WorkspaceSnapshotQueryLive = Layer.effect(
  WorkspaceSnapshotQuery,
  makeWorkspaceSnapshotQuery,
);
