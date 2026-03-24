import type {
  BrowserTabSnapshot,
  GitStatusResult,
  ThreadId,
  WorkspaceId,
  WorkspaceProjectId,
  WorkspaceProjectSurface,
  WorkspaceSurface,
} from "@t3tools/contracts";

import { derivePendingApprovals, derivePendingUserInputs } from "./session-logic";
import type { Thread } from "./types";
import { hasUnseenCompletion, resolveThreadStatusPill } from "./components/Sidebar.logic";
import { normalizeThreadWorkspaceProjectId, resolveThreadOwnershipLabel } from "./workspaceShell";

export type WorkspaceActivityItemKind =
  | "pending-approval"
  | "awaiting-input"
  | "running"
  | "terminal-busy"
  | "git-attention"
  | "browser-loading"
  | "plan-ready"
  | "completed"
  | "preview-available";

export interface WorkspaceActivityItem {
  id: string;
  workspaceId: WorkspaceId;
  kind: WorkspaceActivityItemKind;
  label: string;
  threadId: ThreadId | null;
  workspaceProjectId: WorkspaceProjectId | null;
  ownerLabel: string | null;
  browserTabId: string | null;
  url: string | null;
  count: number;
}

export interface WorkspaceActivitySummary {
  items: WorkspaceActivityItem[];
}

export interface WorkspaceRowBadge {
  count: number;
  tone: "urgent" | "active" | "complete";
}

const WORKSPACE_ACTIVITY_PRIORITY: Record<WorkspaceActivityItemKind, number> = {
  "pending-approval": 0,
  "awaiting-input": 1,
  running: 2,
  "terminal-busy": 3,
  "git-attention": 4,
  "browser-loading": 5,
  "plan-ready": 6,
  completed: 7,
  "preview-available": 8,
};

function sortWorkspaceActivityItems(
  left: WorkspaceActivityItem,
  right: WorkspaceActivityItem,
): number {
  const byPriority =
    WORKSPACE_ACTIVITY_PRIORITY[left.kind] - WORKSPACE_ACTIVITY_PRIORITY[right.kind];
  if (byPriority !== 0) {
    return byPriority;
  }
  return left.label.localeCompare(right.label);
}

function formatGitAttentionLabel(gitStatus: GitStatusResult): string {
  const parts: string[] = [];
  if (gitStatus.hasWorkingTreeChanges) {
    parts.push("dirty");
  }
  if (gitStatus.behindCount > 0) {
    parts.push(`behind ${gitStatus.behindCount}`);
  }
  if (gitStatus.aheadCount > 0) {
    parts.push(`ahead ${gitStatus.aheadCount}`);
  }
  if (gitStatus.pr?.state === "open") {
    parts.push("PR open");
  }
  return parts.length > 0 ? `Git: ${parts.join(", ")}` : "Git attention";
}

function firstPreviewUrl(workspace: WorkspaceSurface): string | null {
  return workspace.detectedDevServerUrls[0] ?? null;
}

export function deriveWorkspaceRowBadge(input: {
  workspace: WorkspaceSurface;
  threads: ReadonlyArray<Thread>;
  runningTerminalIdsByThreadId: Record<string, ReadonlyArray<string>>;
  browserRuntimeTabsById: Record<string, BrowserTabSnapshot>;
}): WorkspaceRowBadge | null {
  let urgentCount = 0;
  let activeCount = 0;
  let completionCount = 0;

  for (const thread of input.threads) {
    if (thread.workspaceId !== input.workspace.id) {
      continue;
    }
    urgentCount += derivePendingApprovals(thread.activities).length;
    urgentCount += derivePendingUserInputs(thread.activities).length;
    if (thread.session?.status === "running" || thread.session?.status === "connecting") {
      activeCount += 1;
    }
    if ((input.runningTerminalIdsByThreadId[thread.id] ?? []).length > 0) {
      activeCount += 1;
    }
    if (hasUnseenCompletion(thread)) {
      completionCount += 1;
    }
  }

  const browserLoadingCount = input.workspace.browserTabs.filter(
    (tab) => input.browserRuntimeTabsById[tab.id]?.loading,
  ).length;
  activeCount += browserLoadingCount;

  const count = urgentCount + activeCount + completionCount;
  if (count === 0) {
    return null;
  }

  if (urgentCount > 0) {
    return { count, tone: "urgent" };
  }
  if (activeCount > 0) {
    return { count, tone: "active" };
  }
  return { count, tone: "complete" };
}

export function deriveWorkspaceActivitySummary(input: {
  workspace: WorkspaceSurface;
  threads: ReadonlyArray<Thread>;
  workspaceProjects: ReadonlyArray<WorkspaceProjectSurface>;
  runningTerminalIdsByThreadId: Record<string, ReadonlyArray<string>>;
  browserRuntimeTabsById: Record<string, BrowserTabSnapshot>;
  gitStatus?: GitStatusResult | null;
}): WorkspaceActivitySummary {
  const items: WorkspaceActivityItem[] = [];
  const workspaceThreads = input.threads.filter(
    (thread) => thread.workspaceId === input.workspace.id,
  );

  for (const thread of workspaceThreads) {
    const workspaceProjectId = normalizeThreadWorkspaceProjectId({
      workspaceProjectId: thread.workspaceProjectId,
      workspaceProjects: input.workspaceProjects,
    });
    const ownerLabel = resolveThreadOwnershipLabel({
      workspaceProjectId: thread.workspaceProjectId,
      workspaceProjects: input.workspaceProjects,
    });
    const pendingApprovals = derivePendingApprovals(thread.activities);
    if (pendingApprovals.length > 0) {
      items.push({
        id: `approval:${thread.id}`,
        workspaceId: input.workspace.id,
        kind: "pending-approval",
        label:
          pendingApprovals.length === 1
            ? `${thread.title}: pending approval`
            : `${thread.title}: ${pendingApprovals.length} approvals`,
        threadId: thread.id,
        workspaceProjectId,
        ownerLabel,
        browserTabId: null,
        url: null,
        count: pendingApprovals.length,
      });
    }

    const pendingUserInputs = derivePendingUserInputs(thread.activities);
    if (pendingUserInputs.length > 0) {
      items.push({
        id: `input:${thread.id}`,
        workspaceId: input.workspace.id,
        kind: "awaiting-input",
        label:
          pendingUserInputs.length === 1
            ? `${thread.title}: awaiting input`
            : `${thread.title}: ${pendingUserInputs.length} inputs`,
        threadId: thread.id,
        workspaceProjectId,
        ownerLabel,
        browserTabId: null,
        url: null,
        count: pendingUserInputs.length,
      });
    }

    if (thread.session?.status === "running" || thread.session?.status === "connecting") {
      items.push({
        id: `running:${thread.id}`,
        workspaceId: input.workspace.id,
        kind: "running",
        label: `${thread.title}: ${thread.session.status === "connecting" ? "connecting" : "working"}`,
        threadId: thread.id,
        workspaceProjectId,
        ownerLabel,
        browserTabId: null,
        url: null,
        count: 1,
      });
    }

    const runningTerminalCount = (input.runningTerminalIdsByThreadId[thread.id] ?? []).length;
    if (runningTerminalCount > 0) {
      items.push({
        id: `terminal:${thread.id}`,
        workspaceId: input.workspace.id,
        kind: "terminal-busy",
        label:
          runningTerminalCount === 1
            ? `${thread.title}: terminal busy`
            : `${thread.title}: ${runningTerminalCount} terminals busy`,
        threadId: thread.id,
        workspaceProjectId,
        ownerLabel,
        browserTabId: null,
        url: null,
        count: runningTerminalCount,
      });
    }

    const threadStatus = resolveThreadStatusPill({
      thread,
      hasPendingApprovals: pendingApprovals.length > 0,
      hasPendingUserInput: pendingUserInputs.length > 0,
    });
    if (threadStatus?.label === "Plan Ready") {
      items.push({
        id: `plan:${thread.id}`,
        workspaceId: input.workspace.id,
        kind: "plan-ready",
        label: `${thread.title}: plan ready`,
        threadId: thread.id,
        workspaceProjectId,
        ownerLabel,
        browserTabId: null,
        url: null,
        count: 1,
      });
    }

    if (hasUnseenCompletion(thread)) {
      items.push({
        id: `completed:${thread.id}`,
        workspaceId: input.workspace.id,
        kind: "completed",
        label: `${thread.title}: completed`,
        threadId: thread.id,
        workspaceProjectId,
        ownerLabel,
        browserTabId: null,
        url: null,
        count: 1,
      });
    }
  }

  if (
    input.gitStatus &&
    (input.gitStatus.hasWorkingTreeChanges ||
      input.gitStatus.aheadCount > 0 ||
      input.gitStatus.behindCount > 0 ||
      input.gitStatus.pr?.state === "open")
  ) {
    items.push({
      id: `git:${input.workspace.id}`,
      workspaceId: input.workspace.id,
      kind: "git-attention",
      label: formatGitAttentionLabel(input.gitStatus),
      threadId: null,
      workspaceProjectId: null,
      ownerLabel: null,
      browserTabId: null,
      url: input.gitStatus.pr?.state === "open" ? input.gitStatus.pr.url : null,
      count: 1,
    });
  }

  const loadingBrowserTabs = input.workspace.browserTabs.filter(
    (tab) => input.browserRuntimeTabsById[tab.id]?.loading,
  );
  if (loadingBrowserTabs.length > 0) {
    const firstTab = loadingBrowserTabs[0] ?? null;
    items.push({
      id: `browser-loading:${input.workspace.id}`,
      workspaceId: input.workspace.id,
      kind: "browser-loading",
      label:
        loadingBrowserTabs.length === 1
          ? `Browser loading: ${firstTab?.title ?? firstTab?.url ?? "tab"}`
          : `Browser loading: ${loadingBrowserTabs.length} tabs`,
      threadId: null,
      workspaceProjectId: null,
      ownerLabel: null,
      browserTabId: firstTab?.id ?? null,
      url: firstTab?.url ?? null,
      count: loadingBrowserTabs.length,
    });
  }

  const previewUrl = firstPreviewUrl(input.workspace);
  if (previewUrl) {
    const previewTab = input.workspace.browserTabs.find((tab) => tab.url === previewUrl) ?? null;
    items.push({
      id: `preview:${input.workspace.id}`,
      workspaceId: input.workspace.id,
      kind: "preview-available",
      label: "Preview available",
      threadId: null,
      workspaceProjectId: null,
      ownerLabel: null,
      browserTabId: previewTab?.id ?? null,
      url: previewUrl,
      count: 1,
    });
  }

  return {
    items: items.toSorted(sortWorkspaceActivityItems),
  };
}
