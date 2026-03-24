import { ThreadId } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ThreadImportSource = Schema.Struct({
  providerName: Schema.Literals(["codex", "claudeAgent"]),
  externalSessionId: Schema.String,
  sourcePath: Schema.String,
  threadId: ThreadId,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ThreadImportSource = typeof ThreadImportSource.Type;

export const GetThreadImportSourceInput = Schema.Struct({
  providerName: Schema.Literals(["codex", "claudeAgent"]),
  externalSessionId: Schema.String,
  sourcePath: Schema.String,
});
export type GetThreadImportSourceInput = typeof GetThreadImportSourceInput.Type;

export interface ThreadImportSourceRepositoryShape {
  readonly upsert: (row: ThreadImportSource) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getBySource: (
    input: GetThreadImportSourceInput,
  ) => Effect.Effect<ThreadImportSource | null, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ThreadImportSource>,
    ProjectionRepositoryError
  >;
}

export class ThreadImportSourceRepository extends ServiceMap.Service<
  ThreadImportSourceRepository,
  ThreadImportSourceRepositoryShape
>()("t3/persistence/Services/ThreadImportSources/ThreadImportSourceRepository") {}
