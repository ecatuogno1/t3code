import { ThreadId, type WorkspaceProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { DraftThreadState } from "./composerDraftStore";
import type { Thread } from "./types";
import {
  listWorkspaceThreadCategories,
  resolveDefaultWorkspaceThreadCategoryId,
} from "./workspaceThreadCategories";

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe(id),
    codexThreadId: null,
    projectId: "project-1" as any,
    workspaceId: "workspace-1" as any,
    workspaceProjectId: null,
    title: id,
    model: "gpt-5",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    branch: null,
    worktreePath: null,
    pullRequestUrl: null,
    previewUrls: [],
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeDraftThread(
  createdAt: string,
  overrides: Partial<DraftThreadState> = {},
): DraftThreadState {
  return {
    projectId: "project-1" as any,
    workspaceId: "workspace-1" as any,
    workspaceProjectId: null as WorkspaceProjectId | null,
    createdAt,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequestUrl: null,
    envMode: "local",
    ...overrides,
  };
}

describe("workspaceThreadCategories", () => {
  it("groups threads into derived status and topic categories", () => {
    const threads = [
      makeThread("thread-attention", {
        session: {
          provider: "codex",
          status: "running",
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
          orchestrationStatus: "running",
        },
      }),
      makeThread("thread-plan", {
        interactionMode: "plan",
      }),
      makeThread("thread-ui-1", {
        categorization: {
          label: "UI Polish",
          model: "gpt-5.4-mini",
          fingerprint: "fp-ui-1",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      }),
      makeThread("thread-ui-2", {
        categorization: {
          label: "UI Polish",
          model: "gpt-5.4-mini",
          fingerprint: "fp-ui-2",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      }),
      makeThread("thread-build", {
        categorization: {
          label: "Build System",
          model: "gpt-5.4-mini",
          fingerprint: "fp-build",
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
      }),
      makeThread("thread-recent", {
        createdAt: "2026-03-18T00:00:00.000Z",
      }),
      makeThread("thread-uncategorized", {
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    ];

    const categories = listWorkspaceThreadCategories({
      threadIds: threads.map((thread) => thread.id),
      threads,
      draftThreadsByThreadId: {},
      now: "2026-03-22T00:00:00.000Z",
    });

    expect(categories).toEqual([
      { id: "all", label: "All", threadIds: threads.map((thread) => thread.id) },
      {
        id: "attention",
        label: "Attention",
        threadIds: [ThreadId.makeUnsafe("thread-attention")],
      },
      { id: "planning", label: "Planning", threadIds: [ThreadId.makeUnsafe("thread-plan")] },
      {
        id: "recent",
        label: "Recent",
        threadIds: [ThreadId.makeUnsafe("thread-attention"), ThreadId.makeUnsafe("thread-recent")],
      },
      {
        id: "topic:ui-polish",
        label: "UI Polish",
        threadIds: [ThreadId.makeUnsafe("thread-ui-1"), ThreadId.makeUnsafe("thread-ui-2")],
      },
      {
        id: "topic:build-system",
        label: "Build System",
        threadIds: [ThreadId.makeUnsafe("thread-build")],
      },
      {
        id: "uncategorized",
        label: "Uncategorized",
        threadIds: [
          ThreadId.makeUnsafe("thread-attention"),
          ThreadId.makeUnsafe("thread-plan"),
          ThreadId.makeUnsafe("thread-recent"),
          ThreadId.makeUnsafe("thread-uncategorized"),
        ],
      },
    ]);
  });

  it("prefers attention and planning categories for the default selection", () => {
    const categories = listWorkspaceThreadCategories({
      threadIds: [ThreadId.makeUnsafe("draft-thread")],
      threads: [],
      draftThreadsByThreadId: {
        [ThreadId.makeUnsafe("draft-thread")]: makeDraftThread("2026-03-21T00:00:00.000Z", {
          interactionMode: "plan",
        }),
      },
      now: "2026-03-22T00:00:00.000Z",
    });

    expect(resolveDefaultWorkspaceThreadCategoryId(categories)).toBe("planning");
  });

  it("falls back to the first topic bucket when there are no status buckets", () => {
    const categories = listWorkspaceThreadCategories({
      threadIds: [ThreadId.makeUnsafe("thread-ui")],
      threads: [
        makeThread("thread-ui", {
          categorization: {
            label: "UI Polish",
            model: "gpt-5.4-mini",
            fingerprint: "fp-ui",
            updatedAt: "2026-03-20T00:00:00.000Z",
          },
        }),
      ],
      draftThreadsByThreadId: {},
      now: "2026-03-22T00:00:00.000Z",
    });

    expect(resolveDefaultWorkspaceThreadCategoryId(categories)).toBe("topic:ui-polish");
  });
});
