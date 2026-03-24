import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  WorkspaceId,
  WorkspaceProjectId,
} from "./baseSchemas";

export const WORKSPACE_WS_METHODS = {
  getSnapshot: "workspace.getSnapshot",
  dispatchCommand: "workspace.dispatchCommand",
} as const;

export const WORKSPACE_WS_CHANNELS = {
  event: "workspace.event",
} as const;

export const WorkspacePaneKind = Schema.Literals(["chat", "terminal", "browser", "diff", "files"]);
export type WorkspacePaneKind = typeof WorkspacePaneKind.Type;

export const WorkspacePaneTier = Schema.Literals(["workspace", "project", "ephemeral"]);
export type WorkspacePaneTier = typeof WorkspacePaneTier.Type;

export const WorkspacePane = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: WorkspacePaneKind,
  title: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  terminalGroupId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  browserTabId: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  filePath: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  tier: Schema.optional(
    Schema.NullOr(WorkspacePaneTier).pipe(Schema.withDecodingDefault(() => null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkspacePane = typeof WorkspacePane.Type;

export const WorkspaceTerminalGroup = Schema.Struct({
  id: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  terminalIds: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkspaceTerminalGroup = typeof WorkspaceTerminalGroup.Type;

export const WorkspaceBrowserTab = Schema.Struct({
  id: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  title: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  workspaceProjectId: Schema.optional(
    Schema.NullOr(WorkspaceProjectId).pipe(Schema.withDecodingDefault(() => null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkspaceBrowserTab = typeof WorkspaceBrowserTab.Type;

export const WorkspaceLayoutState = Schema.Struct({
  paneOrder: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
  activePaneId: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
});
export type WorkspaceLayoutState = typeof WorkspaceLayoutState.Type;

export const WorkspaceTitle = TrimmedNonEmptyString;
export type WorkspaceTitle = typeof WorkspaceTitle.Type;

export const WorkspaceSource = Schema.Literals([
  "root",
  "worktree",
  "pull-request",
  "manual-view",
  // Compatibility values for older persisted rows during migration windows.
  "project-default",
  "manual",
]);
export type WorkspaceSource = typeof WorkspaceSource.Type;

export const WorkspaceContextKey = TrimmedNonEmptyString;
export type WorkspaceContextKey = typeof WorkspaceContextKey.Type;

export const WorkspaceOriginRepoKey = TrimmedNonEmptyString;
export type WorkspaceOriginRepoKey = typeof WorkspaceOriginRepoKey.Type;

export const WorkspaceProjectTitle = TrimmedNonEmptyString;
export type WorkspaceProjectTitle = typeof WorkspaceProjectTitle.Type;

export const WorkspaceProjectKind = Schema.Literals(["app", "package", "feature", "root"]);
export type WorkspaceProjectKind = typeof WorkspaceProjectKind.Type;

export const WorkspaceProjectContextKey = TrimmedNonEmptyString;
export type WorkspaceProjectContextKey = typeof WorkspaceProjectContextKey.Type;

export const WorkspaceProjectSurface = Schema.Struct({
  id: WorkspaceProjectId,
  workspaceId: WorkspaceId,
  title: WorkspaceProjectTitle,
  path: Schema.Trim,
  kind: WorkspaceProjectKind,
  contextKey: Schema.NullOr(WorkspaceProjectContextKey).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
});
export type WorkspaceProjectSurface = typeof WorkspaceProjectSurface.Type;

export const WorkspaceSurface = Schema.Struct({
  id: WorkspaceId,
  projectId: ProjectId,
  title: WorkspaceTitle,
  source: WorkspaceSource,
  contextKey: Schema.NullOr(WorkspaceContextKey).pipe(Schema.withDecodingDefault(() => null)),
  parentWorkspaceId: Schema.optional(
    Schema.NullOr(WorkspaceId).pipe(Schema.withDecodingDefault(() => null)),
  ),
  rootWorkspaceId: Schema.optional(WorkspaceId),
  originRepoKey: Schema.optional(WorkspaceOriginRepoKey),
  workspaceRoot: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  linkedThreadIds: Schema.Array(ThreadId).pipe(Schema.withDecodingDefault(() => [])),
  terminalGroups: Schema.Array(WorkspaceTerminalGroup).pipe(Schema.withDecodingDefault(() => [])),
  browserTabs: Schema.Array(WorkspaceBrowserTab).pipe(Schema.withDecodingDefault(() => [])),
  detectedDevServerUrls: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  customTopics: Schema.optional(Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => []))),
  panes: Schema.Array(WorkspacePane).pipe(Schema.withDecodingDefault(() => [])),
  layout: WorkspaceLayoutState,
  lastFocusedPaneId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
});
export type WorkspaceSurface = typeof WorkspaceSurface.Type;

export const WorkspaceReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  workspaces: Schema.Array(WorkspaceSurface),
  workspaceProjects: Schema.Array(WorkspaceProjectSurface).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  updatedAt: IsoDateTime,
});
export type WorkspaceReadModel = typeof WorkspaceReadModel.Type;

export const WorkspaceGetSnapshotInput = Schema.Struct({});
export type WorkspaceGetSnapshotInput = typeof WorkspaceGetSnapshotInput.Type;

export const WorkspaceGetSnapshotResult = WorkspaceReadModel;
export type WorkspaceGetSnapshotResult = typeof WorkspaceGetSnapshotResult.Type;

export const WorkspaceCreateCommand = Schema.Struct({
  type: Schema.Literal("workspace.create"),
  projectId: ProjectId,
  title: Schema.optional(WorkspaceTitle),
  source: WorkspaceSource,
  contextKey: Schema.optional(Schema.NullOr(WorkspaceContextKey)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createdAt: IsoDateTime,
});
export type WorkspaceCreateCommand = typeof WorkspaceCreateCommand.Type;

export const WorkspaceRenameCommand = Schema.Struct({
  type: Schema.Literal("workspace.rename"),
  workspaceId: WorkspaceId,
  title: WorkspaceTitle,
  updatedAt: IsoDateTime,
});
export type WorkspaceRenameCommand = typeof WorkspaceRenameCommand.Type;

export const WorkspaceArchiveCommand = Schema.Struct({
  type: Schema.Literal("workspace.archive"),
  workspaceId: WorkspaceId,
  updatedAt: IsoDateTime,
});
export type WorkspaceArchiveCommand = typeof WorkspaceArchiveCommand.Type;

export const WorkspaceProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("workspaceProject.create"),
  workspaceId: WorkspaceId,
  title: WorkspaceProjectTitle,
  path: Schema.Trim,
  kind: WorkspaceProjectKind,
  createdAt: IsoDateTime,
});
export type WorkspaceProjectCreateCommand = typeof WorkspaceProjectCreateCommand.Type;

export const WorkspaceBrowserTabUpsertCommand = Schema.Struct({
  type: Schema.Literal("workspace.browserTab.upsert"),
  workspaceId: WorkspaceId,
  tab: WorkspaceBrowserTab,
});
export type WorkspaceBrowserTabUpsertCommand = typeof WorkspaceBrowserTabUpsertCommand.Type;

export const WorkspaceBrowserTabRemoveCommand = Schema.Struct({
  type: Schema.Literal("workspace.browserTab.remove"),
  workspaceId: WorkspaceId,
  browserTabId: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type WorkspaceBrowserTabRemoveCommand = typeof WorkspaceBrowserTabRemoveCommand.Type;

export const WorkspacePaneUpsertCommand = Schema.Struct({
  type: Schema.Literal("workspace.pane.upsert"),
  workspaceId: WorkspaceId,
  pane: WorkspacePane,
});
export type WorkspacePaneUpsertCommand = typeof WorkspacePaneUpsertCommand.Type;

export const WorkspacePaneRemoveCommand = Schema.Struct({
  type: Schema.Literal("workspace.pane.remove"),
  workspaceId: WorkspaceId,
  paneId: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type WorkspacePaneRemoveCommand = typeof WorkspacePaneRemoveCommand.Type;

export const WorkspaceLayoutUpdateCommand = Schema.Struct({
  type: Schema.Literal("workspace.layout.update"),
  workspaceId: WorkspaceId,
  paneOrder: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  activePaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  lastFocusedPaneId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});
export type WorkspaceLayoutUpdateCommand = typeof WorkspaceLayoutUpdateCommand.Type;

export const WorkspaceDetectedDevServerUrlUpsertCommand = Schema.Struct({
  type: Schema.Literal("workspace.detectedDevServerUrl.upsert"),
  workspaceId: WorkspaceId,
  url: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type WorkspaceDetectedDevServerUrlUpsertCommand =
  typeof WorkspaceDetectedDevServerUrlUpsertCommand.Type;

export const WorkspaceDetectedDevServerUrlRemoveCommand = Schema.Struct({
  type: Schema.Literal("workspace.detectedDevServerUrl.remove"),
  workspaceId: WorkspaceId,
  url: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type WorkspaceDetectedDevServerUrlRemoveCommand =
  typeof WorkspaceDetectedDevServerUrlRemoveCommand.Type;

export const WorkspaceTopicUpsertCommand = Schema.Struct({
  type: Schema.Literal("workspace.topic.upsert"),
  workspaceId: WorkspaceId,
  label: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type WorkspaceTopicUpsertCommand = typeof WorkspaceTopicUpsertCommand.Type;

export const WorkspaceTopicRemoveCommand = Schema.Struct({
  type: Schema.Literal("workspace.topic.remove"),
  workspaceId: WorkspaceId,
  label: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});
export type WorkspaceTopicRemoveCommand = typeof WorkspaceTopicRemoveCommand.Type;

export const WorkspaceCommand = Schema.Union([
  WorkspaceCreateCommand,
  WorkspaceRenameCommand,
  WorkspaceArchiveCommand,
  WorkspaceProjectCreateCommand,
  WorkspaceBrowserTabUpsertCommand,
  WorkspaceBrowserTabRemoveCommand,
  WorkspacePaneUpsertCommand,
  WorkspacePaneRemoveCommand,
  WorkspaceLayoutUpdateCommand,
  WorkspaceDetectedDevServerUrlUpsertCommand,
  WorkspaceDetectedDevServerUrlRemoveCommand,
  WorkspaceTopicUpsertCommand,
  WorkspaceTopicRemoveCommand,
]);
export type WorkspaceCommand = typeof WorkspaceCommand.Type;

export const WorkspaceDispatchCommandInput = Schema.Struct({
  command: WorkspaceCommand,
});
export type WorkspaceDispatchCommandInput = typeof WorkspaceDispatchCommandInput.Type;

export const WorkspaceDispatchCommandResult = Schema.Struct({
  updatedAt: IsoDateTime,
  workspaceId: Schema.optional(WorkspaceId),
});
export type WorkspaceDispatchCommandResult = typeof WorkspaceDispatchCommandResult.Type;

export const WorkspaceEvent = Schema.Struct({
  type: Schema.Literal("workspace.snapshot-invalidated"),
  causeSequence: NonNegativeInt,
  occurredAt: IsoDateTime,
});
export type WorkspaceEvent = typeof WorkspaceEvent.Type;

export const WorkspaceRpcSchemas = {
  getSnapshot: {
    input: WorkspaceGetSnapshotInput,
    output: WorkspaceGetSnapshotResult,
  },
  dispatchCommand: {
    input: WorkspaceDispatchCommandInput,
    output: WorkspaceDispatchCommandResult,
  },
} as const;
