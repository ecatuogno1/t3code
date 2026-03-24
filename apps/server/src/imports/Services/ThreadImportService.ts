import type {
  ThreadImportCandidate,
  ThreadImportRequest,
  ThreadImportResult,
  ThreadImportScanRequest,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { OrchestrationDispatchError } from "../../orchestration/Errors.ts";
import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import type { WorkspaceCommandError } from "../../workspace/Services/WorkspaceCommandService.ts";
import type {
  ProviderSessionDirectoryPersistenceError,
  ProviderValidationError,
} from "../../provider/Errors.ts";

export type ThreadImportServiceError =
  | OrchestrationDispatchError
  | ProjectionRepositoryError
  | WorkspaceCommandError
  | ProviderSessionDirectoryPersistenceError
  | ProviderValidationError
  | Error;

export interface ThreadImportServiceShape {
  readonly scan: (
    input: ThreadImportScanRequest,
  ) => Effect.Effect<ReadonlyArray<ThreadImportCandidate>, ThreadImportServiceError>;
  readonly importSession: (
    input: ThreadImportRequest,
  ) => Effect.Effect<ThreadImportResult, ThreadImportServiceError>;
}

export class ThreadImportService extends ServiceMap.Service<
  ThreadImportService,
  ThreadImportServiceShape
>()("t3/imports/Services/ThreadImportService") {}
