import { useMemo } from "react";
import type { WorkspaceId } from "@t3tools/contracts";
import type { BrowserTabSnapshot } from "@t3tools/contracts";

import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { deriveWorkspaceRowBadge } from "../workspaceActivity";

export function useWorkspaceBadgeById() {
  const workspaces = useStore((store) => store.workspaces);
  const threads = useStore((store) => store.threads);
  const browserRuntimeTabsById = useStore((store) => store.browserRuntimeTabsById);
  const terminalStateByThreadId = useTerminalStateStore((store) => store.terminalStateByThreadId);

  const runningTerminalIdsByThreadId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(terminalStateByThreadId).map(([threadId, state]) => [
          threadId,
          state.runningTerminalIds,
        ]),
      ) as Record<string, string[]>,
    [terminalStateByThreadId],
  );

  const workspaceBadgeById = useMemo(
    () =>
      Object.fromEntries(
        workspaces.map((workspace) => [
          workspace.id,
          deriveWorkspaceRowBadge({
            workspace,
            threads,
            runningTerminalIdsByThreadId,
            browserRuntimeTabsById,
          }),
        ]),
      ) as Record<WorkspaceId, ReturnType<typeof deriveWorkspaceRowBadge>>,
    [browserRuntimeTabsById, runningTerminalIdsByThreadId, threads, workspaces],
  );

  return { workspaceBadgeById, runningTerminalIdsByThreadId };
}
