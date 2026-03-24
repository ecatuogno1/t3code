import {
  type BrowserEvent,
  type BrowserTabSnapshot,
  CommandId,
  type ContextMenuItem,
  EventId,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationEvent,
  ProjectId,
  ThreadId,
  WorkspaceId,
  WORKSPACE_WS_METHODS,
  type WsPushChannel,
  type WsPushData,
  type WsPushMessage,
  WS_CHANNELS,
  WS_METHODS,
  type WsPush,
  type ServerProviderStatus,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn<(...args: Array<unknown>) => Promise<unknown>>();
const showContextMenuFallbackMock =
  vi.fn<
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>
  >();
const channelListeners = new Map<string, Set<(message: WsPush) => void>>();
const latestPushByChannel = new Map<string, WsPush>();
const subscribeMock = vi.fn<
  (
    channel: string,
    listener: (message: WsPush) => void,
    options?: { replayLatest?: boolean },
  ) => () => void
>((channel, listener, options) => {
  const listeners = channelListeners.get(channel) ?? new Set<(message: WsPush) => void>();
  listeners.add(listener);
  channelListeners.set(channel, listeners);
  const latest = latestPushByChannel.get(channel);
  if (latest && options?.replayLatest) {
    listener(latest);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      channelListeners.delete(channel);
    }
  };
});

vi.mock("./wsTransport", () => {
  return {
    WsTransport: class MockWsTransport {
      request = requestMock;
      subscribe = subscribeMock;
      getLatestPush(channel: string) {
        return latestPushByChannel.get(channel) ?? null;
      }
    },
  };
});

vi.mock("./contextMenuFallback", () => ({
  showContextMenuFallback: showContextMenuFallbackMock,
}));

let nextPushSequence = 1;

function emitPush<C extends WsPushChannel>(channel: C, data: WsPushData<C>): void {
  const listeners = channelListeners.get(channel);
  const message = {
    type: "push" as const,
    sequence: nextPushSequence++,
    channel,
    data,
  } as WsPushMessage<C>;
  latestPushByChannel.set(channel, message);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(message);
  }
}

function getWindowForTest(): Window & typeof globalThis & { desktopBridge?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { desktopBridge?: unknown };
  };
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { desktopBridge?: unknown };
  }
  return testGlobal.window;
}

const defaultProviders: ReadonlyArray<ServerProviderStatus> = [
  {
    provider: "codex",
    status: "ready",
    available: true,
    authStatus: "authenticated",
    checkedAt: "2026-01-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.resetModules();
  requestMock.mockReset();
  showContextMenuFallbackMock.mockReset();
  subscribeMock.mockClear();
  channelListeners.clear();
  latestPushByChannel.clear();
  nextPushSequence = 1;
  Reflect.deleteProperty(getWindowForTest(), "desktopBridge");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsNativeApi", () => {
  it("delivers and caches valid server.welcome payloads", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    const payload = { cwd: "/tmp/workspace", projectName: "t3-code" };
    emitPush(WS_CHANNELS.serverWelcome, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining(payload));

    const lateListener = vi.fn();
    onServerWelcome(lateListener);

    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledWith(expect.objectContaining(payload));
  });

  it("preserves bootstrap ids from server.welcome payloads", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    emitPush(WS_CHANNELS.serverWelcome, {
      cwd: "/tmp/workspace",
      projectName: "t3-code",
      bootstrapProjectId: ProjectId.makeUnsafe("project-1"),
      bootstrapThreadId: ThreadId.makeUnsafe("thread-1"),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/workspace",
        projectName: "t3-code",
        bootstrapProjectId: "project-1",
        bootstrapThreadId: "thread-1",
      }),
    );
  });

  it("delivers successive server.welcome payloads to active listeners", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    emitPush(WS_CHANNELS.serverWelcome, { cwd: "/tmp/one", projectName: "one" });
    emitPush(WS_CHANNELS.serverWelcome, { cwd: "/tmp/workspace", projectName: "t3-code" });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cwd: "/tmp/workspace",
        projectName: "t3-code",
      }),
    );
  });

  it("delivers and caches valid server.configUpdated payloads", async () => {
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerConfigUpdated(listener);

    const payload = {
      issues: [
        {
          kind: "keybindings.invalid-entry",
          index: 1,
          message: "Entry at index 1 is invalid.",
        },
      ],
      providers: defaultProviders,
    } as const;
    emitPush(WS_CHANNELS.serverConfigUpdated, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);

    const lateListener = vi.fn();
    onServerConfigUpdated(lateListener);
    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledWith(payload);
  });

  it("delivers successive server.configUpdated payloads to active listeners", async () => {
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerConfigUpdated(listener);

    emitPush(WS_CHANNELS.serverConfigUpdated, {
      issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
      providers: defaultProviders,
    });
    emitPush(WS_CHANNELS.serverConfigUpdated, {
      issues: [],
      providers: defaultProviders,
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      issues: [],
      providers: defaultProviders,
    });
  });

  it("forwards valid terminal and orchestration events", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const onTerminalEvent = vi.fn();
    const onDomainEvent = vi.fn();

    api.terminal.onEvent(onTerminalEvent);
    api.orchestration.onDomainEvent(onDomainEvent);

    const terminalEvent = {
      threadId: "thread-1",
      terminalId: "terminal-1",
      createdAt: "2026-02-24T00:00:00.000Z",
      type: "output",
      data: "hello",
    } as const;
    emitPush(WS_CHANNELS.terminalEvent, terminalEvent);

    const orchestrationEvent = {
      sequence: 1,
      eventId: EventId.makeUnsafe("event-1"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("project-1"),
      occurredAt: "2026-02-24T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/workspace",
        defaultModel: null,
        scripts: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
    } satisfies Extract<OrchestrationEvent, { type: "project.created" }>;
    emitPush(ORCHESTRATION_WS_CHANNELS.domainEvent, orchestrationEvent);

    expect(onTerminalEvent).toHaveBeenCalledTimes(1);
    expect(onTerminalEvent).toHaveBeenCalledWith(terminalEvent);
    expect(onDomainEvent).toHaveBeenCalledTimes(1);
    expect(onDomainEvent).toHaveBeenCalledWith(orchestrationEvent);
  });

  it("wraps orchestration dispatch commands in the command envelope", async () => {
    requestMock.mockResolvedValue(undefined);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const command = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModel: "gpt-5-codex",
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(command);

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.dispatchCommand, {
      command,
    });
  });

  it("forwards workspace file writes to the websocket project method", async () => {
    requestMock.mockResolvedValue({ relativePath: "plan.md" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.writeFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsWriteFile, {
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });
  });

  it("forwards workspace directory listing to the websocket project method", async () => {
    requestMock.mockResolvedValue({ directoryPath: "src", entries: [] });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.listDirectory({
      cwd: "/tmp/project",
      directoryPath: "src",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsListDirectory, {
      cwd: "/tmp/project",
      directoryPath: "src",
    });
  });

  it("forwards workspace file preview requests to the websocket project method", async () => {
    requestMock.mockResolvedValue({
      relativePath: "src/app.ts",
      contents: "export {};",
      isBinary: false,
      truncated: false,
      sizeBytes: 10,
      previewMaxBytes: 262144,
    });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.readFile({
      cwd: "/tmp/project",
      relativePath: "src/app.ts",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsReadFile, {
      cwd: "/tmp/project",
      relativePath: "src/app.ts",
    });
  });

  it("forwards workspace file test target requests to the websocket project method", async () => {
    requestMock.mockResolvedValue({ kind: "unsupported" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.resolveFileTestTarget({
      cwd: "/tmp/project",
      relativePath: "src/app.ts",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsResolveFileTestTarget, {
      cwd: "/tmp/project",
      relativePath: "src/app.ts",
    });
  });

  it("forwards full-thread diff requests to the orchestration websocket method", async () => {
    requestMock.mockResolvedValue({ diff: "patch" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.orchestration.getFullThreadDiff({
      threadId: ThreadId.makeUnsafe("thread-1"),
      toTurnCount: 1,
    });

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
      threadId: "thread-1",
      toTurnCount: 1,
    });
  });

  it("forwards context menu metadata to desktop bridge", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("delete");
    Object.defineProperty(getWindowForTest(), "desktopBridge", {
      configurable: true,
      writable: true,
      value: {
        showContextMenu,
      },
    });

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    await api.contextMenu.show(
      [
        { id: "rename", label: "Rename thread" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      { x: 200, y: 300 },
    );

    expect(showContextMenu).toHaveBeenCalledWith(
      [
        { id: "rename", label: "Rename thread" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      { x: 200, y: 300 },
    );
  });

  it("uses fallback context menu when desktop bridge is unavailable", async () => {
    showContextMenuFallbackMock.mockResolvedValue("delete");
    Reflect.deleteProperty(getWindowForTest(), "desktopBridge");

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    await api.contextMenu.show([{ id: "delete", label: "Delete", destructive: true }], {
      x: 20,
      y: 30,
    });

    expect(showContextMenuFallbackMock).toHaveBeenCalledWith(
      [{ id: "delete", label: "Delete", destructive: true }],
      { x: 20, y: 30 },
    );
  });

  it("forwards browser tab methods to the desktop bridge", async () => {
    const browserTab: BrowserTabSnapshot = {
      id: "tab-1",
      url: "https://example.com",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const listTabs = vi.fn().mockResolvedValue([browserTab]);
    const open = vi.fn().mockResolvedValue(browserTab);
    const navigate = vi.fn().mockResolvedValue({
      ...browserTab,
      url: "https://openai.com",
      title: "OpenAI",
    });
    const focus = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const setPaneBounds = vi.fn().mockResolvedValue(undefined);
    const setPaneVisibility = vi.fn().mockResolvedValue(undefined);
    const onEvent = vi.fn((listener: (event: BrowserEvent) => void) => {
      listener({ type: "tab-focused", tabId: "tab-1" });
      return () => undefined;
    });
    Object.defineProperty(getWindowForTest(), "desktopBridge", {
      configurable: true,
      writable: true,
      value: {
        browser: {
          listTabs,
          open,
          navigate,
          focus,
          close,
          setPaneBounds,
          setPaneVisibility,
          onEvent,
        },
      },
    });

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    const listener = vi.fn();

    await expect(api.browser.listTabs()).resolves.toEqual([browserTab]);
    await expect(api.browser.open({ url: "https://example.com" })).resolves.toEqual(browserTab);
    await expect(
      api.browser.navigate({ tabId: "tab-1", url: "https://openai.com" }),
    ).resolves.toEqual({
      ...browserTab,
      url: "https://openai.com",
      title: "OpenAI",
    });
    await expect(api.browser.focus({ tabId: "tab-1" })).resolves.toBeUndefined();
    await expect(api.browser.close({ tabId: "tab-1" })).resolves.toBeUndefined();
    await expect(
      api.browser.setPaneBounds({
        tabId: "tab-1",
        paneId: "browser:tab-1",
        bounds: { x: 10, y: 20, width: 300, height: 200 },
      }),
    ).resolves.toBeUndefined();
    await expect(
      api.browser.setPaneVisibility({
        tabId: "tab-1",
        paneId: "browser:tab-1",
        visible: true,
      }),
    ).resolves.toBeUndefined();
    const unsubscribe = api.browser.onEvent(listener);

    expect(listTabs).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ url: "https://example.com" });
    expect(navigate).toHaveBeenCalledWith({ tabId: "tab-1", url: "https://openai.com" });
    expect(focus).toHaveBeenCalledWith({ tabId: "tab-1" });
    expect(close).toHaveBeenCalledWith({ tabId: "tab-1" });
    expect(setPaneBounds).toHaveBeenCalledWith({
      tabId: "tab-1",
      paneId: "browser:tab-1",
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    });
    expect(setPaneVisibility).toHaveBeenCalledWith({
      tabId: "tab-1",
      paneId: "browser:tab-1",
      visible: true,
    });
    expect(listener).toHaveBeenCalledWith({ type: "tab-focused", tabId: "tab-1" });
    unsubscribe();
  });

  it("falls back to a plain browser open when desktop browser tabs are unavailable", async () => {
    const openWindow = vi.fn();
    vi.stubGlobal("open", openWindow);

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();

    await expect(api.browser.listTabs()).resolves.toEqual([]);
    await expect(
      api.browser.open({ url: "https://example.com", title: "Example" }),
    ).resolves.toEqual({
      id: "https://example.com",
      url: "https://example.com",
      title: "Example",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    });
    await expect(api.browser.close({ tabId: "tab-1" })).resolves.toBeUndefined();
    await expect(
      api.browser.setPaneBounds({
        tabId: "tab-1",
        paneId: "browser:tab-1",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ).resolves.toBeUndefined();
    await expect(
      api.browser.setPaneVisibility({
        tabId: "tab-1",
        paneId: "browser:tab-1",
        visible: false,
      }),
    ).resolves.toBeUndefined();
    await expect(api.browser.focus({ tabId: "tab-1" })).rejects.toThrow(
      "Embedded browser tabs are only available in desktop builds.",
    );
    expect(openWindow).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("forwards workspace dispatchCommand requests to the workspace websocket method", async () => {
    requestMock.mockResolvedValue({ updatedAt: "2026-03-20T00:00:00.000Z" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const workspaceId = WorkspaceId.makeUnsafe("workspace:project-1:project-root");
    await api.workspace.dispatchCommand({
      type: "workspace.layout.update",
      workspaceId,
      paneOrder: ["chat:thread-1"],
      activePaneId: "chat:thread-1",
      lastFocusedPaneId: "chat:thread-1",
      updatedAt: "2026-03-20T00:00:00.000Z",
    });

    expect(requestMock).toHaveBeenCalledWith(WORKSPACE_WS_METHODS.dispatchCommand, {
      command: {
        type: "workspace.layout.update",
        workspaceId: "workspace:project-1:project-root",
        paneOrder: ["chat:thread-1"],
        activePaneId: "chat:thread-1",
        lastFocusedPaneId: "chat:thread-1",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    });
  });
});
