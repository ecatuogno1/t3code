import type { ThreadId } from "@t3tools/contracts";

import type { DraftThreadState } from "./composerDraftStore";
import type { Thread } from "./types";

export type WorkspaceThreadCategoryId =
  | "all"
  | "attention"
  | "planning"
  | "recent"
  | "uncategorized"
  | `topic:${string}`;

export interface WorkspaceThreadCategory {
  id: WorkspaceThreadCategoryId;
  label: string;
  threadIds: ThreadId[];
}

const RECENT_THREAD_WINDOW_MS = 1000 * 60 * 60 * 24 * 14;

function slugifyTopicLabel(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "uncategorized"
  );
}

function resolveThreadTimestampMs(input: {
  thread: Thread | null;
  draftThread: DraftThreadState | null;
}): number {
  const candidateTimestamps = [
    input.thread?.latestTurn?.completedAt ?? null,
    input.thread?.latestTurn?.startedAt ?? null,
    input.thread?.latestTurn?.requestedAt ?? null,
    input.thread?.session?.updatedAt ?? null,
    input.thread?.lastVisitedAt ?? null,
    input.thread?.createdAt ?? null,
    input.draftThread?.createdAt ?? null,
  ];
  for (const value of candidateTimestamps) {
    if (!value) {
      continue;
    }
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }
  return 0;
}

function isAttentionThread(thread: Thread | null): boolean {
  return Boolean(
    thread?.error ||
    thread?.latestTurn?.state === "error" ||
    thread?.session?.status === "running" ||
    thread?.session?.status === "connecting" ||
    thread?.session?.status === "error",
  );
}

function isPlanningThread(input: {
  thread: Thread | null;
  draftThread: DraftThreadState | null;
}): boolean {
  return Boolean(
    input.thread?.interactionMode === "plan" ||
    input.draftThread?.interactionMode === "plan" ||
    input.thread?.proposedPlans.some((plan) => plan.implementedAt === null),
  );
}

function isRecentThread(input: {
  thread: Thread | null;
  draftThread: DraftThreadState | null;
  nowMs: number;
}): boolean {
  const timestampMs = resolveThreadTimestampMs(input);
  return timestampMs > 0 && input.nowMs - timestampMs <= RECENT_THREAD_WINDOW_MS;
}

export function listWorkspaceThreadCategories(input: {
  threadIds: ReadonlyArray<ThreadId>;
  threads: ReadonlyArray<Thread>;
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
  customTopics?: ReadonlyArray<string>;
  now?: string;
}): WorkspaceThreadCategory[] {
  const threadById = new Map(input.threads.map((thread) => [thread.id, thread] as const));
  const nowMs = Number.isNaN(input.now ? Date.parse(input.now) : Date.now())
    ? Date.now()
    : input.now
      ? Date.parse(input.now)
      : Date.now();

  const attentionThreadIds: ThreadId[] = [];
  const planningThreadIds: ThreadId[] = [];
  const recentThreadIds: ThreadId[] = [];
  const uncategorizedThreadIds: ThreadId[] = [];
  const topicBuckets = new Map<`topic:${string}`, { label: string; threadIds: ThreadId[] }>();

  for (const threadId of input.threadIds) {
    const thread = threadById.get(threadId) ?? null;
    const draftThread = input.draftThreadsByThreadId[threadId] ?? null;

    if (isAttentionThread(thread)) {
      attentionThreadIds.push(threadId);
    }
    if (isPlanningThread({ thread, draftThread })) {
      planningThreadIds.push(threadId);
    }
    if (isRecentThread({ thread, draftThread, nowMs })) {
      recentThreadIds.push(threadId);
    }

    const topicLabel = thread?.categorization?.label?.trim() ?? "";
    if (topicLabel.length > 0) {
      const bucketId = `topic:${slugifyTopicLabel(topicLabel)}` as const;
      const existingBucket = topicBuckets.get(bucketId) ?? { label: topicLabel, threadIds: [] };
      existingBucket.threadIds.push(threadId);
      topicBuckets.set(bucketId, existingBucket);
      continue;
    }

    uncategorizedThreadIds.push(threadId);
  }

  const categories: WorkspaceThreadCategory[] = [
    {
      id: "all",
      label: "All",
      threadIds: [...input.threadIds],
    },
  ];

  if (attentionThreadIds.length > 0) {
    categories.push({
      id: "attention",
      label: "Attention",
      threadIds: attentionThreadIds,
    });
  }
  if (planningThreadIds.length > 0) {
    categories.push({
      id: "planning",
      label: "Planning",
      threadIds: planningThreadIds,
    });
  }
  if (recentThreadIds.length > 0) {
    categories.push({
      id: "recent",
      label: "Recent",
      threadIds: recentThreadIds,
    });
  }

  for (const [categoryId, bucket] of [...topicBuckets.entries()].toSorted(
    (left, right) =>
      right[1].threadIds.length - left[1].threadIds.length ||
      left[1].label.localeCompare(right[1].label),
  )) {
    categories.push({
      id: categoryId,
      label: bucket.label,
      threadIds: bucket.threadIds,
    });
  }

  // Merge custom topics that don't already exist as auto-detected buckets.
  for (const customLabel of input.customTopics ?? []) {
    const trimmedLabel = customLabel.trim();
    if (trimmedLabel.length === 0) {
      continue;
    }
    const bucketId = `topic:${slugifyTopicLabel(trimmedLabel)}` as const;
    if (topicBuckets.has(bucketId)) {
      continue;
    }
    categories.push({
      id: bucketId,
      label: trimmedLabel,
      threadIds: [],
    });
  }

  if (uncategorizedThreadIds.length > 0) {
    categories.push({
      id: "uncategorized",
      label: "Uncategorized",
      threadIds: uncategorizedThreadIds,
    });
  }

  return categories;
}

export function resolveDefaultWorkspaceThreadCategoryId(
  categories: ReadonlyArray<WorkspaceThreadCategory>,
): WorkspaceThreadCategoryId {
  for (const preferredCategoryId of ["attention", "planning", "recent"] satisfies Array<
    Exclude<WorkspaceThreadCategoryId, `topic:${string}` | "uncategorized" | "all">
  >) {
    if (categories.some((category) => category.id === preferredCategoryId)) {
      return preferredCategoryId;
    }
  }
  const firstTopicCategory = categories.find((category) => category.id.startsWith("topic:"));
  if (firstTopicCategory) {
    return firstTopicCategory.id as WorkspaceThreadCategoryId;
  }
  if (categories.some((category) => category.id === "uncategorized")) {
    return "uncategorized";
  }
  return "all";
}
