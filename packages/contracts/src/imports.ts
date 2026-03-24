import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  WorkspaceId,
} from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const ThreadImportProvider = ProviderKind;
export type ThreadImportProvider = typeof ThreadImportProvider.Type;

export const ThreadImportCandidate = Schema.Struct({
  provider: ThreadImportProvider,
  externalSessionId: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  messageCount: NonNegativeInt,
  resumable: Schema.Boolean,
  alreadyImportedThreadId: Schema.NullOr(ThreadId),
});
export type ThreadImportCandidate = typeof ThreadImportCandidate.Type;

export const ThreadImportScanRequest = Schema.Struct({
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
});
export type ThreadImportScanRequest = typeof ThreadImportScanRequest.Type;

export const ThreadImportRequest = Schema.Struct({
  provider: ThreadImportProvider,
  externalSessionId: TrimmedNonEmptyString,
  sourcePath: TrimmedNonEmptyString,
});
export type ThreadImportRequest = typeof ThreadImportRequest.Type;

export const ThreadImportContinuationMode = Schema.Literals(["codex-resume", "fresh-session"]);
export type ThreadImportContinuationMode = typeof ThreadImportContinuationMode.Type;

export const ThreadImportResult = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  continuationMode: ThreadImportContinuationMode,
});
export type ThreadImportResult = typeof ThreadImportResult.Type;
