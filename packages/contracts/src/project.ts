import { Schema } from "effect";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_LIST_DIRECTORY_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_MAX_BYTES = 256 * 1024;

const ProjectRelativePath = Schema.String.check(
  Schema.isMaxLength(PROJECT_LIST_DIRECTORY_PATH_MAX_LENGTH),
);
export type ProjectRelativePath = typeof ProjectRelativePath.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  directoryPath: ProjectRelativePath.pipe(Schema.withDecodingDefault(() => "")),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  directoryPath: ProjectRelativePath,
  entries: Schema.Array(ProjectEntry),
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  isBinary: Schema.Boolean,
  truncated: Schema.Boolean,
  sizeBytes: NonNegativeInt,
  previewMaxBytes: Schema.Number.pipe(
    Schema.withDecodingDefault(() => PROJECT_READ_FILE_MAX_BYTES),
  ),
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

const ProjectResolveFileTestTargetCommandResult = Schema.Struct({
  kind: Schema.Literal("command"),
  cwd: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  env: Schema.Record(Schema.String, Schema.String),
  relatedTestPath: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type ProjectResolveFileTestTargetCommandResult =
  typeof ProjectResolveFileTestTargetCommandResult.Type;

const ProjectResolveFileTestTargetOpenFileResult = Schema.Struct({
  kind: Schema.Literal("open-file"),
  relativePath: TrimmedNonEmptyString,
});
export type ProjectResolveFileTestTargetOpenFileResult =
  typeof ProjectResolveFileTestTargetOpenFileResult.Type;

const ProjectResolveFileTestTargetUnsupportedResult = Schema.Struct({
  kind: Schema.Literal("unsupported"),
});
export type ProjectResolveFileTestTargetUnsupportedResult =
  typeof ProjectResolveFileTestTargetUnsupportedResult.Type;

export const ProjectResolveFileTestTargetInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
});
export type ProjectResolveFileTestTargetInput = typeof ProjectResolveFileTestTargetInput.Type;

export const ProjectResolveFileTestTargetResult = Schema.Union([
  ProjectResolveFileTestTargetCommandResult,
  ProjectResolveFileTestTargetOpenFileResult,
  ProjectResolveFileTestTargetUnsupportedResult,
]);
export type ProjectResolveFileTestTargetResult = typeof ProjectResolveFileTestTargetResult.Type;

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export const PROJECT_READ_FILE_PREVIEW_MAX_BYTES = PROJECT_READ_FILE_MAX_BYTES;
