import { type ThreadId, type WorkspaceId, type WorkspacePane } from "@t3tools/contracts";

import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import {
  buildChatPaneId,
  buildFilesPaneId,
  normalizeWorkspacePaneState,
  resolveWorkspacePaneStateFallback,
  resolveWorkspacePreferredPaneId,
} from "./workspaceShell";

export async function openWorkspaceChatPane(input: {
  workspaceId: WorkspaceId;
  threadId: ThreadId;
  focus?: boolean;
}): Promise<string | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }

  useStore.getState().openWorkspaceThreadPane(input.workspaceId, input.threadId);
  const paneId = buildChatPaneId(input.threadId);
  if (input.focus !== false) {
    useStore.getState().focusWorkspacePane(input.workspaceId, paneId);
  }

  const latestState = useStore.getState();
  const workspace = latestState.workspaces.find((entry) => entry.id === input.workspaceId) ?? null;
  if (!workspace) {
    return null;
  }

  const shellState = normalizeWorkspacePaneState(
    latestState.workspaceShellById[workspace.id] ??
      normalizeWorkspacePaneState(resolveWorkspacePaneStateFallback(workspace)),
  );
  const paneOrder = shellState.paneOrder.includes(paneId)
    ? shellState.paneOrder
    : [...shellState.paneOrder, paneId];
  const nextActivePaneId =
    input.focus === false
      ? resolveWorkspacePreferredPaneId({
          paneOrder,
          activePaneId: shellState.activePaneId,
          lastFocusedPaneId: workspace.lastFocusedPaneId,
        })
      : paneId;
  const nextLastFocusedPaneId =
    input.focus === false ? (workspace.lastFocusedPaneId ?? nextActivePaneId) : paneId;
  const now = new Date().toISOString();

  useStore.getState().setWorkspacePaneLayoutState(workspace.id, paneOrder, nextActivePaneId);
  await api.workspace.dispatchCommand({
    type: "workspace.layout.update",
    workspaceId: workspace.id,
    paneOrder,
    activePaneId: nextActivePaneId,
    lastFocusedPaneId: nextLastFocusedPaneId,
    updatedAt: now,
  });

  return paneId;
}

export async function closeWorkspaceChatPane(input: {
  workspaceId: WorkspaceId;
  threadId: ThreadId;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }

  const latestState = useStore.getState();
  const workspace = latestState.workspaces.find((entry) => entry.id === input.workspaceId) ?? null;
  if (!workspace) {
    return;
  }

  const paneId = buildChatPaneId(input.threadId);
  const shellState = normalizeWorkspacePaneState(
    latestState.workspaceShellById[workspace.id] ??
      normalizeWorkspacePaneState(resolveWorkspacePaneStateFallback(workspace)),
  );
  if (!shellState.paneOrder.includes(paneId)) {
    return;
  }

  const paneOrder = shellState.paneOrder.filter((candidate) => candidate !== paneId);
  const activePaneId = resolveWorkspacePreferredPaneId({
    paneOrder,
    activePaneId: shellState.activePaneId === paneId ? null : shellState.activePaneId,
    lastFocusedPaneId:
      workspace.lastFocusedPaneId === paneId ? null : (workspace.lastFocusedPaneId ?? null),
  });
  const now = new Date().toISOString();

  useStore.getState().closeWorkspacePane(workspace.id, paneId);
  useStore.getState().setWorkspacePaneLayoutState(workspace.id, paneOrder, activePaneId);
  await api.workspace.dispatchCommand({
    type: "workspace.layout.update",
    workspaceId: workspace.id,
    paneOrder,
    activePaneId,
    lastFocusedPaneId: activePaneId,
    updatedAt: now,
  });
}

export async function openWorkspaceFilePane(input: {
  workspaceId: WorkspaceId;
  relativePath: string;
  focus?: boolean;
}): Promise<string | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }

  const state = useStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === input.workspaceId) ?? null;
  if (!workspace) {
    return null;
  }

  // Use a single file pane per workspace — selecting a file updates the selection, not the pane.
  const paneId = buildFilesPaneId(input.workspaceId);
  const now = new Date().toISOString();

  // Ensure the pane record exists.
  const existingPane = workspace.panes.find((pane) => pane.id === paneId) ?? null;
  if (!existingPane) {
    const pane: WorkspacePane = {
      id: paneId,
      kind: "files",
      title: "Files",
      threadId: null,
      terminalGroupId: null,
      browserTabId: null,
      filePath: input.relativePath,
      createdAt: now,
      updatedAt: now,
    };
    useStore.getState().upsertWorkspacePaneRecord(workspace.id, pane);
    await api.workspace.dispatchCommand({
      type: "workspace.pane.upsert",
      workspaceId: workspace.id,
      pane,
    });
  }

  // Update the selected file via sidebar state — FilesPane reads this reactively.
  // Encode as "relativePath:line:column" format (matching workspaceFiles.ts encodeWorkspaceFileSelection).
  const encodedSelection = input.relativePath;
  useStore.getState().setWorkspaceFilesSidebarSelection(workspace.id, encodedSelection);

  const latestState = useStore.getState();
  const latestWorkspace =
    latestState.workspaces.find((entry) => entry.id === input.workspaceId) ?? workspace;
  const shellState = normalizeWorkspacePaneState(
    latestState.workspaceShellById[latestWorkspace.id] ??
      normalizeWorkspacePaneState(resolveWorkspacePaneStateFallback(latestWorkspace)),
  );
  const paneOrder = shellState.paneOrder.includes(paneId)
    ? shellState.paneOrder
    : [...shellState.paneOrder, paneId];
  const nextActivePaneId =
    input.focus === false
      ? resolveWorkspacePreferredPaneId({
          paneOrder,
          activePaneId: shellState.activePaneId,
          lastFocusedPaneId: latestWorkspace.lastFocusedPaneId,
        })
      : paneId;
  const nextLastFocusedPaneId =
    input.focus === false ? (latestWorkspace.lastFocusedPaneId ?? nextActivePaneId) : paneId;

  useStore.getState().setWorkspacePaneLayoutState(latestWorkspace.id, paneOrder, nextActivePaneId);
  await api.workspace.dispatchCommand({
    type: "workspace.layout.update",
    workspaceId: latestWorkspace.id,
    paneOrder,
    activePaneId: nextActivePaneId,
    lastFocusedPaneId: nextLastFocusedPaneId,
    updatedAt: now,
  });

  return paneId;
}
