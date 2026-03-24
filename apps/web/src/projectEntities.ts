import { DEFAULT_MODEL_BY_PROVIDER, type ProjectId } from "@t3tools/contracts";

import { readNativeApi } from "./nativeApi";
import { newCommandId, newProjectId } from "./lib/utils";
import { useStore } from "./store";

function deriveProjectTitleFromWorkspaceRoot(workspaceRoot: string): string {
  const segments = workspaceRoot.split(/[/\\]/).filter((segment) => segment.trim().length > 0);
  return segments.at(-1) ?? workspaceRoot;
}

export async function createProjectAtPath(rawWorkspaceRoot: string): Promise<ProjectId | null> {
  const workspaceRoot = rawWorkspaceRoot.trim();
  if (!workspaceRoot) {
    return null;
  }

  const api = readNativeApi();
  if (!api) {
    return null;
  }

  const projectId = newProjectId();
  const createdAt = new Date().toISOString();
  await api.orchestration.dispatchCommand({
    type: "project.create",
    commandId: newCommandId(),
    projectId,
    title: deriveProjectTitleFromWorkspaceRoot(workspaceRoot),
    workspaceRoot,
    defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
    createdAt,
  });
  const snapshot = await api.orchestration.getSnapshot();
  useStore.getState().syncServerReadModel(snapshot);
  return projectId;
}
