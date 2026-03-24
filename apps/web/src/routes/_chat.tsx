import { type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";

import ActivityBar, { type ActivityPanelId } from "../components/ActivityBar";
import WorkspaceSidebar from "../components/WorkspaceSidebar";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { isTerminalFocused } from "../lib/terminalFocus";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { resolveShortcutCommand } from "../keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useStore } from "../store";
import { Sidebar, SidebarProvider } from "~/components/ui/sidebar";
import { resolveSidebarNewThreadEnvMode } from "~/components/Sidebar.logic";
import { useAppSettings } from "~/appSettings";
import { parseChatPaneThreadId } from "~/workspaceShell";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadIdsSize = useThreadSelectionStore((state) => state.selectedThreadIds.size);
  const {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeWorkspaceProjectId,
    routeWorkspaceId,
    routeThreadId,
  } = useHandleNewThread();
  const workspaceShellById = useStore((store) => store.workspaceShellById);
  const threads = useStore((store) => store.threads);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const activeWorkspaceThreadId =
    routeWorkspaceId && workspaceShellById[routeWorkspaceId]?.activePaneId
      ? parseChatPaneThreadId(workspaceShellById[routeWorkspaceId].activePaneId ?? "")
      : null;
  const effectiveThreadId = routeThreadId ?? activeWorkspaceThreadId;
  const effectiveThread = effectiveThreadId
    ? threads.find((thread) => thread.id === effectiveThreadId)
    : activeThread;
  const terminalOpen = useTerminalStateStore((state) =>
    effectiveThreadId
      ? selectThreadTerminalState(state.terminalStateByThreadId, effectiveThreadId).terminalOpen
      : false,
  );
  const { settings: appSettings } = useAppSettings();

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape" && selectedThreadIdsSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const projectId =
        effectiveThread?.projectId ?? activeDraftThread?.projectId ?? projects[0]?.id;
      if (!projectId) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(projectId, {
          envMode: resolveSidebarNewThreadEnvMode({
            defaultEnvMode: appSettings.defaultThreadEnvMode,
          }),
          target: {
            workspaceId: routeWorkspaceId ?? effectiveThread?.workspaceId ?? null,
            workspaceProjectId:
              activeDraftThread?.workspaceProjectId ??
              effectiveThread?.workspaceProjectId ??
              routeWorkspaceProjectId ??
              null,
          },
        });
        return;
      }

      if (command !== "chat.new") return;
      event.preventDefault();
      event.stopPropagation();
      void handleNewThread(projectId, {
        branch: effectiveThread?.branch ?? activeDraftThread?.branch ?? null,
        worktreePath: effectiveThread?.worktreePath ?? activeDraftThread?.worktreePath ?? null,
        envMode:
          activeDraftThread?.envMode ?? (effectiveThread?.worktreePath ? "worktree" : "local"),
        target: {
          workspaceId: routeWorkspaceId ?? effectiveThread?.workspaceId ?? null,
          workspaceProjectId:
            activeDraftThread?.workspaceProjectId ??
            effectiveThread?.workspaceProjectId ??
            routeWorkspaceProjectId ??
            null,
        },
      });
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    effectiveThread,
    clearSelection,
    handleNewThread,
    keybindings,
    projects,
    routeWorkspaceProjectId,
    routeWorkspaceId,
    selectedThreadIdsSize,
    terminalOpen,
    appSettings.defaultThreadEnvMode,
  ]);

  return null;
}

function ChatRouteLayout() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const isSettingsRoute = routerState.location.pathname === "/settings";
  const [activePanel, setActivePanel] = useState<ActivityPanelId | null>("files");

  const handleSelectPanel = useCallback((panelId: ActivityPanelId) => {
    setActivePanel((current) => (current === panelId ? null : panelId));
  }, []);

  // Hide the sidebar panel when on settings page.
  const effectivePanel = isSettingsRoute ? null : activePanel;

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider
      open={effectivePanel !== null}
      onOpenChange={(open) => {
        if (!open) setActivePanel(null);
      }}
      className="pl-12"
      style={
        {
          "--sidebar-width": "16rem",
        } as CSSProperties
      }
    >
      <ChatRouteGlobalShortcuts />
      <ActivityBar
        activePanel={effectivePanel}
        onSelectPanel={(panelId) => {
          // If on settings, navigate back to workspace first.
          if (isSettingsRoute) {
            void navigate({ to: "/" });
          }
          handleSelectPanel(panelId);
        }}
        isSettingsActive={isSettingsRoute}
      />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border/65 bg-card/92 text-foreground backdrop-blur-sm"
      >
        <WorkspaceSidebar panelId={effectivePanel} />
      </Sidebar>
      <Outlet />
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
