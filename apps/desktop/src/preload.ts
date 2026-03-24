import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const BROWSER_LIST_TABS_CHANNEL = "desktop:browser-list-tabs";
const BROWSER_OPEN_CHANNEL = "desktop:browser-open";
const BROWSER_NAVIGATE_CHANNEL = "desktop:browser-navigate";
const BROWSER_FOCUS_CHANNEL = "desktop:browser-focus";
const BROWSER_CLOSE_CHANNEL = "desktop:browser-close";
const BROWSER_SET_PANE_BOUNDS_CHANNEL = "desktop:browser-set-pane-bounds";
const BROWSER_SET_PANE_VISIBILITY_CHANNEL = "desktop:browser-set-pane-visibility";
const BROWSER_EVENT_CHANNEL = "desktop:browser-event";
const wsUrl = process.env.T3CODE_DESKTOP_WS_URL ?? null;

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => wsUrl,
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  browser: {
    listTabs: () => ipcRenderer.invoke(BROWSER_LIST_TABS_CHANNEL),
    open: (input) => ipcRenderer.invoke(BROWSER_OPEN_CHANNEL, input),
    navigate: (input) => ipcRenderer.invoke(BROWSER_NAVIGATE_CHANNEL, input),
    focus: (input) => ipcRenderer.invoke(BROWSER_FOCUS_CHANNEL, input),
    close: (input) => ipcRenderer.invoke(BROWSER_CLOSE_CHANNEL, input),
    setPaneBounds: (input) => ipcRenderer.invoke(BROWSER_SET_PANE_BOUNDS_CHANNEL, input),
    setPaneVisibility: (input) => ipcRenderer.invoke(BROWSER_SET_PANE_VISIBILITY_CHANNEL, input),
    onEvent: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, browserEvent: unknown) => {
        if (typeof browserEvent !== "object" || browserEvent === null) {
          return;
        }
        listener(browserEvent as Parameters<typeof listener>[0]);
      };

      ipcRenderer.on(BROWSER_EVENT_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(BROWSER_EVENT_CHANNEL, wrappedListener);
      };
    },
  },
} satisfies DesktopBridge);
