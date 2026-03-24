import type {
  IsoDateTime,
  ProjectId,
  WorkspaceBrowserTab,
  WorkspaceContextKey,
  WorkspaceLayoutState,
  WorkspaceOriginRepoKey,
  WorkspacePane,
  WorkspaceSource,
  WorkspaceTerminalGroup,
  WorkspaceTitle,
  WorkspaceId,
} from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface ProjectionWorkspace {
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
  readonly title: WorkspaceTitle;
  readonly source: WorkspaceSource;
  readonly contextKey: WorkspaceContextKey | null;
  readonly parentWorkspaceId: WorkspaceId | null;
  readonly rootWorkspaceId: WorkspaceId;
  readonly originRepoKey: WorkspaceOriginRepoKey;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly panes: ReadonlyArray<WorkspacePane>;
  readonly terminalGroups: ReadonlyArray<WorkspaceTerminalGroup>;
  readonly browserTabs: ReadonlyArray<WorkspaceBrowserTab>;
  readonly detectedDevServerUrls: ReadonlyArray<string>;
  readonly layout: WorkspaceLayoutState;
  readonly lastFocusedPaneId: string | null;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly deletedAt: IsoDateTime | null;
}

export const GetProjectionWorkspaceInput = Schema.Struct({
  workspaceId: Schema.String,
});
export type GetProjectionWorkspaceInput = {
  readonly workspaceId: WorkspaceId;
};

export const ListProjectionWorkspacesByProjectInput = Schema.Struct({
  projectId: Schema.String,
});
export type ListProjectionWorkspacesByProjectInput = {
  readonly projectId: ProjectId;
};

export interface ProjectionWorkspaceRepositoryShape {
  readonly upsert: (
    workspace: ProjectionWorkspace,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionWorkspaceInput,
  ) => Effect.Effect<Option.Option<ProjectionWorkspace>, ProjectionRepositoryError>;
  readonly list: () => Effect.Effect<ReadonlyArray<ProjectionWorkspace>, ProjectionRepositoryError>;
  readonly listByProjectId: (
    input: ListProjectionWorkspacesByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionWorkspace>, ProjectionRepositoryError>;
}

export class ProjectionWorkspaceRepository extends ServiceMap.Service<
  ProjectionWorkspaceRepository,
  ProjectionWorkspaceRepositoryShape
>()("t3/persistence/Services/ProjectionWorkspaces/ProjectionWorkspaceRepository") {}
