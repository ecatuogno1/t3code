import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer, Option } from "effect";

import { toPersistenceSqlError, type ProjectionRepositoryError } from "../Errors.ts";
import {
  ProjectionWorkspaceProjectRepository,
  type ProjectionWorkspaceProject,
  type ProjectionWorkspaceProjectRepositoryShape,
} from "../Services/ProjectionWorkspaceProjects.ts";

type ProjectionWorkspaceProjectDbRow = {
  readonly workspaceProjectId: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly path: string;
  readonly kind: string;
  readonly contextKey: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
};

function decodeRow(
  row: ProjectionWorkspaceProjectDbRow,
): Effect.Effect<ProjectionWorkspaceProject, ProjectionRepositoryError> {
  return Effect.succeed({
    workspaceProjectId: row.workspaceProjectId as ProjectionWorkspaceProject["workspaceProjectId"],
    workspaceId: row.workspaceId as ProjectionWorkspaceProject["workspaceId"],
    title: row.title as ProjectionWorkspaceProject["title"],
    path: row.path,
    kind: row.kind as ProjectionWorkspaceProject["kind"],
    contextKey: row.contextKey as ProjectionWorkspaceProject["contextKey"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

const makeProjectionWorkspaceProjectRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsert: ProjectionWorkspaceProjectRepositoryShape["upsert"] = (row) =>
    sql`
      INSERT INTO projection_workspace_projects (
        workspace_project_id,
        workspace_id,
        title,
        path,
        kind,
        context_key,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        ${row.workspaceProjectId},
        ${row.workspaceId},
        ${row.title},
        ${row.path},
        ${row.kind},
        ${row.contextKey},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.deletedAt}
      )
      ON CONFLICT (workspace_project_id)
      DO UPDATE SET
        workspace_id = excluded.workspace_id,
        title = excluded.title,
        path = excluded.path,
        kind = excluded.kind,
        context_key = excluded.context_key,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceProjectRepository.upsert:query")),
    );

  const decodeRows = (
    rows: ReadonlyArray<ProjectionWorkspaceProjectDbRow>,
  ): Effect.Effect<ReadonlyArray<ProjectionWorkspaceProject>, ProjectionRepositoryError> =>
    Effect.forEach(rows, decodeRow, { concurrency: 1 });

  const getById: ProjectionWorkspaceProjectRepositoryShape["getById"] = (input) =>
    sql<ProjectionWorkspaceProjectDbRow>`
      SELECT
        workspace_project_id AS "workspaceProjectId",
        workspace_id AS "workspaceId",
        title,
        path,
        kind,
        context_key AS "contextKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_workspace_projects
      WHERE workspace_project_id = ${input.workspaceProjectId}
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceProjectRepository.getById:query")),
      Effect.flatMap((rows) =>
        rows.length === 0
          ? Effect.succeed(Option.none())
          : decodeRow(rows[0]!).pipe(Effect.map(Option.some)),
      ),
    );

  const list: ProjectionWorkspaceProjectRepositoryShape["list"] = () =>
    sql<ProjectionWorkspaceProjectDbRow>`
      SELECT
        workspace_project_id AS "workspaceProjectId",
        workspace_id AS "workspaceId",
        title,
        path,
        kind,
        context_key AS "contextKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_workspace_projects
      ORDER BY workspace_id ASC, created_at ASC, workspace_project_id ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceProjectRepository.list:query")),
      Effect.flatMap((rows) => decodeRows(rows)),
    );

  const listByWorkspaceId: ProjectionWorkspaceProjectRepositoryShape["listByWorkspaceId"] = (
    input,
  ) =>
    sql<ProjectionWorkspaceProjectDbRow>`
      SELECT
        workspace_project_id AS "workspaceProjectId",
        workspace_id AS "workspaceId",
        title,
        path,
        kind,
        context_key AS "contextKey",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_workspace_projects
      WHERE workspace_id = ${input.workspaceId}
      ORDER BY created_at ASC, workspace_project_id ASC
    `.pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionWorkspaceProjectRepository.listByWorkspaceId:query"),
      ),
      Effect.flatMap((rows) => decodeRows(rows)),
    );

  return {
    upsert,
    getById,
    list,
    listByWorkspaceId,
  } satisfies ProjectionWorkspaceProjectRepositoryShape;
});

export const ProjectionWorkspaceProjectRepositoryLive = Layer.effect(
  ProjectionWorkspaceProjectRepository,
  makeProjectionWorkspaceProjectRepository,
);
