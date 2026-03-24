import { WorkspaceId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { openWorkspaceBrowserTab } from "../workspaceBrowser";
import {
  buildWorkspaceFileSelectionValue,
  buildWorkspaceFileTestTargetOpenPath,
  openWorkspaceFileTarget,
  resolveWorkspaceAbsoluteFilePath,
  resolveResponsibleWorkspaceThreadId,
  runWorkspaceResolvedFileTestTarget,
} from "../workspaceFiles";
import { stripDiffSearchParams } from "../diffRouteSearch";

export function useWorkspaceFileNavigation() {
  const navigate = useNavigate();
  const workspaces = useStore((store) => store.workspaces);
  const threads = useStore((store) => store.threads);
  const routeWorkspaceId = useParams({
    strict: false,
    select: (params) => (params.workspaceId ? WorkspaceId.makeUnsafe(params.workspaceId) : null),
  });

  const currentWorkspace =
    (routeWorkspaceId ? workspaces.find((workspace) => workspace.id === routeWorkspaceId) : null) ??
    null;

  const openFileTarget = useCallback(
    async (targetPath: string): Promise<boolean> => {
      if (!routeWorkspaceId) {
        const api = readNativeApi();
        if (!api) {
          return false;
        }
        await openInPreferredEditor(api, targetPath);
        return true;
      }
      const opened = await openWorkspaceFileTarget({
        workspaceId: routeWorkspaceId,
        targetPath,
      });
      if (!opened) {
        return false;
      }
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: routeWorkspaceId },
      });
      return true;
    },
    [navigate, routeWorkspaceId],
  );

  const openRelativeFile = useCallback(
    async (
      relativePath: string,
      line?: number | null,
      column?: number | null,
    ): Promise<boolean> => {
      if (!currentWorkspace) {
        return false;
      }
      const targetPath = resolveWorkspaceAbsoluteFilePath({
        workspace: currentWorkspace,
        relativePath,
      });
      return openFileTarget(
        line ? `${targetPath}:${line}${column ? `:${column}` : ""}` : targetPath,
      );
    },
    [currentWorkspace, openFileTarget],
  );

  const openLatestDiffForFile = useCallback(
    async (relativePath: string): Promise<boolean> => {
      if (!routeWorkspaceId) {
        return false;
      }
      const threadId = resolveResponsibleWorkspaceThreadId(routeWorkspaceId);
      const thread = threadId ? (threads.find((entry) => entry.id === threadId) ?? null) : null;
      if (!thread) {
        return false;
      }
      const matchingTurn = [...thread.turnDiffSummaries]
        .toSorted((left, right) => right.completedAt.localeCompare(left.completedAt))
        .find((summary) => summary.files.some((file) => file.path === relativePath));

      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: routeWorkspaceId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return matchingTurn
            ? {
                ...rest,
                diff: "1" as const,
                diffTurnId: matchingTurn.turnId,
                diffFilePath: relativePath,
              }
            : {
                ...rest,
                diff: "1" as const,
                diffFilePath: relativePath,
              };
        },
      });
      return true;
    },
    [navigate, routeWorkspaceId, threads],
  );

  const openBrowserContextUrl = useCallback(
    async (url: string, title?: string | null): Promise<boolean> => {
      if (!routeWorkspaceId) {
        const api = readNativeApi();
        if (!api) {
          return false;
        }
        await api.shell.openExternal(url);
        return true;
      }
      await openWorkspaceBrowserTab({
        workspaceId: routeWorkspaceId,
        url,
        title: title ?? null,
      });
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: routeWorkspaceId },
      });
      return true;
    },
    [navigate, routeWorkspaceId],
  );

  const runResolvedFileTestTarget = useCallback(
    async (result: Parameters<typeof runWorkspaceResolvedFileTestTarget>[0]["result"]) => {
      if (!routeWorkspaceId) {
        return false;
      }
      return runWorkspaceResolvedFileTestTarget({
        workspaceId: routeWorkspaceId,
        result,
      });
    },
    [routeWorkspaceId],
  );

  const openResolvedFileTestTarget = useCallback(
    async (result: Parameters<typeof buildWorkspaceFileTestTargetOpenPath>[0]["result"]) => {
      if (!currentWorkspace) {
        return false;
      }
      const targetPath = buildWorkspaceFileTestTargetOpenPath({
        workspace: currentWorkspace,
        result,
      });
      if (!targetPath) {
        return false;
      }
      return openFileTarget(targetPath);
    },
    [currentWorkspace, openFileTarget],
  );

  const setFilesPaneSelection = useCallback(
    async (relativePath: string, line?: number | null, column?: number | null) => {
      if (!currentWorkspace) {
        return false;
      }
      return openWorkspaceFileTarget({
        workspaceId: currentWorkspace.id,
        targetPath:
          resolveWorkspaceAbsoluteFilePath({
            workspace: currentWorkspace,
            relativePath,
          }) + (line ? `:${line}${column ? `:${column}` : ""}` : ""),
      });
    },
    [currentWorkspace],
  );

  return {
    currentWorkspace,
    currentWorkspaceId: routeWorkspaceId,
    currentResponsibleThreadId: routeWorkspaceId
      ? resolveResponsibleWorkspaceThreadId(routeWorkspaceId)
      : null,
    openBrowserContextUrl,
    openFileTarget,
    openLatestDiffForFile,
    openRelativeFile,
    openResolvedFileTestTarget,
    runResolvedFileTestTarget,
    setFilesPaneSelection,
    selectionValueForFile: buildWorkspaceFileSelectionValue,
  };
}
