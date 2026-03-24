import fs from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceId,
  WorkspaceProjectContextKey,
  WorkspaceProjectId,
  WorkspaceProjectKind,
  WorkspaceProjectTitle,
} from "@t3tools/contracts";

import type { ProjectionWorkspace } from "../persistence/Services/ProjectionWorkspaces.ts";
import type { ProjectionWorkspaceProject } from "../persistence/Services/ProjectionWorkspaceProjects.ts";

interface DetectedWorkspaceProject {
  readonly title: WorkspaceProjectTitle;
  readonly path: string;
  readonly kind: WorkspaceProjectKind;
  readonly contextKey: WorkspaceProjectContextKey;
}

function normalizeRelativePath(input: string): string {
  const trimmed = input
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  return trimmed.replace(/^\/+|\/+$/g, "");
}

function buildWorkspaceProjectId(
  workspaceId: WorkspaceId,
  relativePath: string,
): WorkspaceProjectId {
  const suffix = relativePath.length === 0 ? "root" : relativePath.replaceAll("/", ":");
  return `workspace-project:${workspaceId}:${suffix}` as WorkspaceProjectId;
}

function buildWorkspaceProjectContextKey(relativePath: string): WorkspaceProjectContextKey {
  return (
    relativePath.length === 0 ? "root" : `path:${relativePath}`
  ) as WorkspaceProjectContextKey;
}

function inferProjectKind(relativePath: string): WorkspaceProjectKind {
  if (relativePath.length === 0) {
    return "root";
  }
  const firstSegment = relativePath.split("/")[0]?.toLowerCase() ?? "";
  if (firstSegment.startsWith("app")) {
    return "app";
  }
  if (firstSegment.startsWith("package") || firstSegment === "packages") {
    return "package";
  }
  return "feature";
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function readWorkspaceGlobs(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }
  const maybeWorkspaces = (manifest as { workspaces?: unknown }).workspaces;
  if (Array.isArray(maybeWorkspaces)) {
    return maybeWorkspaces.filter((value): value is string => typeof value === "string");
  }
  if (
    maybeWorkspaces &&
    typeof maybeWorkspaces === "object" &&
    Array.isArray((maybeWorkspaces as { packages?: unknown }).packages)
  ) {
    return (maybeWorkspaces as { packages: unknown[] }).packages.filter(
      (value): value is string => typeof value === "string",
    );
  }
  return [];
}

async function readPnpmWorkspaceGlobs(rootPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(path.join(rootPath, "pnpm-workspace.yaml"), "utf8");
    const globs: string[] = [];
    let inPackagesSection = false;
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*packages\s*:\s*$/.test(line)) {
        inPackagesSection = true;
        continue;
      }
      if (inPackagesSection && /^\s*[A-Za-z]/.test(line)) {
        inPackagesSection = false;
      }
      const match = inPackagesSection ? line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/) : null;
      if (match?.[1]) {
        globs.push(match[1]);
      }
    }
    return globs;
  } catch {
    return [];
  }
}

async function detectProjectTitles(
  rootPath: string,
  relativePath: string,
): Promise<WorkspaceProjectTitle> {
  if (relativePath.length === 0) {
    return path.basename(rootPath) as WorkspaceProjectTitle;
  }
  const manifest = await readJsonFile(path.join(rootPath, relativePath, "package.json"));
  const packageName =
    manifest &&
    typeof manifest === "object" &&
    typeof (manifest as { name?: unknown }).name === "string"
      ? (manifest as { name: string }).name.trim()
      : "";
  return (packageName || path.basename(relativePath)) as WorkspaceProjectTitle;
}

async function detectWorkspaceProjectCandidates(
  rootPath: string,
): Promise<DetectedWorkspaceProject[]> {
  const manifest = await readJsonFile(path.join(rootPath, "package.json"));
  const workspaceGlobs = new Set<string>([
    ...readWorkspaceGlobs(manifest),
    ...(await readPnpmWorkspaceGlobs(rootPath)),
  ]);
  const detectedPaths = new Set<string>([""]);

  for (const glob of workspaceGlobs) {
    const normalizedGlob = normalizeRelativePath(glob);
    if (!normalizedGlob.endsWith("/*") || normalizedGlob.slice(0, -1).includes("*")) {
      continue;
    }
    const parentDir = normalizedGlob.slice(0, -2);
    if (!parentDir) {
      continue;
    }
    const childNames = await listDirectories(path.join(rootPath, parentDir));
    for (const childName of childNames) {
      detectedPaths.add(normalizeRelativePath(path.posix.join(parentDir, childName)));
    }
  }

  const detected = await Promise.all(
    [...detectedPaths]
      .toSorted((left, right) => left.localeCompare(right))
      .map(async (relativePath) => ({
        title: await detectProjectTitles(rootPath, relativePath),
        path: relativePath,
        kind: inferProjectKind(relativePath),
        contextKey: buildWorkspaceProjectContextKey(relativePath),
      })),
  );
  return detected;
}

export async function detectWorkspaceProjects(
  workspace: Pick<
    ProjectionWorkspace,
    "workspaceId" | "workspaceRoot" | "worktreePath" | "updatedAt"
  >,
): Promise<ProjectionWorkspaceProject[]> {
  const rootPath = workspace.worktreePath ?? workspace.workspaceRoot;
  const now = workspace.updatedAt;
  const detectedProjects = await detectWorkspaceProjectCandidates(rootPath);
  return detectedProjects.map((project) => ({
    workspaceProjectId: buildWorkspaceProjectId(workspace.workspaceId, project.path),
    workspaceId: workspace.workspaceId,
    title: project.title,
    path: project.path,
    kind: project.kind,
    contextKey: project.contextKey,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));
}

export function rootWorkspaceProjectId(workspaceId: WorkspaceId): WorkspaceProjectId {
  return buildWorkspaceProjectId(workspaceId, "");
}

export async function syncWorkspaceProjects(input: {
  workspace: ProjectionWorkspace;
  existingProjects: ReadonlyArray<ProjectionWorkspaceProject>;
}): Promise<ProjectionWorkspaceProject[]> {
  const detectedProjects = await detectWorkspaceProjects(input.workspace);
  const detectedById = new Map(
    detectedProjects.map((project) => [project.workspaceProjectId, project] as const),
  );
  const manualProjects = input.existingProjects.filter(
    (project) => project.contextKey === null && project.deletedAt === null,
  );
  const staleProjects = input.existingProjects
    .filter(
      (project) =>
        project.contextKey !== null &&
        !detectedById.has(project.workspaceProjectId) &&
        project.deletedAt === null,
    )
    .map((project) =>
      Object.assign({}, project, {
        deletedAt: input.workspace.updatedAt,
        updatedAt: input.workspace.updatedAt,
      }),
    );
  return [...detectedProjects, ...manualProjects, ...staleProjects];
}
