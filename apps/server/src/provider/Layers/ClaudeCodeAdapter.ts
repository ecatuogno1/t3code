/**
 * ClaudeCodeAdapterLive - Implementation for the Claude Code provider adapter.
 *
 * Wraps the `claude` CLI behind the `ClaudeCodeAdapter` service contract and
 * maps failures into the shared `ProviderAdapterError` algebra.
 *
 * @module ClaudeCodeAdapterLive
 */
import {
  type ProviderRuntimeEvent,
  EventId,
  ProviderItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { ClaudeCodeAdapter, type ClaudeCodeAdapterShape } from "../Services/ClaudeCodeAdapter.ts";

const PROVIDER = "claudeCode" as const;

interface ClaudeSession {
  readonly threadId: string;
  status: "connecting" | "ready" | "running" | "error" | "closed";
  cwd: string | undefined;
  model: string | undefined;
  createdAt: string;
  updatedAt: string;
}

function newEventId(): typeof EventId.Type {
  return EventId.makeUnsafe(crypto.randomUUID());
}

function newTurnId(): typeof TurnId.Type {
  return TurnId.makeUnsafe(crypto.randomUUID());
}

function newItemId(): typeof ProviderItemId.Type {
  return ProviderItemId.makeUnsafe(crypto.randomUUID());
}

function emitEvent(queue: Queue.Queue<ProviderRuntimeEvent>, event: Record<string, unknown>): void {
  // Use Effect.runSync to offer into the queue from async context
  Effect.runSync(Queue.offer(queue, event as unknown as ProviderRuntimeEvent));
}

const makeClaudeCodeAdapter = () =>
  Effect.gen(function* () {
    const sessions = new Map<string, ClaudeSession>();
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

    const startSession: ClaudeCodeAdapterShape["startSession"] = (input) => {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
          }),
        );
      }

      const now = new Date().toISOString();
      const session: ClaudeSession = {
        threadId: input.threadId,
        status: "ready",
        cwd: input.cwd,
        model: input.model,
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(input.threadId, session);

      return Effect.succeed({
        provider: PROVIDER,
        status: "ready" as const,
        runtimeMode: input.runtimeMode,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        threadId: input.threadId,
        createdAt: now,
        updatedAt: now,
      });
    };

    const sendTurn: ClaudeCodeAdapterShape["sendTurn"] = (input) => {
      const session = sessions.get(input.threadId);
      if (!session) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId: input.threadId,
          }),
        );
      }

      const turnId = newTurnId();
      session.status = "running";
      session.updatedAt = new Date().toISOString();
      if (input.model) {
        session.model = input.model;
      }

      const threadId = input.threadId;
      const model = session.model ?? "claude-sonnet-4-6";
      const prompt = input.input ?? "";
      const cwd = session.cwd;

      // Emit turn started
      emitEvent(runtimeEventQueue, {
        eventId: newEventId(),
        provider: PROVIDER,
        threadId,
        createdAt: new Date().toISOString(),
        turnId,
        type: "turn.started",
        payload: { model },
      });

      // Run claude CLI asynchronously — don't block sendTurn
      const runClaude = async () => {
        try {
          const args = ["--output-format", "text", "--model", model, "-p", prompt];
          if (cwd) {
            args.push("--cwd", cwd);
          }

          const proc = Bun.spawn(["claude", ...args], {
            ...(cwd ? { cwd } : {}),
            stdout: "pipe",
            stderr: "pipe",
          });

          const stdout = await new Response(proc.stdout).text();
          const exitCode = await proc.exited;

          if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            throw new Error(`Claude CLI exited with code ${exitCode}: ${stderr || stdout}`);
          }

          emitEvent(runtimeEventQueue, {
            eventId: newEventId(),
            provider: PROVIDER,
            threadId,
            createdAt: new Date().toISOString(),
            turnId,
            itemId: newItemId(),
            type: "content.delta",
            payload: {
              streamKind: "assistant_text",
              delta: stdout,
            },
          });

          emitEvent(runtimeEventQueue, {
            eventId: newEventId(),
            provider: PROVIDER,
            threadId,
            createdAt: new Date().toISOString(),
            turnId,
            type: "turn.completed",
            payload: { state: "completed" },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Claude CLI failed";
          emitEvent(runtimeEventQueue, {
            eventId: newEventId(),
            provider: PROVIDER,
            threadId,
            createdAt: new Date().toISOString(),
            turnId,
            type: "turn.completed",
            payload: { state: "failed", errorMessage: message },
          });
        } finally {
          const s = sessions.get(threadId);
          if (s) {
            s.status = "ready";
            s.updatedAt = new Date().toISOString();
          }
        }
      };

      // Fire and forget — the caller gets turnId immediately
      void runClaude();

      return Effect.succeed({
        threadId: input.threadId,
        turnId,
      });
    };

    const interruptTurn: ClaudeCodeAdapterShape["interruptTurn"] = (threadId) => {
      const session = sessions.get(threadId);
      if (!session) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      session.status = "ready";
      session.updatedAt = new Date().toISOString();
      return Effect.void;
    };

    const respondToRequest: ClaudeCodeAdapterShape["respondToRequest"] = (threadId) => {
      if (!sessions.has(threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      return Effect.void;
    };

    const respondToUserInput: ClaudeCodeAdapterShape["respondToUserInput"] = (threadId) => {
      if (!sessions.has(threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      return Effect.void;
    };

    const readThread: ClaudeCodeAdapterShape["readThread"] = (threadId) => {
      if (!sessions.has(threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      return Effect.succeed({ threadId, turns: [] });
    };

    const rollbackThread: ClaudeCodeAdapterShape["rollbackThread"] = (threadId) => {
      if (!sessions.has(threadId)) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      return Effect.succeed({ threadId, turns: [] });
    };

    const stopSession: ClaudeCodeAdapterShape["stopSession"] = (threadId) =>
      Effect.sync(() => {
        sessions.delete(threadId);
      });

    const listSessions: ClaudeCodeAdapterShape["listSessions"] = () =>
      Effect.sync(() =>
        [...sessions.values()].map((session) => {
          const entry: Record<string, unknown> = {
            provider: PROVIDER,
            status: session.status,
            runtimeMode: "full-access",
            threadId: ThreadId.makeUnsafe(session.threadId),
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          };
          if (session.cwd !== undefined) entry.cwd = session.cwd;
          if (session.model !== undefined) entry.model = session.model;
          return entry as {
            provider: "claudeCode";
            status: "connecting" | "ready" | "running" | "error" | "closed";
            runtimeMode: "full-access";
            threadId: ThreadId;
            createdAt: string;
            updatedAt: string;
            cwd?: string;
            model?: string;
          };
        }),
      );

    const hasSession: ClaudeCodeAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => sessions.has(threadId));

    const stopAll: ClaudeCodeAdapterShape["stopAll"] = () =>
      Effect.sync(() => {
        sessions.clear();
      });

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "in-session" as const,
      },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEventQueue),
    } satisfies ClaudeCodeAdapterShape;
  });

export const ClaudeCodeAdapterLive = Layer.effect(ClaudeCodeAdapter, makeClaudeCodeAdapter());

export function makeClaudeCodeAdapterLive() {
  return Layer.effect(ClaudeCodeAdapter, makeClaudeCodeAdapter());
}
