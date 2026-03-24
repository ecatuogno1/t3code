import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetThreadImportSourceInput,
  ThreadImportSource,
  ThreadImportSourceRepository,
  type ThreadImportSourceRepositoryShape,
} from "../Services/ThreadImportSources.ts";

const makeThreadImportSourceRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ThreadImportSource,
    execute: (row) =>
      sql`
        INSERT INTO thread_import_sources (
          provider_name,
          external_session_id,
          source_path,
          thread_id,
          created_at,
          updated_at
        )
        VALUES (
          ${row.providerName},
          ${row.externalSessionId},
          ${row.sourcePath},
          ${row.threadId},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (provider_name, external_session_id, source_path)
        DO UPDATE SET
          thread_id = excluded.thread_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const getBySourceRow = SqlSchema.findOneOption({
    Request: GetThreadImportSourceInput,
    Result: ThreadImportSource,
    execute: ({ providerName, externalSessionId, sourcePath }) =>
      sql`
        SELECT
          provider_name AS "providerName",
          external_session_id AS "externalSessionId",
          source_path AS "sourcePath",
          thread_id AS "threadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM thread_import_sources
        WHERE
          provider_name = ${providerName}
          AND external_session_id = ${externalSessionId}
          AND source_path = ${sourcePath}
      `,
  });

  const listAllRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ThreadImportSource,
    execute: () =>
      sql`
        SELECT
          provider_name AS "providerName",
          external_session_id AS "externalSessionId",
          source_path AS "sourcePath",
          thread_id AS "threadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM thread_import_sources
        ORDER BY updated_at DESC, provider_name ASC, external_session_id ASC
      `,
  });

  const upsert: ThreadImportSourceRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ThreadImportSourceRepository.upsert:query")),
    );

  const getBySource: ThreadImportSourceRepositoryShape["getBySource"] = (input) =>
    getBySourceRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ThreadImportSourceRepository.getBySource:query")),
      Effect.map((row) => Option.getOrNull(row)),
    );

  const listAll: ThreadImportSourceRepositoryShape["listAll"] = () =>
    listAllRows().pipe(
      Effect.mapError(toPersistenceSqlError("ThreadImportSourceRepository.listAll:query")),
    );

  return {
    upsert,
    getBySource,
    listAll,
  } satisfies ThreadImportSourceRepositoryShape;
});

export const ThreadImportSourceRepositoryLive = Layer.effect(
  ThreadImportSourceRepository,
  makeThreadImportSourceRepository,
);
