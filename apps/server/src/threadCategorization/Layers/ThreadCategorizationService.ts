import { createHash, randomUUID } from "node:crypto";

import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL,
  type OrchestrationThread,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionThreadCategorizationRepository } from "../../persistence/Services/ProjectionThreadCategorizations.ts";
import {
  ThreadCategorizationError,
  ThreadCategorizationService,
  type ThreadCategorizationServiceShape,
} from "../Services/ThreadCategorizationService.ts";

const DEFAULT_MAX_THREADS = 24;
const MAX_BATCH_SIZE = 12;
const MAX_EXCERPT_CHARS = 220;
const MAX_TOTAL_CONTEXT_CHARS = 1_200;
const CODEX_REASONING_EFFORT = "low";
const CODEX_TIMEOUT_MS = 180_000;

const ThreadCategoryResultSchema = Schema.Struct({
  threadId: ThreadId,
  label: Schema.String,
});

const ThreadCategoryBatchSchema = Schema.Struct({
  results: Schema.Array(ThreadCategoryResultSchema),
});

function toThreadCategorizationError(error: unknown): ThreadCategorizationError {
  if (Schema.is(ThreadCategorizationError)(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new ThreadCategorizationError({
      detail: error.message,
      cause: error,
    });
  }
  return new ThreadCategorizationError({
    detail: "Failed to categorize project threads.",
    cause: error,
  });
}

interface ThreadCategorizationContext {
  readonly threadId: ThreadId;
  readonly fingerprint: string;
  readonly title: string;
  readonly contextText: string;
}

function toJsonSchema(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function trimExcerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_EXCERPT_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd()}...`;
}

function buildThreadContext(thread: OrchestrationThread): ThreadCategorizationContext {
  const excerpts: string[] = [];
  const seen = new Set<string>();
  for (const message of thread.messages) {
    if (message.role === "system") {
      continue;
    }
    const excerpt = trimExcerpt(message.text);
    if (!excerpt || seen.has(excerpt)) {
      continue;
    }
    seen.add(excerpt);
    excerpts.push(`${message.role}: ${excerpt}`);
    if (excerpts.join("\n").length >= MAX_TOTAL_CONTEXT_CHARS) {
      break;
    }
  }
  const contextText = excerpts.join("\n").slice(0, MAX_TOTAL_CONTEXT_CHARS).trim();
  const fingerprint = createHash("sha1")
    .update(
      JSON.stringify({
        title: thread.title,
        contextText,
      }),
    )
    .digest("hex");
  return {
    threadId: thread.id,
    fingerprint,
    title: thread.title,
    contextText,
  };
}

function normalizeLabel(raw: string, fallbackTitle: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const cleaned = trimmed
    .replace(/[.,;:!?()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const selected =
    cleaned.length > 0 && cleaned.toLowerCase() !== "misc" && cleaned.toLowerCase() !== "general"
      ? cleaned
      : fallbackTitle;
  const words = selected
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return words.join(" ").trim() || "General";
}

function latestCategorizationForModel(input: {
  thread: OrchestrationThread;
  requestedModel: string;
}): { fingerprint: string } | null {
  const categorization = input.thread.categorization;
  if (!categorization) {
    return null;
  }
  if (categorization.model !== input.requestedModel) {
    return null;
  }
  return { fingerprint: categorization.fingerprint };
}

const makeThreadCategorizationService = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const repository = yield* ProjectionThreadCategorizationRepository;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const writeTempFile = (prefix: string, content: string) => {
    const filePath = path.join(tempDir, `t3code-${prefix}-${process.pid}-${randomUUID()}.tmp`);
    return fileSystem.writeFileString(filePath, content).pipe(Effect.as(filePath));
  };

  const readStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>) =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      );
      return text;
    });

  const runCategorizationBatch = (input: {
    model: string;
    batch: ReadonlyArray<ThreadCategorizationContext>;
  }) =>
    Effect.gen(function* () {
      const schemaPath = yield* writeTempFile(
        "thread-category-schema",
        JSON.stringify(toJsonSchema(ThreadCategoryBatchSchema)),
      );
      const outputPath = yield* writeTempFile("thread-category-output", "");

      const prompt = [
        "Categorize each engineering chat thread into a short reusable topic label for a UI filter.",
        "Return one label per thread.",
        "Rules:",
        "- Use 1 to 3 words.",
        "- Prefer stable software topics such as UI Polish, Build System, Import Pipeline, Auth, Testing, Security, Docs, Planning, Infra, Payments, Search, Mobile UI.",
        "- Avoid generic labels like Misc, General, Thread, Conversation, Support.",
        "- Base the label on the title and thread context.",
        "- Reuse the same label for similar threads.",
        "",
        ...input.batch.flatMap((thread) => [
          `ThreadId: ${thread.threadId}`,
          `Title: ${thread.title}`,
          `Context: ${thread.contextText || "(no additional context)"}`,
          "",
        ]),
      ].join("\n");

      const command = ChildProcess.make(
        "codex",
        [
          "exec",
          "--ephemeral",
          "-s",
          "read-only",
          "--model",
          input.model,
          "--config",
          `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
          "--output-schema",
          schemaPath,
          "--output-last-message",
          outputPath,
          "-",
        ],
        {
          shell: process.platform === "win32",
          stdin: {
            stream: Stream.make(new TextEncoder().encode(prompt)),
          },
        },
      );

      const cleanup = Effect.all(
        [schemaPath, outputPath].map((filePath) => safeUnlink(filePath)),
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.asVoid);

      return yield* Effect.gen(function* () {
        const child = yield* commandSpawner.spawn(command);
        const [stdout, stderr, exitCode] = yield* Effect.all([
          readStreamAsString(child.stdout),
          readStreamAsString(child.stderr),
          child.exitCode.pipe(Effect.map((value) => Number(value))),
        ]);

        if (exitCode !== 0) {
          throw new Error(
            `Codex categorization failed: ${(stderr.trim() || stdout.trim() || `exit code ${exitCode}`).trim()}`,
          );
        }

        const rawOutput = yield* fileSystem.readFileString(outputPath);
        const decoded = yield* Schema.decodeEffect(
          Schema.fromJsonString(ThreadCategoryBatchSchema),
        )(rawOutput);
        return decoded.results;
      }).pipe(
        Effect.scoped,
        Effect.timeoutOption(CODEX_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new Error("Codex categorization request timed out.")),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.ensuring(cleanup),
      );
    });

  const categorizeProjectThreads: ThreadCategorizationServiceShape["categorizeProjectThreads"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotQuery.getSnapshot();
      const requestedModel = input.model ?? DEFAULT_GIT_TEXT_GENERATION_MODEL;
      const maxThreads = Math.max(1, Math.min(input.maxThreads ?? DEFAULT_MAX_THREADS, 96));
      const projectThreads = snapshot.threads
        .filter((thread) => thread.deletedAt === null && thread.projectId === input.projectId)
        .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      const candidates = projectThreads
        .map((thread) => ({
          thread,
          context: buildThreadContext(thread),
          latestCategorization: latestCategorizationForModel({
            thread,
            requestedModel,
          }),
        }))
        .filter(
          ({ context, latestCategorization }) =>
            latestCategorization?.fingerprint !== context.fingerprint,
        );
      const staleThreadCount = candidates.length;
      const requestedCandidates = candidates.slice(0, maxThreads);

      if (requestedCandidates.length === 0) {
        return {
          updatedThreadIds: [],
          processedCount: 0,
          hasMore: false,
        };
      }

      const labelByThreadId = new Map<string, string>();
      for (let index = 0; index < requestedCandidates.length; index += MAX_BATCH_SIZE) {
        const batch = requestedCandidates.slice(index, index + MAX_BATCH_SIZE);
        const results = yield* runCategorizationBatch({
          model: requestedModel,
          batch: batch.map((entry) => entry.context),
        });
        const titleByThreadId = new Map(
          batch.map((entry) => [entry.thread.id, entry.thread.title]),
        );
        for (const result of results) {
          if (!titleByThreadId.has(result.threadId)) {
            continue;
          }
          labelByThreadId.set(
            result.threadId,
            normalizeLabel(result.label, titleByThreadId.get(result.threadId) ?? "General"),
          );
        }
      }

      const now = new Date().toISOString();
      const updatedThreadIds: ThreadId[] = [];
      for (const candidate of requestedCandidates) {
        const label = labelByThreadId.get(candidate.thread.id);
        if (!label) {
          continue;
        }
        const existing = yield* repository.getByThreadId({
          threadId: candidate.thread.id,
        });
        yield* repository.upsert({
          threadId: candidate.thread.id,
          label,
          model: requestedModel,
          fingerprint: candidate.context.fingerprint,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        updatedThreadIds.push(candidate.thread.id);
      }

      return {
        updatedThreadIds,
        processedCount: requestedCandidates.length,
        hasMore: staleThreadCount > requestedCandidates.length,
      };
    }).pipe(Effect.mapError(toThreadCategorizationError));

  return {
    categorizeProjectThreads,
  } satisfies ThreadCategorizationServiceShape;
});

export const ThreadCategorizationServiceLive = Layer.effect(
  ThreadCategorizationService,
  makeThreadCategorizationService,
);
