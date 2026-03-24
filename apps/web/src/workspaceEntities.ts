import {
  type ProjectId,
  type WorkspaceContextKey,
  type WorkspaceId,
  type WorkspaceProjectId,
  type WorkspaceProjectKind,
  type WorkspaceSource,
  type WorkspaceSurface,
} from "@t3tools/contracts";

import { readNativeApi } from "./nativeApi";
import { useStore } from "./store";

export function normalizeWorkspaceSource(source: WorkspaceSource): WorkspaceSource {
  if (source === "project-default") {
    return "root";
  }
  if (source === "manual") {
    return "manual-view";
  }
  return source;
}

export function isSavedViewWorkspace(workspace: Pick<WorkspaceSurface, "source">): boolean {
  return normalizeWorkspaceSource(workspace.source) === "manual-view";
}

export function isPrimaryWorkspace(workspace: Pick<WorkspaceSurface, "source">): boolean {
  return !isSavedViewWorkspace(workspace);
}

function compareProjectWorkspacePriority(
  left: Pick<WorkspaceSurface, "id" | "projectId" | "source" | "createdAt">,
  right: Pick<WorkspaceSurface, "id" | "projectId" | "source" | "createdAt">,
): number {
  const leftIsCanonicalRootId =
    left.id === (`workspace:${left.projectId}:project-root` as WorkspaceId);
  const rightIsCanonicalRootId =
    right.id === (`workspace:${right.projectId}:project-root` as WorkspaceId);
  if (leftIsCanonicalRootId !== rightIsCanonicalRootId) {
    return leftIsCanonicalRootId ? -1 : 1;
  }

  const leftSource = normalizeWorkspaceSource(left.source);
  const rightSource = normalizeWorkspaceSource(right.source);
  if (leftSource !== rightSource) {
    if (leftSource === "root") {
      return -1;
    }
    if (rightSource === "root") {
      return 1;
    }
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }

  return left.id.localeCompare(right.id);
}

function normalizePath(path: string | null | undefined): string | null {
  return path?.trim() ? path.trim() : null;
}

export function buildWorkspaceContextKey(input: {
  source: WorkspaceSource;
  worktreePath?: string | null;
  pullRequestUrl?: string | null;
}): WorkspaceContextKey | null {
  switch (input.source) {
    case "manual-view":
    case "manual":
      return null;
    case "root":
    case "project-default":
      return "root" as WorkspaceContextKey;
    case "worktree": {
      const worktreePath = normalizePath(input.worktreePath);
      return worktreePath ? (`worktree:${worktreePath}` as WorkspaceContextKey) : null;
    }
    case "pull-request": {
      const pullRequestUrl = normalizePath(input.pullRequestUrl);
      if (pullRequestUrl) {
        return `pull-request:${pullRequestUrl}` as WorkspaceContextKey;
      }
      const worktreePath = normalizePath(input.worktreePath);
      return worktreePath ? (`pull-request:${worktreePath}` as WorkspaceContextKey) : null;
    }
  }
}

export function findWorkspaceByContext(input: {
  workspaces: readonly WorkspaceSurface[];
  projectId: ProjectId;
  source: WorkspaceSource;
  worktreePath?: string | null;
  pullRequestUrl?: string | null;
}): WorkspaceSurface | null {
  const normalizedWorktreePath = normalizePath(input.worktreePath);
  const contextKey = buildWorkspaceContextKey(input);
  const normalizedSource = normalizeWorkspaceSource(input.source);
  return (
    input.workspaces.find(
      (workspace) =>
        workspace.projectId === input.projectId &&
        workspace.deletedAt === null &&
        ((contextKey !== null && workspace.contextKey === contextKey) ||
          (contextKey === null &&
            workspace.source === normalizedSource &&
            normalizePath(workspace.worktreePath) === normalizedWorktreePath)),
    ) ?? null
  );
}

export function resolveProjectDefaultWorkspace(
  workspaces: readonly WorkspaceSurface[],
  projectId: ProjectId,
): WorkspaceSurface | null {
  return (
    workspaces
      .filter((workspace) => workspace.projectId === projectId && workspace.deletedAt === null)
      .toSorted(compareProjectWorkspacePriority)[0] ?? null
  );
}

export async function ensureWorkspaceEntity(input: {
  projectId: ProjectId;
  source: WorkspaceSource;
  title?: string;
  worktreePath?: string | null;
  pullRequestUrl?: string | null;
}): Promise<WorkspaceSurface | null> {
  const state = useStore.getState();
  const existing = findWorkspaceByContext({
    workspaces: state.workspaces,
    projectId: input.projectId,
    source: input.source,
    worktreePath: input.worktreePath ?? null,
    pullRequestUrl: input.pullRequestUrl ?? null,
  });
  if (existing) {
    return existing;
  }

  const api = readNativeApi();
  if (!api) {
    return null;
  }

  const result = await api.workspace.dispatchCommand({
    type: "workspace.create",
    projectId: input.projectId,
    title: input.title,
    source: input.source,
    contextKey: buildWorkspaceContextKey({
      source: input.source,
      worktreePath: input.worktreePath ?? null,
      pullRequestUrl: input.pullRequestUrl ?? null,
    }),
    worktreePath: normalizePath(input.worktreePath),
    createdAt: new Date().toISOString(),
  });

  const snapshot = await api.workspace.getSnapshot();
  useStore.getState().syncWorkspaceReadModel(snapshot);
  if (!result.workspaceId) {
    return null;
  }
  return (
    useStore.getState().workspaces.find((workspace) => workspace.id === result.workspaceId) ?? null
  );
}

export async function createManualWorkspace(input: {
  projectId: ProjectId;
  title: string;
}): Promise<WorkspaceId | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }
  const result = await api.workspace.dispatchCommand({
    type: "workspace.create",
    projectId: input.projectId,
    title: input.title.trim(),
    source: "manual-view",
    contextKey: null,
    worktreePath: null,
    createdAt: new Date().toISOString(),
  });
  const snapshot = await api.workspace.getSnapshot();
  useStore.getState().syncWorkspaceReadModel(snapshot);
  return result.workspaceId ?? null;
}

export async function createWorktreeWorkspace(input: {
  projectId: ProjectId;
  cwd: string;
  branch: string;
  newBranch?: string;
  title?: string;
}): Promise<WorkspaceSurface | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }
  const worktreeResult = await api.git.createWorktree({
    cwd: input.cwd,
    branch: input.branch,
    newBranch: input.newBranch,
    path: null,
  });
  const workspace = await ensureWorkspaceEntity({
    projectId: input.projectId,
    source: "worktree",
    title: input.title ?? input.newBranch ?? worktreeResult.worktree.branch,
    worktreePath: worktreeResult.worktree.path,
  });
  return workspace;
}

export async function renameWorkspace(input: {
  workspaceId: WorkspaceId;
  title: string;
}): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }
  await api.workspace.dispatchCommand({
    type: "workspace.rename",
    workspaceId: input.workspaceId,
    title: input.title.trim(),
    updatedAt: new Date().toISOString(),
  });
}

export async function archiveWorkspace(workspaceId: WorkspaceId): Promise<void> {
  const api = readNativeApi();
  if (!api) {
    return;
  }
  await api.workspace.dispatchCommand({
    type: "workspace.archive",
    workspaceId,
    updatedAt: new Date().toISOString(),
  });
}

export async function createWorkspaceProject(input: {
  workspaceId: WorkspaceId;
  title: string;
  path?: string;
  kind?: WorkspaceProjectKind;
}): Promise<WorkspaceProjectId | null> {
  const api = readNativeApi();
  if (!api) {
    return null;
  }
  await api.workspace.dispatchCommand({
    type: "workspaceProject.create",
    workspaceId: input.workspaceId,
    title: input.title.trim(),
    path: input.path?.trim() ?? "",
    kind: input.kind ?? "app",
    createdAt: new Date().toISOString(),
  });
  const snapshot = await api.workspace.getSnapshot();
  useStore.getState().syncWorkspaceReadModel(snapshot);
  const createdWorkspaceProject =
    useStore
      .getState()
      .workspaceProjects.toReversed()
      .find(
        (workspaceProject) =>
          workspaceProject.workspaceId === input.workspaceId &&
          workspaceProject.deletedAt === null &&
          workspaceProject.title === input.title.trim() &&
          workspaceProject.path === (input.path?.trim() ?? ""),
      ) ?? null;
  return createdWorkspaceProject?.id ?? null;
}
