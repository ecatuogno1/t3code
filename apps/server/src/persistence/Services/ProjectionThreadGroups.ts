/**
 * ProjectionThreadGroupRepository - Projection repository interface for thread groups.
 *
 * @module ProjectionThreadGroupRepository
 */
import { IsoDateTime, ProjectId, ThreadGroupId } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadGroup = Schema.Struct({
  groupId: ThreadGroupId,
  projectId: ProjectId,
  title: Schema.String,
  color: Schema.String,
  orderIndex: Schema.Number,
  isCollapsed: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionThreadGroup = typeof ProjectionThreadGroup.Type;

export const GetProjectionThreadGroupInput = Schema.Struct({
  groupId: ThreadGroupId,
});
export type GetProjectionThreadGroupInput = typeof GetProjectionThreadGroupInput.Type;

export const ListProjectionThreadGroupsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionThreadGroupsByProjectInput =
  typeof ListProjectionThreadGroupsByProjectInput.Type;

export const DeleteProjectionThreadGroupInput = Schema.Struct({
  groupId: ThreadGroupId,
});
export type DeleteProjectionThreadGroupInput = typeof DeleteProjectionThreadGroupInput.Type;

export interface ProjectionThreadGroupRepositoryShape {
  readonly upsert: (group: ProjectionThreadGroup) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getById: (
    input: GetProjectionThreadGroupInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadGroup>, ProjectionRepositoryError>;

  readonly listByProjectId: (
    input: ListProjectionThreadGroupsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadGroup>, ProjectionRepositoryError>;

  readonly deleteById: (
    input: DeleteProjectionThreadGroupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionThreadGroupRepository extends ServiceMap.Service<
  ProjectionThreadGroupRepository,
  ProjectionThreadGroupRepositoryShape
>()("t3/persistence/Services/ProjectionThreadGroups/ProjectionThreadGroupRepository") {}
