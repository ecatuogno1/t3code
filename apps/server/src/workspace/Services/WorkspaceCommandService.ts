import type {
  WorkspaceCommand,
  WorkspaceDispatchCommandResult,
  WorkspaceReadModel,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export class WorkspaceCommandError extends Schema.TaggedErrorClass<WorkspaceCommandError>()(
  "WorkspaceCommandError",
  {
    message: Schema.String,
  },
) {}

export interface WorkspaceCommandServiceShape {
  readonly dispatch: (
    command: WorkspaceCommand,
  ) => Effect.Effect<
    WorkspaceDispatchCommandResult,
    ProjectionRepositoryError | WorkspaceCommandError
  >;
  readonly getSnapshot: () => Effect.Effect<WorkspaceReadModel, ProjectionRepositoryError>;
}

export class WorkspaceCommandService extends ServiceMap.Service<
  WorkspaceCommandService,
  WorkspaceCommandServiceShape
>()("t3/workspace/Services/WorkspaceCommandService") {}
