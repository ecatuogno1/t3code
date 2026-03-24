import { Schema } from "effect";

import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

export const ThreadCategorizationRequest = Schema.Struct({
  projectId: ProjectId,
  model: Schema.optional(TrimmedNonEmptyString),
  maxThreads: Schema.optional(NonNegativeInt),
});
export type ThreadCategorizationRequest = typeof ThreadCategorizationRequest.Type;

export const ThreadCategorizationResult = Schema.Struct({
  updatedThreadIds: Schema.Array(ThreadId),
  processedCount: NonNegativeInt,
  hasMore: Schema.Boolean,
});
export type ThreadCategorizationResult = typeof ThreadCategorizationResult.Type;
