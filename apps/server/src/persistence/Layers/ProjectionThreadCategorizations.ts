import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadCategorizationInput,
  GetProjectionThreadCategorizationInput,
  ProjectionThreadCategorization,
  ProjectionThreadCategorizationRepository,
  type ProjectionThreadCategorizationRepositoryShape,
} from "../Services/ProjectionThreadCategorizations.ts";

const makeProjectionThreadCategorizationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadCategorizationRow = SqlSchema.void({
    Request: ProjectionThreadCategorization,
    execute: (row) =>
      sql`
        INSERT INTO projection_thread_categorizations (
          thread_id,
          label,
          model,
          fingerprint,
          created_at,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.label},
          ${row.model},
          ${row.fingerprint},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          label = excluded.label,
          model = excluded.model,
          fingerprint = excluded.fingerprint,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getProjectionThreadCategorizationRow = SqlSchema.findOne({
    Request: GetProjectionThreadCategorizationInput,
    Result: ProjectionThreadCategorization,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          label,
          model,
          fingerprint,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_categorizations
        WHERE thread_id = ${threadId}
      `,
  });

  const listProjectionThreadCategorizationRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadCategorization,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          label,
          model,
          fingerprint,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_categorizations
      `,
  });

  const deleteProjectionThreadCategorizationRow = SqlSchema.void({
    Request: DeleteProjectionThreadCategorizationInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_thread_categorizations
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProjectionThreadCategorizationRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadCategorizationRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadCategorizationRepository.upsert:query"),
      ),
    );

  const getByThreadId: ProjectionThreadCategorizationRepositoryShape["getByThreadId"] = (input) =>
    getProjectionThreadCategorizationRow(input).pipe(
      Effect.catchTag("NoSuchElementError", () => Effect.succeed(null)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadCategorizationRepository.getByThreadId:query"),
      ),
    );

  const listAll: ProjectionThreadCategorizationRepositoryShape["listAll"] = () =>
    listProjectionThreadCategorizationRows(void 0).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadCategorizationRepository.listAll:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadCategorizationRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteProjectionThreadCategorizationRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadCategorizationRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    listAll,
    deleteByThreadId,
  } satisfies ProjectionThreadCategorizationRepositoryShape;
});

export const ProjectionThreadCategorizationRepositoryLive = Layer.effect(
  ProjectionThreadCategorizationRepository,
  makeProjectionThreadCategorizationRepository,
);
