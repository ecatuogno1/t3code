/**
 * ProjectionThreadGroupRepository - Projection repository interface for thread groups.
 *
 * Owns persistence operations for projected thread group records in the
 * orchestration read model.
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
  color: Schema.NullOr(Schema.String),
  collapsed: Schema.Boolean,
  orderIndex: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadGroup = typeof ProjectionThreadGroup.Type;

export const GetProjectionThreadGroupInput = Schema.Struct({
  groupId: ThreadGroupId,
});
export type GetProjectionThreadGroupInput = typeof GetProjectionThreadGroupInput.Type;

export const DeleteProjectionThreadGroupInput = Schema.Struct({
  groupId: ThreadGroupId,
});
export type DeleteProjectionThreadGroupInput = typeof DeleteProjectionThreadGroupInput.Type;

export const ListProjectionThreadGroupsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionThreadGroupsByProjectInput =
  typeof ListProjectionThreadGroupsByProjectInput.Type;

/**
 * ProjectionThreadGroupRepositoryShape - Service API for projected thread group records.
 */
export interface ProjectionThreadGroupRepositoryShape {
  /**
   * Insert or replace a projected thread group row.
   *
   * Upserts by `groupId`.
   */
  readonly upsert: (row: ProjectionThreadGroup) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected thread group row by id.
   */
  readonly getById: (
    input: GetProjectionThreadGroupInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadGroup>, ProjectionRepositoryError>;

  /**
   * List projected thread groups for a project.
   *
   * Returned in order_index order.
   */
  readonly listByProjectId: (
    input: ListProjectionThreadGroupsByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadGroup>, ProjectionRepositoryError>;

  /**
   * Delete a projected thread group row by id.
   */
  readonly deleteById: (
    input: DeleteProjectionThreadGroupInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionThreadGroupRepository - Service tag for thread group projection persistence.
 */
export class ProjectionThreadGroupRepository extends ServiceMap.Service<
  ProjectionThreadGroupRepository,
  ProjectionThreadGroupRepositoryShape
>()("t3/persistence/Services/ProjectionThreadGroups/ProjectionThreadGroupRepository") {}
