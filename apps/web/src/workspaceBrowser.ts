import type {
  WorkspaceBrowserTab,
  WorkspaceId,
  WorkspacePane,
  WorkspaceProjectId,
} from "@t3tools/contracts";

import { isSupportedBrowserTabUrl } from "./browserUrl";
import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";
import { buildBrowserPaneId, resolveWorkspacePreferredPaneId } from "./workspaceShell";

export function resolveStoredWorkspaceBrowserTabTitle(input: {
  requestedTitle?: string | null | undefined;
  existingTitle?: string | null | undefined;
  snapshotTitle?: string | null | undefined;
}): string | null {
  return input.requestedTitle ?? input.existingTitle ?? input.snapshotTitle ?? null;
}

export async function openWorkspaceBrowserTab(input: {
  workspaceId: WorkspaceId;
  workspaceProjectId?: WorkspaceProjectId | null;
  url: string;
  title?: string | null;
  tabId?: string;
  focus?: boolean;
}): Promise<string | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }
  const state = useStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === input.workspaceId);
  if (!workspace) {
    return null;
  }
  if (!isSupportedBrowserTabUrl(input.url)) {
    return null;
  }

  const now = new Date().toISOString();
  const existingTab = input.tabId
    ? (workspace.browserTabs.find((tab) => tab.id === input.tabId) ?? null)
    : (workspace.browserTabs.find(
        (tab) =>
          tab.url === input.url &&
          (tab.workspaceProjectId ?? null) === (input.workspaceProjectId ?? null),
      ) ?? null);
  const browserTabSnapshot = await api.browser.open({
    url: input.url,
    ...((existingTab?.id ?? input.tabId) ? { tabId: existingTab?.id ?? input.tabId } : {}),
    title: input.title ?? existingTab?.title ?? null,
  });
  const browserTab: WorkspaceBrowserTab = {
    id: browserTabSnapshot.id,
    url: browserTabSnapshot.url,
    title: resolveStoredWorkspaceBrowserTabTitle({
      requestedTitle: input.title,
      existingTitle: existingTab?.title ?? null,
      snapshotTitle: browserTabSnapshot.title ?? null,
    }),
    workspaceProjectId: input.workspaceProjectId ?? existingTab?.workspaceProjectId ?? null,
    createdAt: existingTab?.createdAt ?? now,
    updatedAt: now,
  };
  const paneId = buildBrowserPaneId(browserTab.id);
  const existingPane =
    workspace.panes.find((pane) => pane.id === paneId) ??
    workspace.panes.find((pane) => pane.browserTabId === browserTab.id) ??
    null;
  const pane: WorkspacePane = {
    id: paneId,
    kind: "browser",
    title: browserTab.title ?? browserTab.url,
    threadId: null,
    terminalGroupId: null,
    browserTabId: browserTab.id,
    filePath: null,
    createdAt: existingPane?.createdAt ?? now,
    updatedAt: now,
  };

  useStore.getState().upsertWorkspaceBrowserTabRecord(workspace.id, browserTab);
  useStore.getState().upsertWorkspacePaneRecord(workspace.id, pane);

  await api.workspace.dispatchCommand({
    type: "workspace.browserTab.upsert",
    workspaceId: workspace.id,
    tab: browserTab,
  });
  await api.workspace.dispatchCommand({
    type: "workspace.pane.upsert",
    workspaceId: workspace.id,
    pane,
  });

  const latestState = useStore.getState();
  const latestWorkspace =
    latestState.workspaces.find((entry) => entry.id === input.workspaceId) ?? workspace;
  const shellState = latestState.workspaceShellById[latestWorkspace.id] ?? {
    paneOrder: latestWorkspace.layout.paneOrder,
    activePaneId: latestWorkspace.layout.activePaneId,
  };
  const paneOrder = shellState.paneOrder.includes(paneId)
    ? shellState.paneOrder
    : [...shellState.paneOrder, paneId];
  const activePaneId =
    input.focus === false
      ? resolveWorkspacePreferredPaneId({
          paneOrder,
          activePaneId: shellState.activePaneId,
          lastFocusedPaneId: latestWorkspace.lastFocusedPaneId,
        })
      : paneId;
  const lastFocusedPaneId =
    input.focus === false ? (latestWorkspace.lastFocusedPaneId ?? activePaneId) : paneId;
  useStore.getState().setWorkspacePaneLayoutState(latestWorkspace.id, paneOrder, activePaneId);
  await api.workspace.dispatchCommand({
    type: "workspace.layout.update",
    workspaceId: latestWorkspace.id,
    paneOrder,
    activePaneId,
    lastFocusedPaneId,
    updatedAt: now,
  });
  return paneId;
}

export async function navigateWorkspaceBrowserTab(input: {
  tabId: string;
  url: string;
}): Promise<string | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }

  const latestState = useStore.getState();
  const workspace =
    latestState.workspaces.find((entry) =>
      entry.browserTabs.some((browserTab) => browserTab.id === input.tabId),
    ) ?? null;
  if (!workspace) {
    return null;
  }

  const existingTab = workspace.browserTabs.find((tab) => tab.id === input.tabId) ?? null;
  if (!existingTab) {
    return null;
  }
  if (!isSupportedBrowserTabUrl(input.url)) {
    return null;
  }

  const now = new Date().toISOString();
  const browserTabSnapshot = await api.browser.navigate({
    tabId: input.tabId,
    url: input.url,
  });
  const browserTab: WorkspaceBrowserTab = {
    id: browserTabSnapshot.id,
    url: browserTabSnapshot.url,
    title: resolveStoredWorkspaceBrowserTabTitle({
      existingTitle: existingTab.title ?? null,
      snapshotTitle: browserTabSnapshot.title ?? null,
    }),
    workspaceProjectId: existingTab.workspaceProjectId ?? null,
    createdAt: existingTab.createdAt,
    updatedAt: now,
  };
  const paneId = buildBrowserPaneId(browserTab.id);
  const existingPane =
    workspace.panes.find((pane) => pane.id === paneId) ??
    workspace.panes.find((pane) => pane.browserTabId === browserTab.id) ??
    null;
  const pane: WorkspacePane = {
    id: paneId,
    kind: "browser",
    title: browserTab.title ?? browserTab.url,
    threadId: null,
    terminalGroupId: null,
    browserTabId: browserTab.id,
    filePath: null,
    createdAt: existingPane?.createdAt ?? now,
    updatedAt: now,
  };

  useStore.getState().upsertWorkspaceBrowserTabRecord(workspace.id, browserTab);
  useStore.getState().upsertWorkspacePaneRecord(workspace.id, pane);

  await api.workspace.dispatchCommand({
    type: "workspace.browserTab.upsert",
    workspaceId: workspace.id,
    tab: browserTab,
  });
  await api.workspace.dispatchCommand({
    type: "workspace.pane.upsert",
    workspaceId: workspace.id,
    pane,
  });

  return paneId;
}

export async function removeWorkspaceBrowserTab(input: {
  tabId: string;
  closeNative?: boolean;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }

  if (input.closeNative !== false) {
    await api.browser.close({ tabId: input.tabId }).catch(() => undefined);
  }

  const latestState = useStore.getState();
  const workspace =
    latestState.workspaces.find((entry) =>
      entry.browserTabs.some((browserTab) => browserTab.id === input.tabId),
    ) ?? null;
  if (!workspace) {
    return;
  }

  useStore.getState().removeWorkspaceBrowserTabRecord(workspace.id, input.tabId);
  await api.workspace
    .dispatchCommand({
      type: "workspace.browserTab.remove",
      workspaceId: workspace.id,
      browserTabId: input.tabId,
      updatedAt: new Date().toISOString(),
    })
    .catch(() => undefined);
}

export async function seedWorkspaceBrowserTabs(input: {
  workspaceId: WorkspaceId;
  workspaceProjectId?: WorkspaceProjectId | null;
  tabs: ReadonlyArray<{ url: string; title?: string | null }>;
}): Promise<void> {
  const state = useStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === input.workspaceId);
  if (!workspace) {
    return;
  }
  for (const tab of input.tabs) {
    if (
      workspace.browserTabs.some(
        (existingTab) =>
          existingTab.url === tab.url &&
          (existingTab.workspaceProjectId ?? null) === (input.workspaceProjectId ?? null),
      )
    ) {
      continue;
    }
    await openWorkspaceBrowserTab({
      workspaceId: workspace.id,
      workspaceProjectId: input.workspaceProjectId ?? null,
      url: tab.url,
      title: tab.title ?? null,
    });
  }
}
