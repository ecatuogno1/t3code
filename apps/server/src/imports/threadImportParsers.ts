import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import {
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  type OrchestrationMessageRole,
  type ThreadImportCandidate,
  type ThreadImportProvider,
} from "@t3tools/contracts";

export interface ParsedThreadImportMessage {
  readonly messageId: MessageId;
  readonly role: Extract<OrchestrationMessageRole, "user" | "assistant">;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParsedThreadImportSourceAlias {
  readonly externalSessionId: string;
  readonly sourcePath: string;
}

export interface ParsedThreadImportSession {
  readonly provider: ThreadImportProvider;
  readonly externalSessionId: string;
  readonly sourcePath: string;
  readonly cwd: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly model: string;
  readonly providerThreadId: string | null;
  readonly sourceAliases: ReadonlyArray<ParsedThreadImportSourceAlias>;
  readonly messages: ReadonlyArray<ParsedThreadImportMessage>;
  readonly skippedNonText: boolean;
}

export interface ClaudeDesktopSessionMetadata {
  readonly sourcePath: string;
  readonly sessionId: string;
  readonly cliSessionId: string;
  readonly cwd: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly model: string | null;
}

interface ParsedMessageDraft {
  readonly role: Extract<OrchestrationMessageRole, "user" | "assistant">;
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function lastPathSegment(input: string): string {
  const normalized = input.replace(/\/+$/, "");
  const segment = normalized.split(/[/\\]/).findLast(Boolean) ?? normalized;
  return segment.trim() || input.trim();
}

function deriveTitle(input: {
  readonly explicitTitle: string | null;
  readonly firstUserMessage: string | null;
  readonly cwd: string;
}): string {
  if (input.explicitTitle) {
    return input.explicitTitle;
  }
  const firstLine = input.firstUserMessage?.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length > 0) {
    return firstLine.slice(0, 120);
  }
  return lastPathSegment(input.cwd);
}

function uniqueMessageId(provider: ThreadImportProvider, externalSessionId: string): MessageId {
  return MessageId.makeUnsafe(`import:${provider}:${externalSessionId}:${crypto.randomUUID()}`);
}

function collapseAdjacentMessages(
  provider: ThreadImportProvider,
  externalSessionId: string,
  drafts: ReadonlyArray<ParsedMessageDraft>,
): ReadonlyArray<ParsedThreadImportMessage> {
  const collapsed: ParsedThreadImportMessage[] = [];

  for (const draft of drafts) {
    const text = draft.text.trim();
    if (text.length === 0) {
      continue;
    }
    const previous = collapsed.at(-1);
    if (previous && previous.role === draft.role) {
      collapsed[collapsed.length - 1] = {
        ...previous,
        text: `${previous.text}\n\n${text}`,
        updatedAt: draft.updatedAt,
      };
      continue;
    }
    collapsed.push({
      messageId: uniqueMessageId(provider, externalSessionId),
      role: draft.role,
      text,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    });
  }

  return collapsed;
}

function extractCodexAssistantText(content: ReadonlyArray<unknown>): {
  readonly text: string | null;
  readonly skippedNonText: boolean;
} {
  const parts: string[] = [];
  let skippedNonText = false;

  for (const item of content) {
    const record = asRecord(item);
    if (!record) {
      skippedNonText = true;
      continue;
    }
    const type = asString(record.type);
    if (type === "output_text" || type === "text") {
      const text = asString(record.text);
      if (text) {
        parts.push(text);
      }
      continue;
    }
    skippedNonText = true;
  }

  const text = parts.join("\n\n").trim();
  return {
    text: text.length > 0 ? text : null,
    skippedNonText,
  };
}

function extractClaudeText(content: unknown): {
  readonly text: string | null;
  readonly skippedNonText: boolean;
} {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return { text: trimmed.length > 0 ? trimmed : null, skippedNonText: false };
  }

  const blocks = asArray(content);
  const parts: string[] = [];
  let skippedNonText = false;

  for (const block of blocks) {
    const record = asRecord(block);
    if (!record) {
      skippedNonText = true;
      continue;
    }
    const type = asString(record.type);
    if (type === "text") {
      const text = asString(record.text);
      if (text) {
        parts.push(text);
      }
      continue;
    }
    skippedNonText = true;
  }

  const text = parts.join("\n\n").trim();
  return {
    text: text.length > 0 ? text : null,
    skippedNonText,
  };
}

async function readJsonlRecords(filePath: string): Promise<ReadonlyArray<JsonRecord>> {
  const raw = await fs.readFile(filePath, "utf8");
  const records: JsonRecord[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        records.push(parsed);
      }
    } catch {
      // Ignore malformed lines and keep scanning other sessions.
    }
  }

  return records;
}

async function readJsonlRecordsUntil<T>(
  filePath: string,
  visitor: (record: JsonRecord) => T | null | undefined,
): Promise<T | null> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (!isRecord(parsed)) {
          continue;
        }
        const result = visitor(parsed);
        if (result !== null && result !== undefined) {
          return result;
        }
      } catch {
        // Ignore malformed lines and keep scanning other sessions.
      }
    }
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

async function readJsonRecord(filePath: string): Promise<JsonRecord | null> {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asIsoDateTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const timestamp = new Date(trimmed);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  }
  return null;
}

function getTimestamp(record: JsonRecord): string | null {
  return asIsoDateTime(record.timestamp);
}

export async function readCodexSessionIndexTitles(homeDir: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const indexPath = path.join(homeDir, ".codex", "session_index.jsonl");
  let records: ReadonlyArray<JsonRecord> = [];

  try {
    records = await readJsonlRecords(indexPath);
  } catch {
    return titles;
  }

  for (const record of records) {
    const id = asString(record.id);
    const title = asString(record.thread_name);
    if (id && title) {
      titles.set(id, title);
    }
  }

  return titles;
}

export async function peekCodexSessionCwd(input: {
  readonly sourcePath: string;
}): Promise<string | null> {
  return readJsonlRecordsUntil(input.sourcePath, (record) => {
    if (asString(record.type) !== "session_meta") {
      return null;
    }
    return asString(asRecord(record.payload)?.cwd);
  });
}

export async function parseCodexThreadImportSession(input: {
  readonly sourcePath: string;
  readonly indexedTitle?: string | null;
}): Promise<ParsedThreadImportSession | null> {
  const records = await readJsonlRecords(input.sourcePath);
  if (records.length === 0) {
    return null;
  }

  let externalSessionId: string | null = null;
  let cwd: string | null = null;
  let createdAt: string | null = null;
  let updatedAt: string | null = null;
  let model: string | null = null;
  let skippedNonText = false;
  const messages: ParsedMessageDraft[] = [];

  for (const record of records) {
    const timestamp = getTimestamp(record);
    if (timestamp) {
      if (createdAt === null || timestamp < createdAt) {
        createdAt = timestamp;
      }
      if (updatedAt === null || timestamp > updatedAt) {
        updatedAt = timestamp;
      }
    }

    const type = asString(record.type);
    if (type === "session_meta") {
      const payload = asRecord(record.payload);
      externalSessionId = asString(payload?.id) ?? externalSessionId;
      cwd = asString(payload?.cwd) ?? cwd;
      continue;
    }

    if (type === "turn_context") {
      const payload = asRecord(record.payload);
      model = asString(payload?.model) ?? model;
      continue;
    }

    if (type === "event_msg") {
      const payload = asRecord(record.payload);
      if (asString(payload?.type) === "user_message") {
        const text = asString(payload?.message);
        if (timestamp && text) {
          messages.push({
            role: "user",
            text,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      } else if (payload) {
        skippedNonText = true;
      }
      continue;
    }

    if (type === "response_item") {
      const payload = asRecord(record.payload);
      if (asString(payload?.type) !== "message") {
        skippedNonText = true;
        continue;
      }
      const role = asString(payload?.role);
      if (role !== "assistant") {
        continue;
      }
      const extracted = extractCodexAssistantText(asArray(payload?.content));
      skippedNonText = skippedNonText || extracted.skippedNonText;
      if (timestamp && extracted.text) {
        messages.push({
          role: "assistant",
          text: extracted.text,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      continue;
    }
  }

  if (!externalSessionId || !cwd || !createdAt || !updatedAt) {
    return null;
  }

  const collapsed = collapseAdjacentMessages("codex", externalSessionId, messages);
  const firstUserMessage = collapsed.find((message) => message.role === "user")?.text ?? null;
  const title = deriveTitle({
    explicitTitle: input.indexedTitle ?? null,
    firstUserMessage,
    cwd,
  });

  return {
    provider: "codex",
    externalSessionId,
    sourcePath: input.sourcePath,
    cwd,
    title,
    createdAt,
    updatedAt,
    messageCount: collapsed.length,
    model: model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
    providerThreadId: externalSessionId,
    sourceAliases: [],
    messages: collapsed,
    skippedNonText,
  };
}

export async function readClaudeDesktopSessionMetadata(input: {
  readonly sourcePath: string;
}): Promise<ClaudeDesktopSessionMetadata | null> {
  const record = await readJsonRecord(input.sourcePath);
  if (!record) {
    return null;
  }

  const sessionId = asString(record.sessionId);
  const cliSessionId = asString(record.cliSessionId);
  const cwd = asString(record.cwd) ?? asString(record.originCwd);
  const createdAt = asIsoDateTime(record.createdAt);
  const updatedAt = asIsoDateTime(record.lastActivityAt) ?? createdAt;

  if (!sessionId || !cliSessionId || !cwd || !createdAt || !updatedAt) {
    return null;
  }

  return {
    sourcePath: input.sourcePath,
    sessionId,
    cliSessionId,
    cwd,
    title: asString(record.title),
    createdAt,
    updatedAt,
    model: asString(record.model),
  };
}

export async function peekClaudeTranscriptCwd(input: {
  readonly sourcePath: string;
}): Promise<string | null> {
  return readJsonlRecordsUntil(input.sourcePath, (record) => asString(record.cwd));
}

export async function parseClaudeThreadImportSession(input: {
  readonly sourcePath: string;
  readonly transcriptPath?: string | null;
  readonly metadata?: ClaudeDesktopSessionMetadata | null;
}): Promise<ParsedThreadImportSession | null> {
  const transcriptPath =
    input.transcriptPath ?? (input.sourcePath.endsWith(".jsonl") ? input.sourcePath : null);
  if (!transcriptPath) {
    return null;
  }

  const records = await readJsonlRecords(transcriptPath);
  if (records.length === 0) {
    return null;
  }

  let externalSessionId: string | null = input.metadata?.sessionId ?? null;
  let cliSessionId: string | null = input.metadata?.cliSessionId ?? null;
  let cwd: string | null = input.metadata?.cwd ?? null;
  let createdAt: string | null = input.metadata?.createdAt ?? null;
  let updatedAt: string | null = input.metadata?.updatedAt ?? null;
  let model: string | null = input.metadata?.model ?? null;
  let skippedNonText = false;
  const messages: ParsedMessageDraft[] = [];

  for (const record of records) {
    const timestamp = getTimestamp(record);
    if (timestamp) {
      if (createdAt === null || timestamp < createdAt) {
        createdAt = timestamp;
      }
      if (updatedAt === null || timestamp > updatedAt) {
        updatedAt = timestamp;
      }
    }

    cliSessionId = asString(record.sessionId) ?? cliSessionId;
    cwd = asString(record.cwd) ?? cwd;

    const type = asString(record.type);
    if (type === "user") {
      const message = asRecord(record.message);
      const extracted = extractClaudeText(message?.content);
      skippedNonText = skippedNonText || extracted.skippedNonText;
      if (timestamp && extracted.text) {
        messages.push({
          role: "user",
          text: extracted.text,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      continue;
    }

    if (type === "assistant") {
      const message = asRecord(record.message);
      model = asString(message?.model) ?? model;
      const extracted = extractClaudeText(message?.content);
      skippedNonText = skippedNonText || extracted.skippedNonText;
      if (timestamp && extracted.text) {
        messages.push({
          role: "assistant",
          text: extracted.text,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      continue;
    }

    if (type) {
      skippedNonText = true;
    }
  }

  externalSessionId = externalSessionId ?? cliSessionId;
  if (!externalSessionId || !cwd || !createdAt || !updatedAt) {
    return null;
  }

  const collapsed = collapseAdjacentMessages("claudeAgent", externalSessionId, messages);
  const firstUserMessage = collapsed.find((message) => message.role === "user")?.text ?? null;
  const title = deriveTitle({
    explicitTitle: input.metadata?.title ?? null,
    firstUserMessage,
    cwd,
  });
  const sourceAliases =
    cliSessionId && transcriptPath !== input.sourcePath
      ? [{ externalSessionId: cliSessionId, sourcePath: transcriptPath }]
      : [];

  return {
    provider: "claudeAgent",
    externalSessionId,
    sourcePath: input.sourcePath,
    cwd,
    title,
    createdAt,
    updatedAt,
    messageCount: collapsed.length,
    model: model ?? DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
    providerThreadId: null,
    sourceAliases,
    messages: collapsed,
    skippedNonText,
  };
}

export function toThreadImportCandidate(input: {
  readonly session: ParsedThreadImportSession;
  readonly alreadyImportedThreadId: ThreadImportCandidate["alreadyImportedThreadId"];
}): ThreadImportCandidate {
  return {
    provider: input.session.provider,
    externalSessionId: input.session.externalSessionId,
    sourcePath: input.session.sourcePath,
    cwd: input.session.cwd,
    title: input.session.title,
    createdAt: input.session.createdAt,
    updatedAt: input.session.updatedAt,
    messageCount: input.session.messageCount,
    resumable: input.session.provider === "codex" && input.session.providerThreadId !== null,
    alreadyImportedThreadId: input.alreadyImportedThreadId,
  };
}
