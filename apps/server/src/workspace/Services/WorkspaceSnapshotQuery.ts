import type { WorkspaceReadModel } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface WorkspaceSnapshotQueryShape {
  readonly getSnapshot: () => Effect.Effect<WorkspaceReadModel, ProjectionRepositoryError>;
}

export class WorkspaceSnapshotQuery extends ServiceMap.Service<
  WorkspaceSnapshotQuery,
  WorkspaceSnapshotQueryShape
>()("t3/workspace/Services/WorkspaceSnapshotQuery") {}
