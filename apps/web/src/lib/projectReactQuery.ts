import type {
  ProjectListDirectoryResult,
  ProjectReadFileResult,
  ProjectResolveFileTestTargetResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const projectQueryKeys = {
  all: ["projects"] as const,
  listDirectory: (cwd: string | null, directoryPath: string) =>
    ["projects", "list-directory", cwd, directoryPath] as const,
  readFile: (cwd: string | null, relativePath: string | null) =>
    ["projects", "read-file", cwd, relativePath] as const,
  resolveFileTestTarget: (cwd: string | null, relativePath: string | null) =>
    ["projects", "resolve-file-test-target", cwd, relativePath] as const,
  searchEntries: (cwd: string | null, query: string, limit: number) =>
    ["projects", "search-entries", cwd, query, limit] as const,
};

const DEFAULT_SEARCH_ENTRIES_LIMIT = 80;
const DEFAULT_SEARCH_ENTRIES_STALE_TIME = 15_000;
const DEFAULT_DIRECTORY_STALE_TIME = 30_000;
const DEFAULT_READ_FILE_STALE_TIME = 15_000;
const EMPTY_SEARCH_ENTRIES_RESULT: ProjectSearchEntriesResult = {
  entries: [],
  truncated: false,
};
const EMPTY_DIRECTORY_RESULT: ProjectListDirectoryResult = {
  directoryPath: "",
  entries: [],
};
const EMPTY_FILE_TEST_TARGET_RESULT: ProjectResolveFileTestTargetResult = {
  kind: "unsupported",
};
const EMPTY_READ_FILE_RESULT: ProjectReadFileResult = {
  relativePath: "",
  contents: null,
  isBinary: false,
  truncated: false,
  sizeBytes: 0,
  previewMaxBytes: 256 * 1024,
};

export function projectListDirectoryQueryOptions(input: {
  cwd: string | null;
  directoryPath: string;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.listDirectory(input.cwd, input.directoryPath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace directory listing is unavailable.");
      }
      return api.projects.listDirectory({
        cwd: input.cwd,
        directoryPath: input.directoryPath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null,
    staleTime: input.staleTime ?? DEFAULT_DIRECTORY_STALE_TIME,
    placeholderData: (previous) =>
      previous ?? { ...EMPTY_DIRECTORY_RESULT, directoryPath: input.directoryPath },
  });
}

export function projectReadFileQueryOptions(input: {
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.readFile(input.cwd, input.relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.relativePath) {
        throw new Error("Workspace file preview is unavailable.");
      }
      return api.projects.readFile({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    placeholderData: (previous) =>
      previous ?? {
        ...EMPTY_READ_FILE_RESULT,
        relativePath: input.relativePath ?? "",
      },
  });
}

export function projectResolveFileTestTargetQueryOptions(input: {
  cwd: string | null;
  relativePath: string | null;
  enabled?: boolean;
  staleTime?: number;
}) {
  return queryOptions({
    queryKey: projectQueryKeys.resolveFileTestTarget(input.cwd, input.relativePath),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd || !input.relativePath) {
        throw new Error("Workspace file test target resolution is unavailable.");
      }
      return api.projects.resolveFileTestTarget({
        cwd: input.cwd,
        relativePath: input.relativePath,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.relativePath !== null,
    staleTime: input.staleTime ?? DEFAULT_READ_FILE_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_FILE_TEST_TARGET_RESULT,
  });
}

export function projectSearchEntriesQueryOptions(input: {
  cwd: string | null;
  query: string;
  enabled?: boolean;
  limit?: number;
  staleTime?: number;
}) {
  const limit = input.limit ?? DEFAULT_SEARCH_ENTRIES_LIMIT;
  return queryOptions({
    queryKey: projectQueryKeys.searchEntries(input.cwd, input.query, limit),
    queryFn: async () => {
      const api = ensureNativeApi();
      if (!input.cwd) {
        throw new Error("Workspace entry search is unavailable.");
      }
      return api.projects.searchEntries({
        cwd: input.cwd,
        query: input.query,
        limit,
      });
    },
    enabled: (input.enabled ?? true) && input.cwd !== null && input.query.length > 0,
    staleTime: input.staleTime ?? DEFAULT_SEARCH_ENTRIES_STALE_TIME,
    placeholderData: (previous) => previous ?? EMPTY_SEARCH_ENTRIES_RESULT,
  });
}
