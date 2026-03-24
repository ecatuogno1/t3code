import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  ProjectId,
  ThreadId,
  type ThreadImportContinuationMode,
  type ThreadImportProvider,
  type ThreadImportResult,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ThreadImportSourceRepository } from "../../persistence/Services/ThreadImportSources.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import { WorkspaceCommandService } from "../../workspace/Services/WorkspaceCommandService.ts";
import {
  parseClaudeThreadImportSession,
  parseCodexThreadImportSession,
  peekClaudeTranscriptCwd,
  peekCodexSessionCwd,
  readClaudeDesktopSessionMetadata,
  readCodexSessionIndexTitles,
  toThreadImportCandidate,
  type ClaudeDesktopSessionMetadata,
  type ParsedThreadImportSession,
} from "../threadImportParsers.ts";
import {
  ThreadImportService,
  type ThreadImportServiceShape,
} from "../Services/ThreadImportService.ts";

interface ThreadImportServiceLiveOptions {
  readonly homeDir?: string;
}

type LiveThreadReference = {
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceId: ThreadImportResult["workspaceId"];
};

function normalizeScopePath(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return path.resolve(trimmed).replace(/\/+$/, "");
}

function matchesScopePath(input: {
  readonly scopePath: string | null;
  readonly candidateCwd: string;
}): boolean {
  if (input.scopePath === null) {
    return true;
  }
  return normalizeScopePath(input.candidateCwd) === input.scopePath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listJsonlFiles(rootDir: string): Promise<ReadonlyArray<string>> {
  return listFilesWithExtension(rootDir, ".jsonl");
}

async function listJsonFiles(rootDir: string): Promise<ReadonlyArray<string>> {
  return listFilesWithExtension(rootDir, ".json");
}

async function listFilesWithExtension(
  rootDir: string,
  extension: ".json" | ".jsonl",
): Promise<ReadonlyArray<string>> {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesWithExtension(absolutePath, extension)));
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith(extension)) {
      files.push(absolutePath);
    }
  }

  return files.toSorted((left, right) => left.localeCompare(right));
}

function pathIncludesSegment(targetPath: string, segment: string): boolean {
  return targetPath.split(path.sep).includes(segment);
}

function providerLabel(provider: ThreadImportProvider): string {
  return provider === "codex" ? "Codex" : "Claude Code";
}

function deriveProjectTitle(cwd: string): string {
  const trimmed = cwd.trim().replace(/\/+$/, "");
  const segment = trimmed.split(/[/\\]/).findLast(Boolean) ?? trimmed;
  return segment.trim() || cwd.trim();
}

function makeCommandId(label: string): CommandId {
  return CommandId.makeUnsafe(`cmd:${label}:${crypto.randomUUID()}`);
}

function resolveImportedContinuationMode(
  session: ParsedThreadImportSession,
): ThreadImportContinuationMode {
  return session.provider === "codex" && session.providerThreadId !== null
    ? "codex-resume"
    : "fresh-session";
}

function resolveImportedThreadModel(session: ParsedThreadImportSession): string {
  const trimmed = session.model.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return DEFAULT_MODEL_BY_PROVIDER[session.provider];
}

function buildImportActivity(input: {
  readonly session: ParsedThreadImportSession;
  readonly continuationMode: ThreadImportContinuationMode;
}) {
  return {
    id: EventId.makeUnsafe(`evt:thread-import:${crypto.randomUUID()}`),
    tone: "info" as const,
    kind: "thread.imported",
    summary: input.session.skippedNonText
      ? `Imported from ${providerLabel(input.session.provider)} with non-text content omitted`
      : `Imported from ${providerLabel(input.session.provider)}`,
    payload: {
      provider: input.session.provider,
      externalSessionId: input.session.externalSessionId,
      sourcePath: input.session.sourcePath,
      continuationMode: input.continuationMode,
      omittedNonTextContent: input.session.skippedNonText,
    },
    turnId: null,
    createdAt: input.session.updatedAt,
  };
}

function choosePreferredCandidate(
  current: ParsedThreadImportSession,
  next: ParsedThreadImportSession,
): ParsedThreadImportSession {
  const currentIsLive = current.sourcePath.includes(
    `${path.sep}.codex${path.sep}sessions${path.sep}`,
  );
  const nextIsLive = next.sourcePath.includes(`${path.sep}.codex${path.sep}sessions${path.sep}`);
  if (current.provider === "codex" && currentIsLive !== nextIsLive) {
    return nextIsLive ? next : current;
  }
  if (next.updatedAt !== current.updatedAt) {
    return next.updatedAt > current.updatedAt ? next : current;
  }
  if (next.messageCount !== current.messageCount) {
    return next.messageCount > current.messageCount ? next : current;
  }
  return next.sourcePath < current.sourcePath ? next : current;
}

function resolveExistingLiveImport(input: {
  readonly provider: ThreadImportProvider;
  readonly externalSessionId: string;
  readonly sourcePath: string;
  readonly sourceAliases?: ReadonlyArray<{
    readonly externalSessionId: string;
    readonly sourcePath: string;
  }>;
  readonly liveThreadsById: ReadonlyMap<string, LiveThreadReference>;
  readonly mappings: ReadonlyArray<{
    readonly providerName: ThreadImportProvider;
    readonly externalSessionId: string;
    readonly sourcePath: string;
    readonly threadId: ThreadId;
  }>;
}): LiveThreadReference | null {
  const candidates = [
    {
      externalSessionId: input.externalSessionId,
      sourcePath: input.sourcePath,
    },
    ...(input.sourceAliases ?? []),
  ];

  for (const candidate of candidates) {
    const exact = input.mappings.find(
      (mapping) =>
        mapping.providerName === input.provider &&
        mapping.externalSessionId === candidate.externalSessionId &&
        mapping.sourcePath === candidate.sourcePath,
    );
    if (exact) {
      const liveThread = input.liveThreadsById.get(exact.threadId);
      if (liveThread) {
        return liveThread;
      }
    }
  }

  for (const mapping of input.mappings) {
    const matchesAnySessionId =
      mapping.providerName === input.provider &&
      candidates.some((candidate) => candidate.externalSessionId === mapping.externalSessionId);
    if (!matchesAnySessionId) {
      continue;
    }
    const liveThread = input.liveThreadsById.get(mapping.threadId);
    if (liveThread) {
      return liveThread;
    }
  }

  return null;
}

interface ClaudeImportSourceDescriptor {
  readonly provider: "claudeAgent";
  readonly sourcePath: string;
  readonly transcriptPath: string | null;
  readonly metadata: ClaudeDesktopSessionMetadata | null;
}

interface CodexImportSourceDescriptor {
  readonly provider: "codex";
  readonly sourcePath: string;
}

type ImportSourceDescriptor = ClaudeImportSourceDescriptor | CodexImportSourceDescriptor;

async function buildClaudeTranscriptIndex(homeDir: string): Promise<ReadonlyMap<string, string>> {
  const transcriptFiles = await listJsonlFiles(path.join(homeDir, ".claude", "projects"));
  const index = new Map<string, string>();

  for (const transcriptPath of transcriptFiles) {
    if (pathIncludesSegment(transcriptPath, "subagents")) {
      continue;
    }
    const cliSessionId = path.basename(transcriptPath, ".jsonl").trim();
    if (cliSessionId.length === 0) {
      continue;
    }
    index.set(cliSessionId, transcriptPath);
  }

  return index;
}

async function buildClaudeImportSources(
  homeDir: string,
  scopePath: string | null,
): Promise<ReadonlyArray<ImportSourceDescriptor>> {
  const transcriptIndex = await buildClaudeTranscriptIndex(homeDir);
  const desktopMetadataPaths = await listJsonFiles(
    path.join(homeDir, "Library", "Application Support", "Claude", "claude-code-sessions"),
  );
  const desktopSources: ImportSourceDescriptor[] = [];
  const indexedCliSessionIds = new Set<string>();

  for (const sourcePath of desktopMetadataPaths) {
    try {
      const metadata = await readClaudeDesktopSessionMetadata({ sourcePath });
      if (!metadata) {
        continue;
      }
      if (!matchesScopePath({ scopePath, candidateCwd: metadata.cwd })) {
        continue;
      }
      indexedCliSessionIds.add(metadata.cliSessionId);
      desktopSources.push({
        provider: "claudeAgent",
        sourcePath,
        transcriptPath: transcriptIndex.get(metadata.cliSessionId) ?? null,
        metadata,
      });
    } catch {
      // Ignore malformed or unreadable session entries and keep scanning.
    }
  }

  const rawTranscriptSources: ImportSourceDescriptor[] = [];
  for (const [cliSessionId, sourcePath] of transcriptIndex.entries()) {
    if (indexedCliSessionIds.has(cliSessionId)) {
      continue;
    }
    if (scopePath !== null) {
      const transcriptCwd = await peekClaudeTranscriptCwd({ sourcePath }).catch(() => null);
      if (!transcriptCwd || !matchesScopePath({ scopePath, candidateCwd: transcriptCwd })) {
        continue;
      }
    }
    rawTranscriptSources.push({
      provider: "claudeAgent",
      sourcePath,
      transcriptPath: sourcePath,
      metadata: null,
    });
  }

  return [...desktopSources, ...rawTranscriptSources];
}

async function buildCodexImportSources(input: {
  readonly homeDir: string;
  readonly scopePath: string | null;
}): Promise<ReadonlyArray<ImportSourceDescriptor>> {
  const sourcePaths = [
    ...(await listJsonlFiles(path.join(input.homeDir, ".codex", "sessions"))),
    ...(await listJsonlFiles(path.join(input.homeDir, ".codex", "archived_sessions"))),
  ];

  if (input.scopePath === null) {
    return sourcePaths.map((sourcePath) => ({
      provider: "codex" as const,
      sourcePath,
    }));
  }

  const filteredSources: ImportSourceDescriptor[] = [];
  for (const sourcePath of sourcePaths) {
    const cwd = await peekCodexSessionCwd({ sourcePath }).catch(() => null);
    if (!cwd || !matchesScopePath({ scopePath: input.scopePath, candidateCwd: cwd })) {
      continue;
    }
    filteredSources.push({
      provider: "codex",
      sourcePath,
    });
  }

  return filteredSources;
}

async function resolveImportSource(input: {
  readonly provider: ThreadImportProvider;
  readonly sourcePath: string;
  readonly homeDir: string;
}): Promise<ImportSourceDescriptor> {
  if (input.provider === "codex") {
    return {
      provider: "codex",
      sourcePath: input.sourcePath,
    };
  }

  if (input.sourcePath.endsWith(".json")) {
    const metadata = await readClaudeDesktopSessionMetadata({ sourcePath: input.sourcePath });
    const transcriptIndex = await buildClaudeTranscriptIndex(input.homeDir);
    return {
      provider: "claudeAgent",
      sourcePath: input.sourcePath,
      transcriptPath: metadata ? (transcriptIndex.get(metadata.cliSessionId) ?? null) : null,
      metadata,
    };
  }

  return {
    provider: "claudeAgent",
    sourcePath: input.sourcePath,
    transcriptPath: input.sourcePath,
    metadata: null,
  };
}

async function parseImportSource(input: {
  readonly source: ImportSourceDescriptor;
  readonly codexTitles: ReadonlyMap<string, string>;
}): Promise<ParsedThreadImportSession | null> {
  if (input.source.provider === "codex") {
    const indexedTitle =
      input.codexTitles.get(
        path.basename(input.source.sourcePath).replace(/^.*-([0-9a-f-]+)\.jsonl$/i, "$1"),
      ) ?? null;
    const parsed = await parseCodexThreadImportSession({
      sourcePath: input.source.sourcePath,
      indexedTitle,
    });
    if (parsed?.externalSessionId) {
      const titled = input.codexTitles.get(parsed.externalSessionId);
      if (titled && titled !== parsed.title) {
        return { ...parsed, title: titled };
      }
    }
    return parsed;
  }

  return parseClaudeThreadImportSession({
    sourcePath: input.source.sourcePath,
    transcriptPath: input.source.transcriptPath,
    metadata: input.source.metadata,
  });
}

export const makeThreadImportServiceLive = (options?: ThreadImportServiceLiveOptions) =>
  Layer.effect(
    ThreadImportService,
    Effect.gen(function* () {
      const orchestrationEngine = yield* OrchestrationEngineService;
      const workspaceCommandService = yield* WorkspaceCommandService;
      const importSources = yield* ThreadImportSourceRepository;
      const providerSessionDirectory = yield* ProviderSessionDirectory;
      const homeDir = options?.homeDir ?? os.homedir();

      const parseAllCandidates = (workspaceRoot: string | null | undefined) =>
        Effect.promise(async () => {
          const scopePath = normalizeScopePath(workspaceRoot);
          const codexTitles = await readCodexSessionIndexTitles(homeDir);
          const sources: ImportSourceDescriptor[] = [
            ...(await buildCodexImportSources({ homeDir, scopePath })),
            ...(await buildClaudeImportSources(homeDir, scopePath)),
          ];

          const parsedSessions = await Promise.all(
            sources.map(async (source) => {
              try {
                return await parseImportSource({
                  source,
                  codexTitles,
                });
              } catch {
                return null;
              }
            }),
          );

          const deduped = new Map<string, ParsedThreadImportSession>();
          for (const parsed of parsedSessions) {
            if (!parsed) {
              continue;
            }
            const key = `${parsed.provider}:${parsed.externalSessionId}`;
            const existing = deduped.get(key);
            deduped.set(key, existing ? choosePreferredCandidate(existing, parsed) : parsed);
          }
          return [...deduped.values()].toSorted(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              left.provider.localeCompare(right.provider) ||
              left.title.localeCompare(right.title),
          );
        });

      const scan: ThreadImportServiceShape["scan"] = (input) =>
        Effect.gen(function* () {
          const [readModel, mappings, sessions] = yield* Effect.all([
            orchestrationEngine.getReadModel(),
            importSources.listAll(),
            parseAllCandidates(input.workspaceRoot),
          ]);

          const liveThreadsById = new Map<string, LiveThreadReference>(
            readModel.threads
              .filter((thread) => thread.deletedAt === null)
              .map((thread) => [
                thread.id,
                {
                  projectId: thread.projectId,
                  threadId: thread.id,
                  workspaceId: thread.workspaceId,
                },
              ]),
          );

          return sessions.map((session) =>
            toThreadImportCandidate({
              session,
              alreadyImportedThreadId:
                resolveExistingLiveImport({
                  provider: session.provider,
                  externalSessionId: session.externalSessionId,
                  sourcePath: session.sourcePath,
                  sourceAliases: session.sourceAliases,
                  liveThreadsById,
                  mappings,
                })?.threadId ?? null,
            }),
          );
        });

      const importSession: ThreadImportServiceShape["importSession"] = (input) =>
        Effect.gen(function* () {
          const [readModel, mappings, codexTitles] = yield* Effect.all([
            orchestrationEngine.getReadModel(),
            importSources.listAll(),
            Effect.promise(() => readCodexSessionIndexTitles(homeDir)),
          ]);
          const liveThreadsById = new Map<string, LiveThreadReference>(
            readModel.threads
              .filter((thread) => thread.deletedAt === null)
              .map((thread) => [
                thread.id,
                {
                  projectId: thread.projectId,
                  threadId: thread.id,
                  workspaceId: thread.workspaceId,
                },
              ]),
          );

          const source = yield* Effect.promise(() =>
            resolveImportSource({
              provider: input.provider,
              sourcePath: input.sourcePath,
              homeDir,
            }),
          );
          const session = yield* Effect.promise(() =>
            parseImportSource({
              source,
              codexTitles,
            }),
          );
          if (!session) {
            return yield* Effect.fail(
              new Error(`Unable to parse import source: ${input.sourcePath}`),
            );
          }
          const exactExisting = resolveExistingLiveImport({
            provider: session.provider,
            externalSessionId: session.externalSessionId,
            sourcePath: session.sourcePath,
            sourceAliases: session.sourceAliases,
            liveThreadsById,
            mappings,
          });
          if (exactExisting) {
            return {
              threadId: exactExisting.threadId,
              projectId: exactExisting.projectId,
              workspaceId: exactExisting.workspaceId,
              continuationMode: resolveImportedContinuationMode(session),
            } satisfies ThreadImportResult;
          }
          if (
            session.provider !== input.provider ||
            session.externalSessionId !== input.externalSessionId ||
            session.sourcePath !== input.sourcePath
          ) {
            return yield* Effect.fail(
              new Error("Import source no longer matches the selected session."),
            );
          }

          const existingProject =
            readModel.projects.find(
              (project) => project.deletedAt === null && project.workspaceRoot === session.cwd,
            ) ?? null;
          const projectId =
            existingProject?.id ?? ProjectId.makeUnsafe(`project:${crypto.randomUUID()}`);
          if (!existingProject) {
            yield* orchestrationEngine.dispatch({
              type: "project.create",
              commandId: makeCommandId("thread-import-project"),
              projectId,
              title: deriveProjectTitle(session.cwd),
              workspaceRoot: session.cwd,
              defaultModel: resolveImportedThreadModel(session),
              createdAt: session.createdAt,
            });
          }

          const workspaceResult = yield* workspaceCommandService.dispatch({
            type: "workspace.create",
            projectId,
            source: "root",
            createdAt: session.createdAt,
          });
          if (!workspaceResult.workspaceId) {
            return yield* Effect.fail(
              new Error("Failed to resolve a workspace for the imported thread."),
            );
          }
          const workspaceId = workspaceResult.workspaceId;
          const threadId = ThreadId.makeUnsafe(`thread:${crypto.randomUUID()}`);
          const continuationMode = resolveImportedContinuationMode(session);

          yield* orchestrationEngine.dispatch({
            type: "thread.import",
            commandId: makeCommandId("thread-import"),
            threadId,
            projectId,
            workspaceId,
            workspaceProjectId: null,
            title: session.title,
            model: resolveImportedThreadModel(session),
            provider: session.provider,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            pullRequestUrl: null,
            previewUrls: [],
            messages: session.messages,
            provenanceActivity: buildImportActivity({
              session,
              continuationMode,
            }),
            createdAt: session.createdAt,
          });

          yield* importSources.upsert({
            providerName: session.provider,
            externalSessionId: session.externalSessionId,
            sourcePath: session.sourcePath,
            threadId,
            createdAt: session.updatedAt,
            updatedAt: session.updatedAt,
          });
          for (const alias of session.sourceAliases) {
            yield* importSources.upsert({
              providerName: session.provider,
              externalSessionId: alias.externalSessionId,
              sourcePath: alias.sourcePath,
              threadId,
              createdAt: session.updatedAt,
              updatedAt: session.updatedAt,
            });
          }

          if (session.provider === "codex" && session.providerThreadId !== null) {
            yield* providerSessionDirectory.upsert({
              threadId,
              provider: "codex",
              runtimeMode: DEFAULT_RUNTIME_MODE,
              status: "stopped",
              resumeCursor: { threadId: session.providerThreadId },
              runtimePayload: {
                cwd: session.cwd,
                model: resolveImportedThreadModel(session),
              },
            });
          }

          return {
            threadId,
            projectId,
            workspaceId,
            continuationMode,
          } satisfies ThreadImportResult;
        });

      return {
        scan,
        importSession,
      } satisfies ThreadImportServiceShape;
    }),
  );

export const ThreadImportServiceLive = makeThreadImportServiceLive();
