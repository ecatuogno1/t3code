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

  const upsertProjectionThreadGroupRow = SqlSchema.void({
    Request: ProjectionThreadGroup,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_groups (
          group_id,
          project_id,
          title,
          color,
          collapsed,
          order_index,
          created_at,
          updated_at
        )
        VALUES (
          ${row.groupId},
          ${row.projectId},
          ${row.title},
          ${row.color},
          ${row.collapsed ? 1 : 0},
          ${row.orderIndex},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (group_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          color = excluded.color,
          collapsed = excluded.collapsed,
          order_index = excluded.order_index,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionThreadGroupRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadGroupInput,
    Result: ProjectionThreadGroup,
    execute: ({ groupId }) =>
      sql`
        SELECT
          group_id AS "groupId",
          project_id AS "projectId",
          title,
          color,
          collapsed,
          order_index AS "orderIndex",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_groups
        WHERE group_id = ${groupId}
      `,
  });

  const listProjectionThreadGroupRows = SqlSchema.findAll({
    Request: ListProjectionThreadGroupsByProjectInput,
    Result: ProjectionThreadGroup,
    execute: ({ projectId }) =>
      sql`
        SELECT
          group_id AS "groupId",
          project_id AS "projectId",
          title,
          color,
          collapsed,
          order_index AS "orderIndex",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_groups
        WHERE project_id = ${projectId}
        ORDER BY order_index ASC, group_id ASC
      `,
  });

  const deleteProjectionThreadGroupRow = SqlSchema.void({
    Request: DeleteProjectionThreadGroupInput,
    execute: ({ groupId }) =>
      sql`
        DELETE FROM projection_thread_groups
        WHERE group_id = ${groupId}
      `,
  });

  const upsert: ProjectionThreadGroupRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadGroupRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.upsert:query")),
    );

  const getById: ProjectionThreadGroupRepositoryShape["getById"] = (input) =>
    getProjectionThreadGroupRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadGroupRepository.getById:query")),
    );

  const listByProjectId: ProjectionThreadGroupRepositoryShape["listByProjectId"] = (input) =>
    listProjectionThreadGroupRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadGroupRepository.listByProjectId:query"),
      ),
    );

  const deleteById: ProjectionThreadGroupRepositoryShape["deleteById"] = (input) =>
    deleteProjectionThreadGroupRow(input).pipe(
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
