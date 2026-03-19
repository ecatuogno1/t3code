import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionProjectMemoryInput,
  GetProjectionProjectMemoryInput,
  ListProjectionProjectMemoriesByProjectInput,
  ProjectionProjectMemory,
  ProjectionProjectMemoryRepository,
  type ProjectionProjectMemoryRepositoryShape,
} from "../Services/ProjectionProjectMemories.ts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";

// Makes sure that the tags are parsed from the JSON string the DB returns
const ProjectionProjectMemoryDbRowSchema = ProjectionProjectMemory.mapFields(
  Struct.assign({ tags: Schema.fromJsonString(Schema.Array(TrimmedNonEmptyString)) }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionProjectMemoryRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProjectMemoryRow = SqlSchema.void({
    Request: ProjectionProjectMemoryDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO projection_project_memories (
          memory_id,
          project_id,
          title,
          content,
          kind,
          tags_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.memoryId},
          ${row.projectId},
          ${row.title},
          ${row.content},
          ${row.kind},
          ${row.tags},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (memory_id)
        DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          content = excluded.content,
          kind = excluded.kind,
          tags_json = excluded.tags_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionProjectMemoryRow = SqlSchema.findOneOption({
    Request: GetProjectionProjectMemoryInput,
    Result: ProjectionProjectMemoryDbRowSchema,
    execute: ({ memoryId }) =>
      sql`
        SELECT
          memory_id AS "memoryId",
          project_id AS "projectId",
          title,
          content,
          kind,
          tags_json AS "tags",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_project_memories
        WHERE memory_id = ${memoryId}
      `,
  });

  const listProjectionProjectMemoryRows = SqlSchema.findAll({
    Request: ListProjectionProjectMemoriesByProjectInput,
    Result: ProjectionProjectMemoryDbRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          memory_id AS "memoryId",
          project_id AS "projectId",
          title,
          content,
          kind,
          tags_json AS "tags",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_project_memories
        WHERE project_id = ${projectId}
        ORDER BY created_at ASC, memory_id ASC
      `,
  });

  const deleteProjectionProjectMemoryRow = SqlSchema.void({
    Request: DeleteProjectionProjectMemoryInput,
    execute: ({ memoryId }) =>
      sql`
        DELETE FROM projection_project_memories
        WHERE memory_id = ${memoryId}
      `,
  });

  const upsert: ProjectionProjectMemoryRepositoryShape["upsert"] = (row) =>
    upsertProjectionProjectMemoryRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionProjectMemoryRepository.upsert:query",
          "ProjectionProjectMemoryRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ProjectionProjectMemoryRepositoryShape["getById"] = (input) =>
    getProjectionProjectMemoryRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionProjectMemoryRepository.getById:query",
          "ProjectionProjectMemoryRepository.getById:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Effect.succeed(Option.some(row as Schema.Schema.Type<typeof ProjectionProjectMemory>)),
        }),
      ),
    );

  const listByProjectId: ProjectionProjectMemoryRepositoryShape["listByProjectId"] = (input) =>
    listProjectionProjectMemoryRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionProjectMemoryRepository.listByProjectId:query",
          "ProjectionProjectMemoryRepository.listByProjectId:decodeRows",
        ),
      ),
      Effect.map(
        (rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionProjectMemory>>,
      ),
    );

  const deleteById: ProjectionProjectMemoryRepositoryShape["deleteById"] = (input) =>
    deleteProjectionProjectMemoryRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectMemoryRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listByProjectId,
    deleteById,
  } satisfies ProjectionProjectMemoryRepositoryShape;
});

export const ProjectionProjectMemoryRepositoryLive = Layer.effect(
  ProjectionProjectMemoryRepository,
  makeProjectionProjectMemoryRepository,
);
