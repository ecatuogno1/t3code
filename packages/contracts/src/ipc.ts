import type {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusInput,
  GitStatusResult,
} from "./git";
import type {
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectResolveFileTestTargetInput,
  ProjectResolveFileTestTargetResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import type { ServerConfig } from "./server";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import type { ServerUpsertKeybindingInput, ServerUpsertKeybindingResult } from "./server";
import type {
  ClientOrchestrationCommand,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "./orchestration";
import type {
  WorkspaceCommand,
  WorkspaceDispatchCommandResult,
  WorkspaceEvent,
  WorkspaceReadModel,
} from "./workspace";
import type {
  ThreadImportCandidate,
  ThreadImportRequest,
  ThreadImportResult,
  ThreadImportScanRequest,
} from "./imports";
import type {
  ThreadCategorizationRequest,
  ThreadCategorizationResult,
} from "./threadCategorization";
import { EditorId } from "./editor";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface BrowserTabSnapshot {
  id: string;
  url: string;
  title: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserOpenInput {
  tabId?: string;
  url: string;
  title?: string | null;
}

export interface BrowserNavigateInput {
  tabId: string;
  url: string;
}

export interface BrowserFocusInput {
  tabId: string;
}

export interface BrowserCloseInput {
  tabId: string;
}

export interface BrowserPaneBoundsInput {
  tabId: string;
  paneId: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface BrowserPaneVisibilityInput {
  tabId: string;
  paneId: string;
  visible: boolean;
}

export type BrowserEvent =
  | {
      type: "tab-opened";
      tab: BrowserTabSnapshot;
    }
  | {
      type: "tab-updated";
      tab: BrowserTabSnapshot;
    }
  | {
      type: "tab-focused";
      tabId: string;
    }
  | {
      type: "tab-closed";
      tabId: string;
    };

export interface DesktopBridge {
  getWsUrl: () => string | null;
  pickFolder: () => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  browser: {
    listTabs: () => Promise<BrowserTabSnapshot[]>;
    open: (input: BrowserOpenInput) => Promise<BrowserTabSnapshot>;
    navigate: (input: BrowserNavigateInput) => Promise<BrowserTabSnapshot>;
    focus: (input: BrowserFocusInput) => Promise<void>;
    close: (input: BrowserCloseInput) => Promise<void>;
    setPaneBounds: (input: BrowserPaneBoundsInput) => Promise<void>;
    setPaneVisibility: (input: BrowserPaneVisibilityInput) => Promise<void>;
    onEvent: (listener: (event: BrowserEvent) => void) => () => void;
  };
}

export interface NativeApi {
  dialogs: {
    pickFolder: () => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  terminal: {
    open: (input: TerminalOpenInput) => Promise<TerminalSessionSnapshot>;
    write: (input: TerminalWriteInput) => Promise<void>;
    resize: (input: TerminalResizeInput) => Promise<void>;
    clear: (input: TerminalClearInput) => Promise<void>;
    restart: (input: TerminalRestartInput) => Promise<TerminalSessionSnapshot>;
    close: (input: TerminalCloseInput) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    listDirectory: (input: ProjectListDirectoryInput) => Promise<ProjectListDirectoryResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    resolveFileTestTarget: (
      input: ProjectResolveFileTestTargetInput,
    ) => Promise<ProjectResolveFileTestTargetResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  git: {
    // Existing branch/worktree API
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<void>;
    checkout: (input: GitCheckoutInput) => Promise<void>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    // Stacked action API
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    status: (input: GitStatusInput) => Promise<GitStatusResult>;
    runStackedAction: (input: GitRunStackedActionInput) => Promise<GitRunStackedActionResult>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
  };
  orchestration: {
    getSnapshot: () => Promise<OrchestrationReadModel>;
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    replayEvents: (fromSequenceExclusive: number) => Promise<OrchestrationEvent[]>;
    onDomainEvent: (callback: (event: OrchestrationEvent) => void) => () => void;
  };
  imports: {
    scan: (input?: ThreadImportScanRequest) => Promise<ReadonlyArray<ThreadImportCandidate>>;
    importSession: (input: ThreadImportRequest) => Promise<ThreadImportResult>;
  };
  threadCategorization: {
    categorizeProjectThreads: (
      input: ThreadCategorizationRequest,
    ) => Promise<ThreadCategorizationResult>;
  };
  workspace: {
    getSnapshot: () => Promise<WorkspaceReadModel>;
    dispatchCommand: (command: WorkspaceCommand) => Promise<WorkspaceDispatchCommandResult>;
    onEvent: (callback: (event: WorkspaceEvent) => void) => () => void;
  };
  browser: {
    listTabs: () => Promise<BrowserTabSnapshot[]>;
    open: (input: BrowserOpenInput) => Promise<BrowserTabSnapshot>;
    navigate: (input: BrowserNavigateInput) => Promise<BrowserTabSnapshot>;
    focus: (input: BrowserFocusInput) => Promise<void>;
    close: (input: BrowserCloseInput) => Promise<void>;
    setPaneBounds: (input: BrowserPaneBoundsInput) => Promise<void>;
    setPaneVisibility: (input: BrowserPaneVisibilityInput) => Promise<void>;
    onEvent: (callback: (event: BrowserEvent) => void) => () => void;
  };
}
