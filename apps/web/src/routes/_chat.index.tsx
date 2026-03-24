import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore } from "../store";
import { resolveDefaultWorkspaceId } from "../workspaceShell";
import { ensureWorkspaceEntity } from "../workspaceEntities";

function ChatIndexRouteView() {
  const navigate = useNavigate();
  const projects = useStore((store) => store.projects);
  const workspaces = useStore((store) => store.workspaces);
  const workspacesHydrated = useStore((store) => store.workspacesHydrated);
  const recentWorkspaceIds = useStore((store) => store.recentWorkspaceIds);
  const lastActiveWorkspaceId = useStore((store) => store.lastActiveWorkspaceId);

  useEffect(() => {
    if (!workspacesHydrated) {
      return;
    }
    const existingWorkspaceId =
      (lastActiveWorkspaceId &&
      recentWorkspaceIds.includes(lastActiveWorkspaceId) &&
      workspaces.some((workspace) => workspace.id === lastActiveWorkspaceId)
        ? lastActiveWorkspaceId
        : recentWorkspaceIds.find((workspaceId) =>
            workspaces.some((workspace) => workspace.id === workspaceId),
          )) ?? resolveDefaultWorkspaceId(workspaces);
    if (existingWorkspaceId) {
      void navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: existingWorkspaceId },
        replace: true,
      });
      return;
    }
    const firstProjectId = projects[0]?.id;
    if (!firstProjectId) {
      return;
    }
    void ensureWorkspaceEntity({
      projectId: firstProjectId,
      source: "root",
    }).then((workspace) => {
      if (!workspace) {
        return;
      }
      void navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: workspace.id },
        replace: true,
      });
    });
  }, [
    lastActiveWorkspaceId,
    navigate,
    recentWorkspaceIds,
    projects,
    workspaces,
    workspacesHydrated,
  ]);

  return null;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
