import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseClaudeThreadImportSession,
  parseCodexThreadImportSession,
} from "./threadImportParsers.ts";

const tempDirs: string[] = [];

async function writeFixture(relativeName: string, lines: ReadonlyArray<unknown>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "t3code-thread-import-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, relativeName);
  await fs.writeFile(filePath, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return filePath;
}

async function writeJsonFixture(relativeName: string, value: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "t3code-thread-import-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, relativeName);
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("parseCodexThreadImportSession", () => {
  it("imports visible user and assistant text while skipping wrapper/tool content", async () => {
    const sourcePath = await writeFixture("codex.jsonl", [
      {
        timestamp: "2026-03-01T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "codex-thread-1",
          cwd: "/tmp/codex-project",
        },
      },
      {
        timestamp: "2026-03-01T10:00:00.100Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "# AGENTS and environment wrapper" }],
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Build the importer",
          images: [],
        },
      },
      {
        timestamp: "2026-03-01T10:00:01.100Z",
        type: "turn_context",
        payload: {
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-03-01T10:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "Plan:" },
            { type: "output_text", text: "Add parser and UI." },
            { type: "reasoning", text: "hidden chain of thought" },
          ],
        },
      },
      {
        timestamp: "2026-03-01T10:00:02.500Z",
        type: "response_item",
        payload: {
          type: "function_call",
        },
      },
    ]);

    const parsed = await parseCodexThreadImportSession({
      sourcePath,
      indexedTitle: "Imported Codex Thread",
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Imported Codex Thread");
    expect(parsed?.cwd).toBe("/tmp/codex-project");
    expect(parsed?.externalSessionId).toBe("codex-thread-1");
    expect(parsed?.providerThreadId).toBe("codex-thread-1");
    expect(parsed?.model).toBe("gpt-5.4");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual(
      [
        { role: "user", text: "Build the importer" },
        { role: "assistant", text: "Plan:\n\nAdd parser and UI." },
      ],
    );
    expect(parsed?.skippedNonText).toBe(true);
  });
});

describe("parseClaudeThreadImportSession", () => {
  it("imports visible Claude text and collapses adjacent assistant messages", async () => {
    const sourcePath = await writeFixture("claude.jsonl", [
      {
        type: "user",
        timestamp: "2026-03-02T09:00:00.000Z",
        sessionId: "claude-session-1",
        cwd: "/tmp/claude-project",
        message: {
          content: "Import this thread",
        },
      },
      {
        type: "assistant",
        timestamp: "2026-03-02T09:00:01.000Z",
        sessionId: "claude-session-1",
        cwd: "/tmp/claude-project",
        message: {
          model: "claude-sonnet-4-6",
          content: [
            { type: "text", text: "I can do that." },
            { type: "thinking", text: "hidden reasoning" },
          ],
        },
      },
      {
        type: "assistant",
        timestamp: "2026-03-02T09:00:02.000Z",
        sessionId: "claude-session-1",
        cwd: "/tmp/claude-project",
        message: {
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "First I will scan your local sessions." }],
        },
      },
      {
        type: "system",
        timestamp: "2026-03-02T09:00:03.000Z",
        sessionId: "claude-session-1",
      },
    ]);

    const parsed = await parseClaudeThreadImportSession({ sourcePath });

    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Import this thread");
    expect(parsed?.cwd).toBe("/tmp/claude-project");
    expect(parsed?.externalSessionId).toBe("claude-session-1");
    expect(parsed?.providerThreadId).toBeNull();
    expect(parsed?.model).toBe("claude-sonnet-4-6");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual(
      [
        { role: "user", text: "Import this thread" },
        {
          role: "assistant",
          text: "I can do that.\n\nFirst I will scan your local sessions.",
        },
      ],
    );
    expect(parsed?.skippedNonText).toBe(true);
  });

  it("prefers Claude desktop metadata and keeps the transcript as an alias", async () => {
    const transcriptPath = await writeFixture("claude.jsonl", [
      {
        type: "user",
        timestamp: "2026-03-02T09:00:00.000Z",
        sessionId: "claude-cli-session-1",
        cwd: "/tmp/claude-project",
        message: {
          content: "Import this Claude Code thread",
        },
      },
      {
        type: "assistant",
        timestamp: "2026-03-02T09:00:01.000Z",
        sessionId: "claude-cli-session-1",
        cwd: "/tmp/claude-project",
        message: {
          content: [{ type: "text", text: "Resolved through desktop metadata." }],
        },
      },
    ]);
    const sourcePath = await writeJsonFixture("claude-desktop.json", {
      sessionId: "local_claude_session_1",
      cliSessionId: "claude-cli-session-1",
      cwd: "/tmp/claude-project",
      originCwd: "/tmp/claude-project",
      createdAt: 1772634000000,
      lastActivityAt: 1772634001000,
      model: "claude-opus-4-6",
      title: "Desktop Claude Thread",
      isArchived: false,
    });

    const parsed = await parseClaudeThreadImportSession({
      sourcePath,
      transcriptPath,
      metadata: {
        sourcePath,
        sessionId: "local_claude_session_1",
        cliSessionId: "claude-cli-session-1",
        cwd: "/tmp/claude-project",
        title: "Desktop Claude Thread",
        createdAt: "2026-03-02T09:00:00.000Z",
        updatedAt: "2026-03-02T09:00:01.000Z",
        model: "claude-opus-4-6",
      },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.externalSessionId).toBe("local_claude_session_1");
    expect(parsed?.title).toBe("Desktop Claude Thread");
    expect(parsed?.model).toBe("claude-opus-4-6");
    expect(parsed?.sourcePath).toBe(sourcePath);
    expect(parsed?.sourceAliases).toEqual([
      {
        externalSessionId: "claude-cli-session-1",
        sourcePath: transcriptPath,
      },
    ]);
  });
});
