import { randomUUID } from "node:crypto";

import { BrowserWindow, WebContentsView, shell } from "electron";
import type {
  BrowserCloseInput,
  BrowserEvent,
  BrowserFocusInput,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserPaneBoundsInput,
  BrowserPaneVisibilityInput,
  BrowserTabSnapshot,
} from "@t3tools/contracts";

function getSafeBrowserUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return null;
  }

  return parsedUrl.toString();
}

interface PaneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DesktopBrowserPaneRecord {
  tabId: string;
  bounds: PaneBounds;
  visible: boolean;
}

interface DesktopBrowserTabRecord {
  readonly view: WebContentsView;
  snapshot: BrowserTabSnapshot;
  attachedPaneId: string | null;
}

function clampPaneBounds(bounds: PaneBounds): PaneBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function toSnapshot(record: DesktopBrowserTabRecord): BrowserTabSnapshot {
  return {
    ...record.snapshot,
    title: record.view.webContents.getTitle() || record.snapshot.title,
    canGoBack: record.view.webContents.navigationHistory.canGoBack(),
    canGoForward: record.view.webContents.navigationHistory.canGoForward(),
    loading: record.view.webContents.isLoadingMainFrame(),
    url: record.view.webContents.getURL() || record.snapshot.url,
  };
}

export interface DesktopBrowserTabManager {
  readonly listTabs: () => BrowserTabSnapshot[];
  readonly open: (input: BrowserOpenInput) => Promise<BrowserTabSnapshot>;
  readonly navigate: (input: BrowserNavigateInput) => Promise<BrowserTabSnapshot>;
  readonly focus: (input: BrowserFocusInput) => Promise<void>;
  readonly close: (input: BrowserCloseInput) => Promise<void>;
  readonly setPaneBounds: (input: BrowserPaneBoundsInput) => Promise<void>;
  readonly setPaneVisibility: (input: BrowserPaneVisibilityInput) => Promise<void>;
}

export function createDesktopBrowserTabManager(input: {
  readonly appDisplayName: string;
  readonly getOwnerWindow: () => BrowserWindow | null;
  readonly onEvent: (event: BrowserEvent) => void;
}): DesktopBrowserTabManager {
  const tabsById = new Map<string, DesktopBrowserTabRecord>();
  const panesById = new Map<string, DesktopBrowserPaneRecord>();

  const emit = (event: BrowserEvent) => {
    input.onEvent(event);
  };

  const getTargetWindow = () => {
    const owner = input.getOwnerWindow();
    if (!owner || owner.isDestroyed()) {
      return null;
    }
    return owner;
  };

  const detachTab = (tabId: string) => {
    const record = tabsById.get(tabId);
    const targetWindow = getTargetWindow();
    if (!record || !record.attachedPaneId || !targetWindow) {
      if (record) {
        record.attachedPaneId = null;
      }
      return;
    }
    try {
      targetWindow.contentView.removeChildView(record.view);
    } catch {
      // Ignore stale detach attempts when the view is already removed.
    }
    record.attachedPaneId = null;
  };

  const syncTabRecord = (tabId: string): BrowserTabSnapshot | null => {
    const record = tabsById.get(tabId);
    if (!record) {
      return null;
    }
    const nextSnapshot = toSnapshot(record);
    record.snapshot = nextSnapshot;
    emit({ type: "tab-updated", tab: nextSnapshot });
    return nextSnapshot;
  };

  const applyPaneAttachment = (paneId: string) => {
    const pane = panesById.get(paneId);
    const targetWindow = getTargetWindow();
    if (!pane || !targetWindow) {
      return;
    }
    const record = tabsById.get(pane.tabId);
    if (!record) {
      return;
    }
    if (!pane.visible) {
      if (record.attachedPaneId === paneId) {
        detachTab(pane.tabId);
      }
      return;
    }

    if (record.attachedPaneId && record.attachedPaneId !== paneId) {
      detachTab(pane.tabId);
    }

    if (record.attachedPaneId !== paneId) {
      targetWindow.contentView.addChildView(record.view);
      record.attachedPaneId = paneId;
    }
    record.view.setBounds(clampPaneBounds(pane.bounds));
  };

  const attachView = (tabId: string) => {
    const paneId =
      Array.from(panesById.entries()).find(([, candidate]) => candidate.tabId === tabId)?.[0] ??
      null;
    if (!paneId) {
      return;
    }
    applyPaneAttachment(paneId);
  };

  const createView = (tabId: string, initialUrl: string, title: string | null) => {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
      },
    });
    const record: DesktopBrowserTabRecord = {
      view,
      attachedPaneId: null,
      snapshot: {
        id: tabId,
        url: initialUrl,
        title,
        loading: true,
        canGoBack: false,
        canGoForward: false,
      },
    };
    tabsById.set(tabId, record);

    const sync = () => {
      syncTabRecord(tabId);
    };

    view.webContents.setWindowOpenHandler(({ url }) => {
      const externalUrl = getSafeBrowserUrl(url);
      if (externalUrl) {
        void shell.openExternal(externalUrl);
      }
      return { action: "deny" };
    });
    view.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      sync();
    });
    view.webContents.on("did-start-loading", sync);
    view.webContents.on("did-stop-loading", sync);
    view.webContents.on("did-navigate", sync);
    view.webContents.on("did-navigate-in-page", sync);
    emit({ type: "tab-opened", tab: record.snapshot });
    return record;
  };

  return {
    listTabs: () => Array.from(tabsById.values(), (record) => toSnapshot(record)),
    open: async (tabInput) => {
      const nextUrl = getSafeBrowserUrl(tabInput.url);
      if (!nextUrl) {
        throw new Error("Browser tabs support only http(s) URLs.");
      }

      const existingTabId = tabInput.tabId?.trim() || null;
      if (existingTabId) {
        const existing = tabsById.get(existingTabId);
        if (existing) {
          await existing.view.webContents.loadURL(nextUrl);
          attachView(existingTabId);
          return syncTabRecord(existingTabId) ?? toSnapshot(existing);
        }
      }

      const tabId = existingTabId ?? randomUUID();
      const record = createView(tabId, nextUrl, tabInput.title ?? null);
      await record.view.webContents.loadURL(nextUrl);
      attachView(tabId);
      return syncTabRecord(tabId) ?? toSnapshot(record);
    },
    navigate: async (tabInput) => {
      const nextUrl = getSafeBrowserUrl(tabInput.url);
      if (!nextUrl) {
        throw new Error("Browser tabs support only http(s) URLs.");
      }
      const existing = tabsById.get(tabInput.tabId);
      if (!existing) {
        throw new Error("Browser tab not found.");
      }
      await existing.view.webContents.loadURL(nextUrl);
      return syncTabRecord(tabInput.tabId) ?? toSnapshot(existing);
    },
    focus: async (tabInput) => {
      const existing = tabsById.get(tabInput.tabId);
      if (!existing) {
        throw new Error("Browser tab not found.");
      }
      const targetWindow = getTargetWindow();
      if (targetWindow && !targetWindow.isFocused()) {
        targetWindow.focus();
      }
      existing.view.webContents.focus();
      emit({ type: "tab-focused", tabId: tabInput.tabId });
    },
    close: async (tabInput) => {
      const existing = tabsById.get(tabInput.tabId);
      if (!existing) {
        return;
      }
      detachTab(tabInput.tabId);
      tabsById.delete(tabInput.tabId);
      for (const [paneId, pane] of panesById.entries()) {
        if (pane.tabId === tabInput.tabId) {
          panesById.delete(paneId);
        }
      }
      existing.view.webContents.close();
      emit({ type: "tab-closed", tabId: tabInput.tabId });
    },
    setPaneBounds: async (paneInput) => {
      const existing = panesById.get(paneInput.paneId);
      panesById.set(paneInput.paneId, {
        tabId: paneInput.tabId,
        visible: existing?.visible ?? false,
        bounds: clampPaneBounds(paneInput.bounds),
      });
      applyPaneAttachment(paneInput.paneId);
    },
    setPaneVisibility: async (paneInput) => {
      const existing = panesById.get(paneInput.paneId);
      panesById.set(paneInput.paneId, {
        tabId: paneInput.tabId,
        visible: paneInput.visible,
        bounds:
          existing?.bounds ??
          clampPaneBounds({
            x: 0,
            y: 0,
            width: 800,
            height: 600,
          }),
      });
      if (!paneInput.visible) {
        const tab = tabsById.get(paneInput.tabId);
        if (tab?.attachedPaneId === paneInput.paneId) {
          detachTab(paneInput.tabId);
        }
        return;
      }
      applyPaneAttachment(paneInput.paneId);
    },
  };
}
