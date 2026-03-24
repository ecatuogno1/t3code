import {
  type ProjectResolveFileTestTargetResult,
  type ThreadId,
  type WorkspaceId,
  type WorkspaceSurface,
} from "@t3tools/contracts";

import { openInPreferredEditor } from "./editorPreferences";
import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import { selectThreadTerminalState, useTerminalStateStore } from "./terminalStateStore";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";
import {
  buildFilesPaneId,
  resolveResponsibleWorkspaceThreadId as resolveResponsibleWorkspaceThreadIdFromPaneState,
} from "./workspaceShell";
import { openWorkspaceFilePane } from "./workspacePaneActions";

export interface WorkspaceFileSelection {
  relativePath: string;
  line: number | null;
  column: number | null;
}

function normalizeComparablePath(input: string): string {
  const normalized = input.replaceAll("\\", "/").replace(/\/+/g, "/");
  return normalized.replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
}

function normalizeRelativePath(input: string): string | null {
  const raw = input.replaceAll("\\", "/").trim();
  if (raw.length === 0) {
    return null;
  }
  const segments = raw.split("/");
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalizedSegments.length === 0) {
        return null;
      }
      normalizedSegments.pop();
      continue;
    }
    normalizedSegments.push(segment);
  }
  return normalizedSegments.length > 0 ? normalizedSegments.join("/") : null;
}

function splitPathPosition(targetPath: string): WorkspaceFileSelection | null {
  const trimmed = targetPath.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let path = trimmed;
  let column: number | null = null;
  let line: number | null = null;

  const columnMatch = path.match(/:(\d+)$/);
  if (columnMatch?.[1]) {
    column = Number.parseInt(columnMatch[1], 10);
    path = path.slice(0, -columnMatch[0].length);
    const lineMatch = path.match(/:(\d+)$/);
    if (lineMatch?.[1]) {
      line = Number.parseInt(lineMatch[1], 10);
      path = path.slice(0, -lineMatch[0].length);
    } else {
      line = column;
      column = null;
    }
  }

  return {
    relativePath: path,
    line: Number.isFinite(line ?? NaN) ? line : null,
    column: Number.isFinite(column ?? NaN) ? column : null,
  };
}

function joinAbsolutePath(basePath: string, relativePath: string): string {
  const base = basePath.replace(/[\\/]+$/, "");
  return `${base}/${relativePath}`.replace(/\/+/g, "/");
}

export function resolveWorkspacePreviewCwd(workspace: WorkspaceSurface): string {
  return workspace.worktreePath ?? workspace.workspaceRoot;
}

export function encodeWorkspaceFileSelection(selection: WorkspaceFileSelection): string {
  if (!selection.line) {
    return selection.relativePath;
  }
  return `${selection.relativePath}:${selection.line}${selection.column ? `:${selection.column}` : ""}`;
}

export function decodeWorkspaceFileSelection(
  selectionValue: string | null | undefined,
): WorkspaceFileSelection | null {
  if (!selectionValue) {
    return null;
  }
  const parsed = splitPathPosition(selectionValue);
  if (!parsed) {
    return null;
  }
  const relativePath = normalizeRelativePath(parsed.relativePath);
  if (!relativePath) {
    return null;
  }
  return {
    relativePath,
    line: parsed.line,
    column: parsed.column,
  };
}

export function resolveWorkspaceFileSelection(input: {
  workspace: WorkspaceSurface;
  targetPath: string;
}): WorkspaceFileSelection | null {
  const parsed = splitPathPosition(input.targetPath);
  if (!parsed) {
    return null;
  }

  const workspaceRoot = normalizeComparablePath(resolveWorkspacePreviewCwd(input.workspace));
  const candidatePath = normalizeComparablePath(parsed.relativePath);

  const relativePath =
    candidatePath.startsWith("/") ||
    /^[a-z]:\//.test(candidatePath) ||
    candidatePath.startsWith("//")
      ? (() => {
          if (candidatePath === workspaceRoot) {
            return null;
          }
          if (!candidatePath.startsWith(`${workspaceRoot}/`)) {
            return null;
          }
          return normalizeRelativePath(candidatePath.slice(workspaceRoot.length + 1));
        })()
      : normalizeRelativePath(candidatePath);

  if (!relativePath) {
    return null;
  }

  return {
    relativePath,
    line: parsed.line,
    column: parsed.column,
  };
}

export function resolveWorkspaceAbsoluteFilePath(input: {
  workspace: WorkspaceSurface;
  relativePath: string;
}): string {
  return joinAbsolutePath(resolveWorkspacePreviewCwd(input.workspace), input.relativePath);
}

export async function openWorkspaceFileTarget(input: {
  workspaceId: WorkspaceId;
  targetPath: string;
}): Promise<{ paneId: string; selection: WorkspaceFileSelection } | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }
  const state = useStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === input.workspaceId) ?? null;
  if (!workspace) {
    return null;
  }

  const selection = resolveWorkspaceFileSelection({
    workspace,
    targetPath: input.targetPath,
  });
  if (!selection) {
    await openInPreferredEditor(api, input.targetPath);
    return null;
  }

  const paneId = await openWorkspaceFilePane({
    workspaceId: workspace.id,
    relativePath: selection.relativePath,
  });

  return paneId ? { paneId, selection } : null;
}

export async function ensureWorkspaceFilesPane(
  workspaceId: WorkspaceId,
  options?: { focus?: boolean },
): Promise<string | null> {
  const state = useStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId) ?? null;
  if (!workspace) {
    return null;
  }
  useStore.getState().setWorkspaceFilesSidebarOpen(workspace.id, options?.focus !== false);
  return buildFilesPaneId(workspace.id);
}

export function resolveResponsibleWorkspaceThreadId(workspaceId: WorkspaceId): ThreadId | null {
  const state = useStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId) ?? null;
  if (!workspace) {
    return null;
  }
  return resolveResponsibleWorkspaceThreadIdFromPaneState({
    workspace,
    threads: state.threads,
    paneState: state.workspaceShellById[workspaceId] ?? null,
  });
}

export async function runWorkspaceTerminalCommand(input: {
  threadId: ThreadId;
  cwd: string;
  env?: Record<string, string>;
  command: string;
}): Promise<boolean> {
  const api = readNativeApi();
  if (!api) {
    return false;
  }

  const terminalStore = useTerminalStateStore.getState();
  const terminalState = selectThreadTerminalState(
    terminalStore.terminalStateByThreadId,
    input.threadId,
  );
  const baseTerminalId =
    terminalState.activeTerminalId || terminalState.terminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
  const isBaseTerminalBusy = terminalState.runningTerminalIds.includes(baseTerminalId);
  const targetTerminalId = isBaseTerminalBusy ? `terminal-${crypto.randomUUID()}` : baseTerminalId;

  terminalStore.setTerminalOpen(input.threadId, true);
  if (isBaseTerminalBusy) {
    terminalStore.newTerminal(input.threadId, targetTerminalId);
  } else {
    terminalStore.setActiveTerminal(input.threadId, targetTerminalId);
  }

  try {
    await api.terminal.open({
      threadId: input.threadId,
      terminalId: targetTerminalId,
      cwd: input.cwd,
      ...(input.env ? { env: input.env } : {}),
    });
    await api.terminal.write({
      threadId: input.threadId,
      terminalId: targetTerminalId,
      data: `${input.command}\r`,
    });
    return true;
  } catch (error) {
    useStore
      .getState()
      .setError(
        input.threadId,
        error instanceof Error ? error.message : "Failed to run workspace file action.",
      );
    return false;
  }
}

export async function runWorkspaceResolvedFileTestTarget(input: {
  workspaceId: WorkspaceId;
  result: ProjectResolveFileTestTargetResult;
}): Promise<boolean> {
  if (input.result.kind !== "command") {
    return false;
  }
  const threadId = resolveResponsibleWorkspaceThreadId(input.workspaceId);
  if (!threadId) {
    return false;
  }
  return runWorkspaceTerminalCommand({
    threadId,
    cwd: input.result.cwd,
    env: input.result.env,
    command: input.result.command,
  });
}

export function buildWorkspaceFileTestTargetOpenPath(input: {
  workspace: WorkspaceSurface;
  result: ProjectResolveFileTestTargetResult;
}): string | null {
  switch (input.result.kind) {
    case "command":
      return input.result.relatedTestPath
        ? resolveWorkspaceAbsoluteFilePath({
            workspace: input.workspace,
            relativePath: input.result.relatedTestPath,
          })
        : null;
    case "open-file":
      return resolveWorkspaceAbsoluteFilePath({
        workspace: input.workspace,
        relativePath: input.result.relativePath,
      });
    case "unsupported":
      return null;
  }
}

export function buildWorkspaceFileSelectionValue(
  relativePath: string,
  line?: number | null,
  column?: number | null,
): string {
  return encodeWorkspaceFileSelection({
    relativePath,
    line: line ?? null,
    column: column ?? null,
  });
}
