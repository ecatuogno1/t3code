import { ThreadId } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadCategorization = Schema.Struct({
  threadId: ThreadId,
  label: Schema.String,
  model: Schema.String,
  fingerprint: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectionThreadCategorization = typeof ProjectionThreadCategorization.Type;

export const GetProjectionThreadCategorizationInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetProjectionThreadCategorizationInput =
  typeof GetProjectionThreadCategorizationInput.Type;

export const DeleteProjectionThreadCategorizationInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadCategorizationInput =
  typeof DeleteProjectionThreadCategorizationInput.Type;

export interface ProjectionThreadCategorizationRepositoryShape {
  readonly upsert: (
    row: ProjectionThreadCategorization,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getByThreadId: (
    input: GetProjectionThreadCategorizationInput,
  ) => Effect.Effect<ProjectionThreadCategorization | null, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionThreadCategorization>,
    ProjectionRepositoryError
  >;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadCategorizationInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadCategorizationRepository extends ServiceMap.Service<
  ProjectionThreadCategorizationRepository,
  ProjectionThreadCategorizationRepositoryShape
>()(
  "t3/persistence/Services/ProjectionThreadCategorizations/ProjectionThreadCategorizationRepository",
) {}
