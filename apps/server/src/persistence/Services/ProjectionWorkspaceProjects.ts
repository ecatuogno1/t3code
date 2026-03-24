import type {
  IsoDateTime,
  WorkspaceId,
  WorkspaceProjectContextKey,
  WorkspaceProjectId,
  WorkspaceProjectKind,
  WorkspaceProjectTitle,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface ProjectionWorkspaceProject {
  readonly workspaceProjectId: WorkspaceProjectId;
  readonly workspaceId: WorkspaceId;
  readonly title: WorkspaceProjectTitle;
  readonly path: string;
  readonly kind: WorkspaceProjectKind;
  readonly contextKey: WorkspaceProjectContextKey | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export const GetProjectionWorkspaceProjectInput = Schema.Struct({
  workspaceProjectId: Schema.String,
});
export type GetProjectionWorkspaceProjectInput = {
  readonly workspaceProjectId: WorkspaceProjectId;
};

export const ListProjectionWorkspaceProjectsByWorkspaceInput = Schema.Struct({
  workspaceId: Schema.String,
});
export type ListProjectionWorkspaceProjectsByWorkspaceInput = {
  readonly workspaceId: WorkspaceId;
};

export interface ProjectionWorkspaceProjectRepositoryShape {
  readonly upsert: (
    workspaceProject: ProjectionWorkspaceProject,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionWorkspaceProjectInput,
  ) => Effect.Effect<Option.Option<ProjectionWorkspaceProject>, ProjectionRepositoryError>;
  readonly list: () => Effect.Effect<
    ReadonlyArray<ProjectionWorkspaceProject>,
    ProjectionRepositoryError
  >;
  readonly listByWorkspaceId: (
    input: ListProjectionWorkspaceProjectsByWorkspaceInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionWorkspaceProject>, ProjectionRepositoryError>;
}

export class ProjectionWorkspaceProjectRepository extends ServiceMap.Service<
  ProjectionWorkspaceProjectRepository,
  ProjectionWorkspaceProjectRepositoryShape
>()("t3/persistence/Services/ProjectionWorkspaceProjects/ProjectionWorkspaceProjectRepository") {}
