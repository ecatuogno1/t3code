import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { parseDiffRouteSearch } from "../diffRouteSearch";
import { useStore } from "../store";
import { resolveDefaultWorkspaceId } from "../workspaceShell";

function LegacyThreadRedirectRouteView() {
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const threads = useStore((store) => store.threads);
  const workspaces = useStore((store) => store.workspaces);
  const workspacesHydrated = useStore((store) => store.workspacesHydrated);
  const openWorkspaceThreadPane = useStore((store) => store.openWorkspaceThreadPane);
  const focusWorkspacePane = useStore((store) => store.focusWorkspacePane);

  useEffect(() => {
    if (!workspacesHydrated) {
      return;
    }
    const thread = threads.find((entry) => entry.id === threadId) ?? null;
    const targetWorkspaceId =
      thread?.workspaceId ??
      workspaces.find((workspace) => workspace.linkedThreadIds.includes(threadId))?.id ??
      resolveDefaultWorkspaceId(workspaces);

    if (!targetWorkspaceId) {
      void navigate({ to: "/", replace: true });
      return;
    }

    if (thread) {
      const paneId = `chat:${thread.id}`;
      openWorkspaceThreadPane(targetWorkspaceId, thread.id);
      focusWorkspacePane(targetWorkspaceId, paneId);
    }

    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: targetWorkspaceId },
      search,
      replace: true,
    });
  }, [
    focusWorkspacePane,
    navigate,
    openWorkspaceThreadPane,
    search,
    threadId,
    threads,
    workspaces,
    workspacesHydrated,
  ]);

  return null;
}

export const Route = createFileRoute("/_chat/$threadId")({
  component: LegacyThreadRedirectRouteView,
});
