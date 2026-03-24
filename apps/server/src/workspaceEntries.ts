import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { runProcess } from "./processRunner";

import {
  ProjectEntry,
  type ProjectListDirectoryInput,
  type ProjectListDirectoryResult,
  PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
  type ProjectReadFileInput,
  type ProjectReadFileResult,
  type ProjectResolveFileTestTargetInput,
  type ProjectResolveFileTestTargetResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";

const WORKSPACE_CACHE_TTL_MS = 15_000;
const WORKSPACE_CACHE_MAX_KEYS = 4;
const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

interface WorkspaceIndex {
  scannedAt: number;
  entries: SearchableWorkspaceEntry[];
  truncated: boolean;
}

interface SearchableWorkspaceEntry extends ProjectEntry {
  normalizedPath: string;
  normalizedName: string;
}

interface RankedWorkspaceEntry {
  entry: SearchableWorkspaceEntry;
  score: number;
}

const workspaceIndexCache = new Map<string, WorkspaceIndex>();
const inFlightWorkspaceIndexBuilds = new Map<string, Promise<WorkspaceIndex>>();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function normalizeRelativeWorkspacePath(input: string): string | null {
  const trimmed = input.trim().replaceAll("\\", "/");
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.startsWith("/")) {
    return null;
  }
  const segments = trimmed.split("/");
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalizedSegments.length === 0) {
        return null;
      }
      normalizedSegments.pop();
      continue;
    }
    normalizedSegments.push(segment);
  }
  return normalizedSegments.join("/");
}

function resolveWorkspacePath(
  cwd: string,
  relativePath: string,
): {
  absolutePath: string;
  relativePath: string;
} | null {
  const normalizedRelativePath = normalizeRelativeWorkspacePath(relativePath);
  if (normalizedRelativePath === null) {
    return null;
  }
  const absolutePath = normalizedRelativePath ? path.join(cwd, normalizedRelativePath) : cwd;
  const relativeToRoot = toPosixPath(path.relative(cwd, absolutePath));
  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith("../") ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }
  return {
    absolutePath,
    relativePath: normalizedRelativePath,
  };
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function toSearchableWorkspaceEntry(entry: ProjectEntry): SearchableWorkspaceEntry {
  const normalizedPath = entry.path.toLowerCase();
  return {
    ...entry,
    normalizedPath,
    normalizedName: basenameOf(normalizedPath),
  };
}

function normalizeQuery(input: string): string {
  return input
    .trim()
    .replace(/^[@./]+/, "")
    .toLowerCase();
}

function scoreSubsequenceMatch(value: string, query: string): number | null {
  if (!query) return 0;

  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -1;
  let gapPenalty = 0;

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = valueIndex;
    }
    if (previousMatchIndex !== -1) {
      gapPenalty += valueIndex - previousMatchIndex - 1;
    }

    previousMatchIndex = valueIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      const spanPenalty = valueIndex - firstMatchIndex + 1 - query.length;
      const lengthPenalty = Math.min(64, value.length - query.length);
      return firstMatchIndex * 2 + gapPenalty * 3 + spanPenalty + lengthPenalty;
    }
  }

  return null;
}

function scoreEntry(entry: SearchableWorkspaceEntry, query: string): number | null {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const { normalizedPath, normalizedName } = entry;

  if (normalizedName === query) return 0;
  if (normalizedPath === query) return 1;
  if (normalizedName.startsWith(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  if (normalizedPath.includes(`/${query}`)) return 4;
  if (normalizedName.includes(query)) return 5;
  if (normalizedPath.includes(query)) return 6;

  const nameFuzzyScore = scoreSubsequenceMatch(normalizedName, query);
  if (nameFuzzyScore !== null) {
    return 100 + nameFuzzyScore;
  }

  const pathFuzzyScore = scoreSubsequenceMatch(normalizedPath, query);
  if (pathFuzzyScore !== null) {
    return 200 + pathFuzzyScore;
  }

  return null;
}

function compareRankedWorkspaceEntries(
  left: RankedWorkspaceEntry,
  right: RankedWorkspaceEntry,
): number {
  const scoreDelta = left.score - right.score;
  if (scoreDelta !== 0) return scoreDelta;
  return left.entry.path.localeCompare(right.entry.path);
}

function findInsertionIndex(
  rankedEntries: RankedWorkspaceEntry[],
  candidate: RankedWorkspaceEntry,
): number {
  let low = 0;
  let high = rankedEntries.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const current = rankedEntries[middle];
    if (!current) {
      break;
    }

    if (compareRankedWorkspaceEntries(candidate, current) < 0) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

function insertRankedEntry(
  rankedEntries: RankedWorkspaceEntry[],
  candidate: RankedWorkspaceEntry,
  limit: number,
): void {
  if (limit <= 0) {
    return;
  }

  const insertionIndex = findInsertionIndex(rankedEntries, candidate);
  if (rankedEntries.length < limit) {
    rankedEntries.splice(insertionIndex, 0, candidate);
    return;
  }

  if (insertionIndex >= limit) {
    return;
  }

  rankedEntries.splice(insertionIndex, 0, candidate);
  rankedEntries.pop();
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0];
  if (!firstSegment) return false;
  return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];

  // If output was truncated, the final token can be partial.
  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }

  return parts.filter((value) => value.length > 0);
}

function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];
  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from({ length: items.length }) as TOutput[];
  let nextIndex = 0;

  const workers = Array.from({ length: boundedConcurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex] as TInput, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function isInsideGitWorkTree(cwd: string): Promise<boolean> {
  const insideWorkTree = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    allowNonZeroExit: true,
    timeoutMs: 5_000,
    maxBufferBytes: 4_096,
  }).catch(() => null);
  return Boolean(
    insideWorkTree && insideWorkTree.code === 0 && insideWorkTree.stdout.trim() === "true",
  );
}

async function filterGitIgnoredPaths(cwd: string, relativePaths: string[]): Promise<string[]> {
  if (relativePaths.length === 0) {
    return relativePaths;
  }

  const ignoredPaths = new Set<string>();
  let chunk: string[] = [];
  let chunkBytes = 0;

  const flushChunk = async (): Promise<boolean> => {
    if (chunk.length === 0) {
      return true;
    }

    const checkIgnore = await runProcess("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxBufferBytes: 16 * 1024 * 1024,
      outputMode: "truncate",
      stdin: `${chunk.join("\0")}\0`,
    }).catch(() => null);
    chunk = [];
    chunkBytes = 0;

    if (!checkIgnore) {
      return false;
    }

    // git-check-ignore exits with 1 when no paths match.
    if (checkIgnore.code !== 0 && checkIgnore.code !== 1) {
      return false;
    }

    const matchedIgnoredPaths = splitNullSeparatedPaths(
      checkIgnore.stdout,
      Boolean(checkIgnore.stdoutTruncated),
    );
    for (const ignoredPath of matchedIgnoredPaths) {
      ignoredPaths.add(ignoredPath);
    }
    return true;
  };

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1;
    if (
      chunk.length > 0 &&
      chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES &&
      !(await flushChunk())
    ) {
      return relativePaths;
    }

    chunk.push(relativePath);
    chunkBytes += relativePathBytes;

    if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES && !(await flushChunk())) {
      return relativePaths;
    }
  }

  if (!(await flushChunk())) {
    return relativePaths;
  }

  if (ignoredPaths.size === 0) {
    return relativePaths;
  }

  return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
}

async function buildWorkspaceIndexFromGit(cwd: string): Promise<WorkspaceIndex | null> {
  if (!(await isInsideGitWorkTree(cwd))) {
    return null;
  }

  const listedFiles = await runProcess(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxBufferBytes: 16 * 1024 * 1024,
      outputMode: "truncate",
    },
  ).catch(() => null);
  if (!listedFiles || listedFiles.code !== 0) {
    return null;
  }

  const listedPaths = splitNullSeparatedPaths(
    listedFiles.stdout,
    Boolean(listedFiles.stdoutTruncated),
  )
    .map((entry) => toPosixPath(entry))
    .filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry));
  const filePaths = await filterGitIgnoredPaths(cwd, listedPaths);

  const directorySet = new Set<string>();
  for (const filePath of filePaths) {
    for (const directoryPath of directoryAncestorsOf(filePath)) {
      if (!isPathInIgnoredDirectory(directoryPath)) {
        directorySet.add(directoryPath);
      }
    }
  }

  const directoryEntries = [...directorySet]
    .toSorted((left, right) => left.localeCompare(right))
    .map(
      (directoryPath): ProjectEntry => ({
        path: directoryPath,
        kind: "directory",
        parentPath: parentPathOf(directoryPath),
      }),
    )
    .map(toSearchableWorkspaceEntry);
  const fileEntries = [...new Set(filePaths)]
    .toSorted((left, right) => left.localeCompare(right))
    .map(
      (filePath): ProjectEntry => ({
        path: filePath,
        kind: "file",
        parentPath: parentPathOf(filePath),
      }),
    )
    .map(toSearchableWorkspaceEntry);

  const entries = [...directoryEntries, ...fileEntries];
  return {
    scannedAt: Date.now(),
    entries: entries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES),
    truncated: Boolean(listedFiles.stdoutTruncated) || entries.length > WORKSPACE_INDEX_MAX_ENTRIES,
  };
}

async function buildWorkspaceIndex(cwd: string): Promise<WorkspaceIndex> {
  const gitIndexed = await buildWorkspaceIndexFromGit(cwd);
  if (gitIndexed) {
    return gitIndexed;
  }
  const shouldFilterWithGitIgnore = await isInsideGitWorkTree(cwd);

  let pendingDirectories: string[] = [""];
  const entries: SearchableWorkspaceEntry[] = [];
  let truncated = false;

  while (pendingDirectories.length > 0 && !truncated) {
    const currentDirectories = pendingDirectories;
    pendingDirectories = [];
    const directoryEntries = await mapWithConcurrency(
      currentDirectories,
      WORKSPACE_SCAN_READDIR_CONCURRENCY,
      async (relativeDir) => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        try {
          const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
          return { relativeDir, dirents };
        } catch (error) {
          if (!relativeDir) {
            throw new Error(
              `Unable to scan workspace entries at '${cwd}': ${error instanceof Error ? error.message : "unknown error"}`,
              { cause: error },
            );
          }
          return { relativeDir, dirents: null };
        }
      },
    );

    const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
      const { relativeDir, dirents } = directoryEntry;
      if (!dirents) return [] as Array<{ dirent: Dirent; relativePath: string }>;

      dirents.sort((left, right) => left.name.localeCompare(right.name));
      const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
      for (const dirent of dirents) {
        if (!dirent.name || dirent.name === "." || dirent.name === "..") {
          continue;
        }
        if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
          continue;
        }
        if (!dirent.isDirectory() && !dirent.isFile()) {
          continue;
        }

        const relativePath = toPosixPath(
          relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
        );
        if (isPathInIgnoredDirectory(relativePath)) {
          continue;
        }
        candidates.push({ dirent, relativePath });
      }
      return candidates;
    });

    const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
      candidateEntries.map((entry) => entry.relativePath),
    );
    const allowedPathSet = shouldFilterWithGitIgnore
      ? new Set(await filterGitIgnoredPaths(cwd, candidatePaths))
      : null;

    for (const candidateEntries of candidateEntriesByDirectory) {
      for (const candidate of candidateEntries) {
        if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
          continue;
        }

        const entry = toSearchableWorkspaceEntry({
          path: candidate.relativePath,
          kind: candidate.dirent.isDirectory() ? "directory" : "file",
          parentPath: parentPathOf(candidate.relativePath),
        });
        entries.push(entry);

        if (candidate.dirent.isDirectory()) {
          pendingDirectories.push(candidate.relativePath);
        }

        if (entries.length >= WORKSPACE_INDEX_MAX_ENTRIES) {
          truncated = true;
          break;
        }
      }

      if (truncated) {
        break;
      }
    }
  }

  return {
    scannedAt: Date.now(),
    entries,
    truncated,
  };
}

async function getWorkspaceIndex(cwd: string): Promise<WorkspaceIndex> {
  const cached = workspaceIndexCache.get(cwd);
  if (cached && Date.now() - cached.scannedAt < WORKSPACE_CACHE_TTL_MS) {
    return cached;
  }

  const inFlight = inFlightWorkspaceIndexBuilds.get(cwd);
  if (inFlight) {
    return inFlight;
  }

  const nextPromise = buildWorkspaceIndex(cwd)
    .then((next) => {
      workspaceIndexCache.set(cwd, next);
      while (workspaceIndexCache.size > WORKSPACE_CACHE_MAX_KEYS) {
        const oldestKey = workspaceIndexCache.keys().next().value;
        if (!oldestKey) break;
        workspaceIndexCache.delete(oldestKey);
      }
      return next;
    })
    .finally(() => {
      inFlightWorkspaceIndexBuilds.delete(cwd);
    });
  inFlightWorkspaceIndexBuilds.set(cwd, nextPromise);
  return nextPromise;
}

export function clearWorkspaceIndexCache(cwd: string): void {
  workspaceIndexCache.delete(cwd);
  inFlightWorkspaceIndexBuilds.delete(cwd);
}

export async function searchWorkspaceEntries(
  input: ProjectSearchEntriesInput,
): Promise<ProjectSearchEntriesResult> {
  const index = await getWorkspaceIndex(input.cwd);
  const normalizedQuery = normalizeQuery(input.query);
  const limit = Math.max(0, Math.floor(input.limit));
  const rankedEntries: RankedWorkspaceEntry[] = [];
  let matchedEntryCount = 0;

  for (const entry of index.entries) {
    const score = scoreEntry(entry, normalizedQuery);
    if (score === null) {
      continue;
    }

    matchedEntryCount += 1;
    insertRankedEntry(rankedEntries, { entry, score }, limit);
  }

  return {
    entries: rankedEntries.map((candidate) => candidate.entry),
    truncated: index.truncated || matchedEntryCount > limit,
  };
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function looksBinary(buffer: Buffer): boolean {
  for (const value of buffer) {
    if (value === 0) {
      return true;
    }
  }
  return false;
}

function packageManagerExecCommand(packageManager: "bun" | "pnpm" | "yarn" | "npm"): string {
  switch (packageManager) {
    case "bun":
      return "bun x";
    case "pnpm":
      return "pnpm exec";
    case "yarn":
      return "yarn exec";
    case "npm":
      return "npm exec --";
  }
}

async function detectNodePackageManager(cwd: string): Promise<"bun" | "pnpm" | "yarn" | "npm"> {
  if (
    (await pathExists(path.join(cwd, "bun.lock"))) ||
    (await pathExists(path.join(cwd, "bun.lockb")))
  ) {
    return "bun";
  }
  if (await pathExists(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await pathExists(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

async function readJsonFile<T>(absolutePath: string): Promise<T | null> {
  try {
    const fileContents = await fs.readFile(absolutePath, "utf8");
    return JSON.parse(fileContents) as T;
  } catch {
    return null;
  }
}

async function readTextFile(absolutePath: string): Promise<string | null> {
  try {
    return await fs.readFile(absolutePath, "utf8");
  } catch {
    return null;
  }
}

async function detectNodeRunner(cwd: string): Promise<"playwright" | "vitest" | "jest" | null> {
  const packageJson = await readJsonFile<{
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path.join(cwd, "package.json"));
  const dependencyNames = new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {}),
  ]);
  const scriptContents = Object.values(packageJson?.scripts ?? {})
    .join("\n")
    .toLowerCase();

  const hasPlaywrightConfig = await Promise.any(
    [
      "playwright.config.ts",
      "playwright.config.js",
      "playwright.config.mjs",
      "playwright.config.cjs",
    ].map(async (configFile) => {
      if (await pathExists(path.join(cwd, configFile))) {
        return true;
      }
      throw new Error("missing");
    }),
  ).catch(() => false);
  if (
    hasPlaywrightConfig ||
    dependencyNames.has("@playwright/test") ||
    scriptContents.includes("playwright")
  ) {
    return "playwright";
  }

  const hasVitestConfig = await Promise.any(
    ["vitest.config.ts", "vitest.config.js", "vitest.config.mjs", "vitest.workspace.ts"].map(
      async (configFile) => {
        if (await pathExists(path.join(cwd, configFile))) {
          return true;
        }
        throw new Error("missing");
      },
    ),
  ).catch(() => false);
  if (hasVitestConfig || dependencyNames.has("vitest") || scriptContents.includes("vitest")) {
    return "vitest";
  }

  const hasJestConfig = await Promise.any(
    [
      "jest.config.ts",
      "jest.config.js",
      "jest.config.mjs",
      "jest.config.cjs",
      "jest.config.json",
    ].map(async (configFile) => {
      if (await pathExists(path.join(cwd, configFile))) {
        return true;
      }
      throw new Error("missing");
    }),
  ).catch(() => false);
  if (
    hasJestConfig ||
    dependencyNames.has("jest") ||
    dependencyNames.has("@jest/globals") ||
    scriptContents.includes("jest")
  ) {
    return "jest";
  }

  return null;
}

async function detectPythonRunner(cwd: string): Promise<"pytest" | "unittest" | null> {
  const pyproject = await readTextFile(path.join(cwd, "pyproject.toml"));
  const pytestIni = await readTextFile(path.join(cwd, "pytest.ini"));
  const toxIni = await readTextFile(path.join(cwd, "tox.ini"));
  const setupCfg = await readTextFile(path.join(cwd, "setup.cfg"));
  const combinedConfig = [pyproject, pytestIni, toxIni, setupCfg]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (combinedConfig.includes("pytest")) {
    return "pytest";
  }

  if ((await pathExists(path.join(cwd, "tests"))) || (await pathExists(path.join(cwd, "test")))) {
    return "unittest";
  }

  return null;
}

function isNodeLikePath(relativePath: string): boolean {
  return /\.(?:c|m)?(?:j|t)sx?$/i.test(relativePath);
}

function isPythonPath(relativePath: string): boolean {
  return /\.py$/i.test(relativePath);
}

function isNodeTestPath(relativePath: string): boolean {
  return /(^|\/)__tests__\/|(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/i.test(relativePath);
}

function isPythonTestPath(relativePath: string): boolean {
  return /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/i.test(relativePath);
}

function uniqueCandidatePaths(paths: string[]): string[] {
  return [
    ...new Set(
      paths.map((candidate) => candidate.trim()).filter((candidate) => candidate.length > 0),
    ),
  ];
}

async function firstExistingRelativePath(
  cwd: string,
  candidates: string[],
): Promise<string | null> {
  for (const candidate of uniqueCandidatePaths(candidates)) {
    if (await pathExists(path.join(cwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

async function resolveNodeRelatedTestPath(
  cwd: string,
  relativePath: string,
): Promise<string | null> {
  if (isNodeTestPath(relativePath)) {
    return relativePath;
  }
  const ext = path.posix.extname(relativePath);
  if (!ext) {
    return null;
  }
  const basePath = relativePath.slice(0, -ext.length);
  const dirname = path.posix.dirname(relativePath);
  const basename = path.posix.basename(basePath);
  const relativeDir = dirname === "." ? "" : dirname;
  return firstExistingRelativePath(cwd, [
    `${basePath}.test${ext}`,
    `${basePath}.spec${ext}`,
    relativeDir
      ? `${relativeDir}/__tests__/${basename}.test${ext}`
      : `__tests__/${basename}.test${ext}`,
    relativeDir
      ? `${relativeDir}/__tests__/${basename}.spec${ext}`
      : `__tests__/${basename}.spec${ext}`,
    `tests/${basePath}.test${ext}`,
    `tests/${basePath}.spec${ext}`,
    `tests/${basename}.test${ext}`,
    `tests/${basename}.spec${ext}`,
  ]);
}

async function resolvePythonRelatedTestPath(
  cwd: string,
  relativePath: string,
): Promise<string | null> {
  if (isPythonTestPath(relativePath)) {
    return relativePath;
  }
  const dirname = path.posix.dirname(relativePath);
  const basename = path.posix.basename(relativePath, ".py");
  const relativeDir = dirname === "." ? "" : dirname;
  return firstExistingRelativePath(cwd, [
    relativeDir ? `${relativeDir}/test_${basename}.py` : `test_${basename}.py`,
    relativeDir ? `${relativeDir}/${basename}_test.py` : `${basename}_test.py`,
    relativeDir ? `tests/${relativeDir}/test_${basename}.py` : `tests/test_${basename}.py`,
    relativeDir ? `tests/${relativeDir}/${basename}_test.py` : `tests/${basename}_test.py`,
    `tests/test_${basename}.py`,
    `tests/${basename}_test.py`,
  ]);
}

function buildPythonModuleName(relativePath: string): string | null {
  const withoutExtension = relativePath.replace(/\.py$/i, "");
  const segments = withoutExtension.split("/");
  if (segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
    return null;
  }
  return segments.join(".");
}

async function resolveWorkspaceFileTestTargetInternal(input: {
  cwd: string;
  relativePath: string;
}): Promise<ProjectResolveFileTestTargetResult> {
  if (isNodeLikePath(input.relativePath)) {
    const relatedTestPath = await resolveNodeRelatedTestPath(input.cwd, input.relativePath);
    const runner = await detectNodeRunner(input.cwd);
    if (runner && relatedTestPath) {
      const packageManager = await detectNodePackageManager(input.cwd);
      const runnerCommand = packageManagerExecCommand(packageManager);
      const quotedTestPath = quoteShellArg(relatedTestPath);
      const command =
        runner === "vitest"
          ? `${runnerCommand} vitest run -- ${quotedTestPath}`
          : runner === "jest"
            ? `${runnerCommand} jest --runTestsByPath ${quotedTestPath}`
            : `${runnerCommand} playwright test ${quotedTestPath}`;
      return {
        kind: "command",
        cwd: input.cwd,
        command,
        env: {
          T3CODE_FILE_PATH: path.join(input.cwd, input.relativePath),
          T3CODE_RELATIVE_PATH: input.relativePath,
          T3CODE_TEST_FILE_PATH: path.join(input.cwd, relatedTestPath),
          T3CODE_TEST_RELATIVE_PATH: relatedTestPath,
        },
        relatedTestPath,
      };
    }
    if (relatedTestPath) {
      return {
        kind: "open-file",
        relativePath: relatedTestPath,
      };
    }
    return { kind: "unsupported" };
  }

  if (isPythonPath(input.relativePath)) {
    const relatedTestPath = await resolvePythonRelatedTestPath(input.cwd, input.relativePath);
    const runner = await detectPythonRunner(input.cwd);
    if (runner && relatedTestPath) {
      const command =
        runner === "pytest"
          ? `python -m pytest ${quoteShellArg(relatedTestPath)}`
          : (() => {
              const moduleName = buildPythonModuleName(relatedTestPath);
              return moduleName ? `python -m unittest ${moduleName}` : null;
            })();
      if (command) {
        return {
          kind: "command",
          cwd: input.cwd,
          command,
          env: {
            T3CODE_FILE_PATH: path.join(input.cwd, input.relativePath),
            T3CODE_RELATIVE_PATH: input.relativePath,
            T3CODE_TEST_FILE_PATH: path.join(input.cwd, relatedTestPath),
            T3CODE_TEST_RELATIVE_PATH: relatedTestPath,
          },
          relatedTestPath,
        };
      }
    }
    if (relatedTestPath) {
      return {
        kind: "open-file",
        relativePath: relatedTestPath,
      };
    }
  }

  return { kind: "unsupported" };
}

export async function listWorkspaceDirectory(
  input: ProjectListDirectoryInput,
): Promise<ProjectListDirectoryResult> {
  const resolved = resolveWorkspacePath(input.cwd, input.directoryPath);
  if (!resolved) {
    throw new Error("Workspace directory path must stay within the project root.");
  }

  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isDirectory()) {
    throw new Error("Workspace directory listing target must be a directory.");
  }

  const dirents = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
  const candidateEntries = dirents
    .filter((dirent) => dirent.isDirectory() || dirent.isFile())
    .filter((dirent) => !(dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)))
    .map((dirent) => {
      const relativePath = toPosixPath(
        resolved.relativePath ? path.join(resolved.relativePath, dirent.name) : dirent.name,
      );
      return {
        dirent,
        entry: {
          path: relativePath,
          kind: dirent.isDirectory() ? ("directory" as const) : ("file" as const),
          ...(resolved.relativePath ? { parentPath: resolved.relativePath } : {}),
        } satisfies ProjectEntry,
      };
    })
    .filter((candidate) => !isPathInIgnoredDirectory(candidate.entry.path));

  const allowedPathSet = (await isInsideGitWorkTree(input.cwd))
    ? new Set(
        await filterGitIgnoredPaths(
          input.cwd,
          candidateEntries.map((candidate) => candidate.entry.path),
        ),
      )
    : null;
  const entries = candidateEntries
    .filter((candidate) => (allowedPathSet ? allowedPathSet.has(candidate.entry.path) : true))
    .map((candidate) => candidate.entry)
    .toSorted((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  return {
    directoryPath: resolved.relativePath,
    entries,
  };
}

export async function readWorkspaceFile(
  input: ProjectReadFileInput,
): Promise<ProjectReadFileResult> {
  const resolved = resolveWorkspacePath(input.cwd, input.relativePath);
  if (!resolved || resolved.relativePath.length === 0) {
    throw new Error("Workspace file path must stay within the project root.");
  }

  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) {
    throw new Error("Workspace file preview target must be a file.");
  }

  const previewBytes = Math.min(stat.size, PROJECT_READ_FILE_PREVIEW_MAX_BYTES);
  const handle = await fs.open(resolved.absolutePath, "r");
  try {
    const buffer = Buffer.alloc(previewBytes);
    const { bytesRead } = await handle.read(buffer, 0, previewBytes, 0);
    const previewBuffer = buffer.subarray(0, bytesRead);
    if (looksBinary(previewBuffer)) {
      return {
        relativePath: resolved.relativePath,
        contents: null,
        isBinary: true,
        truncated: stat.size > PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
        sizeBytes: stat.size,
        previewMaxBytes: PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
      };
    }

    try {
      return {
        relativePath: resolved.relativePath,
        contents: textDecoder.decode(previewBuffer),
        isBinary: false,
        truncated: stat.size > PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
        sizeBytes: stat.size,
        previewMaxBytes: PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
      };
    } catch {
      return {
        relativePath: resolved.relativePath,
        contents: null,
        isBinary: true,
        truncated: stat.size > PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
        sizeBytes: stat.size,
        previewMaxBytes: PROJECT_READ_FILE_PREVIEW_MAX_BYTES,
      };
    }
  } finally {
    await handle.close();
  }
}

export async function resolveWorkspaceFileTestTarget(
  input: ProjectResolveFileTestTargetInput,
): Promise<ProjectResolveFileTestTargetResult> {
  const resolved = resolveWorkspacePath(input.cwd, input.relativePath);
  if (!resolved || resolved.relativePath.length === 0) {
    throw new Error("Workspace file path must stay within the project root.");
  }
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) {
    throw new Error("Workspace file test target must be a file.");
  }
  return resolveWorkspaceFileTestTargetInternal({
    cwd: input.cwd,
    relativePath: resolved.relativePath,
  });
}
