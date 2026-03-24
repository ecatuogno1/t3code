import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ThreadCategorizationRequest, ThreadCategorizationResult } from "@t3tools/contracts";

export class ThreadCategorizationError extends Schema.TaggedErrorClass<ThreadCategorizationError>()(
  "ThreadCategorizationError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface ThreadCategorizationServiceShape {
  readonly categorizeProjectThreads: (
    input: ThreadCategorizationRequest,
  ) => Effect.Effect<ThreadCategorizationResult, ThreadCategorizationError>;
}

export class ThreadCategorizationService extends ServiceMap.Service<
  ThreadCategorizationService,
  ThreadCategorizationServiceShape
>()("t3/threadCategorization/Services/ThreadCategorizationService") {}
