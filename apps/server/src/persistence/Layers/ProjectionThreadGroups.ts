import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadGroupInput,
  GetProjectionThreadGroupInput,
  ListProjectionThreadGroupsByProjectInput,
  ProjectionThreadGroup,
  ProjectionThreadGroupRepository,
  type ProjectionThreadGroupRepositoryShape,
} from "../Services/ProjectionThreadGroups.ts";

const makeProjectionThreadGroupRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadGroup,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_groups (
          group_id,
          project_id,
          title,
          color,
          order_index,
          is_collapsed,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.groupId},
          ${row.projectId},
          ${row.title},
          ${row.color},
          ${row.orderIndex},
          ${row.isCollapsed ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (group_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          color = excluded.color,
          order_index = excluded.order_index,
          is_collapsed = excluded.is_collapsed,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadGroupInput,
    Result: ProjectionThreadGroup,
    execute: ({ groupId }) =>
      sql`
        SELECT
          group_id AS "groupId",
          project_id AS "projectId",
          title,
          color,
          order_index AS "orderIndex",
          CASE WHEN is_collapsed = 1 THEN 1 ELSE 0 END AS "isCollapsed",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_thread_groups
        WHERE group_id = ${groupId}
      `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionThreadGroupsByProjectInput,
    Result: ProjectionThreadGroup,
    execute: ({ projectId }) =>
      sql`
        SELECT
          group_id AS "groupId",
          project_id AS "projectId",
          title,
          color,
          order_index AS "orderIndex",
          CASE WHEN is_collapsed = 1 THEN 1 ELSE 0 END AS "isCollapsed",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_thread_groups
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY order_index ASC, created_at ASC
      `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeleteProjectionThreadGroupInput,
    execute: ({ groupId }) =>
      sql`
        DELETE FROM projection_thread_groups
        WHERE group_id = ${groupId}
      `,
  });

  const upsert: ProjectionThreadGroupRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.upsert:query")),
    );

  const getById: ProjectionThreadGroupRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.getById:query")),
    );

  const listByProjectId: ProjectionThreadGroupRepositoryShape["listByProjectId"] = (input) =>
    listRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadGroupRepository.listByProjectId:query"),
      ),
    );

  const deleteById: ProjectionThreadGroupRepositoryShape["deleteById"] = (input) =>
    deleteRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    deleteById,
  } satisfies ProjectionThreadGroupRepositoryShape;
});

export const ProjectionThreadGroupRepositoryLive = Layer.effect(
  ProjectionThreadGroupRepository,
  makeProjectionThreadGroupRepository,
);
