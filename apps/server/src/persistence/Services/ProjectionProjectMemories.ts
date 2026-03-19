/**
 * ProjectionProjectMemoryRepository - Projection repository interface for project memories.
 *
 * Owns persistence operations for projected project memory records in the
 * orchestration read model.
 *
 * @module ProjectionProjectMemoryRepository
 */
import {
  IsoDateTime,
  ProjectId,
  ProjectMemoryId,
  ProjectMemoryKind,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProjectMemory = Schema.Struct({
  memoryId: ProjectMemoryId,
  projectId: ProjectId,
  title: Schema.String,
  content: Schema.String,
  kind: ProjectMemoryKind,
  tags: Schema.Array(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionProjectMemory = typeof ProjectionProjectMemory.Type;

export const GetProjectionProjectMemoryInput = Schema.Struct({
  memoryId: ProjectMemoryId,
});
export type GetProjectionProjectMemoryInput = typeof GetProjectionProjectMemoryInput.Type;

export const DeleteProjectionProjectMemoryInput = Schema.Struct({
  memoryId: ProjectMemoryId,
});
export type DeleteProjectionProjectMemoryInput = typeof DeleteProjectionProjectMemoryInput.Type;

export const ListProjectionProjectMemoriesByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionProjectMemoriesByProjectInput =
  typeof ListProjectionProjectMemoriesByProjectInput.Type;

/**
 * ProjectionProjectMemoryRepositoryShape - Service API for projected project memory records.
 */
export interface ProjectionProjectMemoryRepositoryShape {
  /**
   * Insert or replace a projected project memory row.
   *
   * Upserts by `memoryId`.
   */
  readonly upsert: (row: ProjectionProjectMemory) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected project memory row by id.
   */
  readonly getById: (
    input: GetProjectionProjectMemoryInput,
  ) => Effect.Effect<Option.Option<ProjectionProjectMemory>, ProjectionRepositoryError>;

  /**
   * List projected project memories for a project.
   *
   * Returned in deterministic creation order.
   */
  readonly listByProjectId: (
    input: ListProjectionProjectMemoriesByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionProjectMemory>, ProjectionRepositoryError>;

  /**
   * Delete a projected project memory row by id.
   */
  readonly deleteById: (
    input: DeleteProjectionProjectMemoryInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionProjectMemoryRepository - Service tag for project memory projection persistence.
 */
export class ProjectionProjectMemoryRepository extends ServiceMap.Service<
  ProjectionProjectMemoryRepository,
  ProjectionProjectMemoryRepositoryShape
>()("t3/persistence/Services/ProjectionProjectMemories/ProjectionProjectMemoryRepository") {}
