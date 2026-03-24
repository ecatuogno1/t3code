import type { NativeApi } from "@t3tools/contracts";

function normalizeWorkspaceRoot(workspaceRoot: string | null | undefined): string | null {
  if (!workspaceRoot) {
    return null;
  }
  const trimmed = workspaceRoot.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function scanThreadImports(api: NativeApi, workspaceRoot: string | null | undefined) {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const result = await api.imports.scan(
    normalizedWorkspaceRoot ? { workspaceRoot: normalizedWorkspaceRoot } : undefined,
  );
  return Array.isArray(result) ? result : [];
}

export async function refreshImportedThreadState(
  api: NativeApi,
  callbacks: {
    readonly syncServerReadModel: (
      snapshot: Awaited<ReturnType<NativeApi["orchestration"]["getSnapshot"]>>,
    ) => void;
    readonly syncWorkspaceReadModel: (
      snapshot: Awaited<ReturnType<NativeApi["workspace"]["getSnapshot"]>>,
    ) => void;
  },
) {
  return refreshServerReadModels(api, callbacks);
}

export async function refreshServerReadModels(
  api: NativeApi,
  callbacks: {
    readonly syncServerReadModel: (
      snapshot: Awaited<ReturnType<NativeApi["orchestration"]["getSnapshot"]>>,
    ) => void;
    readonly syncWorkspaceReadModel: (
      snapshot: Awaited<ReturnType<NativeApi["workspace"]["getSnapshot"]>>,
    ) => void;
  },
) {
  const [snapshot, workspaceSnapshot] = await Promise.all([
    api.orchestration.getSnapshot(),
    api.workspace.getSnapshot(),
  ]);
  callbacks.syncServerReadModel(snapshot);
  callbacks.syncWorkspaceReadModel(workspaceSnapshot);
}
