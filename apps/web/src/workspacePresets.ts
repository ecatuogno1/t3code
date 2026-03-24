import type { ThreadId, WorkspaceId, WorkspaceSurface } from "@t3tools/contracts";
import { type useNavigate } from "@tanstack/react-router";

import type { Thread } from "./types";
import { openWorkspaceBrowserTab } from "./workspaceBrowser";
import { ensureWorkspaceFilesPane } from "./workspaceFiles";
import { openWorkspaceChatPane } from "./workspacePaneActions";

export type WorkspacePresetId = "agent-build" | "pr-review" | "bug-hunt";

export interface WorkspacePresetDefinition {
  id: WorkspacePresetId;
  label: string;
}

export interface WorkspacePresetPlan {
  focusThreadId: ThreadId | null;
  ensureFilesPane: boolean;
  browserTarget: { url: string; title: string } | null;
  openDiffForThreadId: ThreadId | null;
}

export const WORKSPACE_PRESETS: readonly WorkspacePresetDefinition[] = [
  { id: "agent-build", label: "Agent Build" },
  { id: "pr-review", label: "PR Review" },
  { id: "bug-hunt", label: "Bug Hunt" },
] as const;

function isPullRequestUrl(url: string): boolean {
  return /\/pull\/\d+(?:$|[?#/])/.test(url);
}

function resolvePreviewBrowserTarget(
  workspace: WorkspaceSurface,
): { url: string; title: string } | null {
  const previewUrl = workspace.detectedDevServerUrls[0] ?? null;
  if (!previewUrl) {
    return null;
  }
  const previewTab = workspace.browserTabs.find((tab) => tab.url === previewUrl) ?? null;
  return {
    url: previewTab?.url ?? previewUrl,
    title: previewTab?.title ?? "Preview",
  };
}

function resolvePullRequestBrowserTarget(
  workspace: WorkspaceSurface,
): { url: string; title: string } | null {
  const pullRequestTab =
    workspace.browserTabs.find(
      (tab) => isPullRequestUrl(tab.url) || tab.title === "Pull Request",
    ) ?? null;
  if (!pullRequestTab) {
    return null;
  }
  return {
    url: pullRequestTab.url,
    title: pullRequestTab.title ?? "Pull Request",
  };
}

export function resolveWorkspacePresetPlan(input: {
  presetId: WorkspacePresetId;
  workspace: WorkspaceSurface;
  threads: ReadonlyArray<Thread>;
  responsibleThreadId: ThreadId | null;
}): WorkspacePresetPlan {
  const responsibleThread = input.responsibleThreadId
    ? (input.threads.find((thread) => thread.id === input.responsibleThreadId) ?? null)
    : null;

  switch (input.presetId) {
    case "agent-build":
      return {
        focusThreadId: input.responsibleThreadId,
        ensureFilesPane: true,
        browserTarget: resolvePreviewBrowserTarget(input.workspace),
        openDiffForThreadId: null,
      };
    case "pr-review":
      return {
        focusThreadId: input.responsibleThreadId,
        ensureFilesPane: true,
        browserTarget: resolvePullRequestBrowserTarget(input.workspace),
        openDiffForThreadId:
          responsibleThread && responsibleThread.turnDiffSummaries.length > 0
            ? responsibleThread.id
            : null,
      };
    case "bug-hunt":
      return {
        focusThreadId: input.responsibleThreadId,
        ensureFilesPane: true,
        browserTarget: resolvePreviewBrowserTarget(input.workspace),
        openDiffForThreadId: null,
      };
  }
}

export async function applyWorkspacePreset(input: {
  workspaceId: WorkspaceId;
  presetId: WorkspacePresetId;
  workspace: WorkspaceSurface;
  threads: ReadonlyArray<Thread>;
  responsibleThreadId: ThreadId | null;
  navigate: ReturnType<typeof useNavigate>;
}): Promise<void> {
  const plan = resolveWorkspacePresetPlan({
    presetId: input.presetId,
    workspace: input.workspace,
    threads: input.threads,
    responsibleThreadId: input.responsibleThreadId,
  });

  if (plan.ensureFilesPane) {
    await ensureWorkspaceFilesPane(input.workspaceId, { focus: false });
  }

  if (plan.browserTarget) {
    await openWorkspaceBrowserTab({
      workspaceId: input.workspaceId,
      url: plan.browserTarget.url,
      title: plan.browserTarget.title,
      focus: false,
    });
  }

  if (plan.focusThreadId) {
    await openWorkspaceChatPane({
      workspaceId: input.workspaceId,
      threadId: plan.focusThreadId,
    });
  }

  await input.navigate({
    to: "/workspaces/$workspaceId",
    params: { workspaceId: input.workspaceId },
    search: (previous) => {
      if (!plan.openDiffForThreadId) {
        return {
          ...previous,
          diff: undefined,
          diffTurnId: undefined,
          diffFilePath: undefined,
        };
      }
      return {
        ...previous,
        diff: "1",
        diffTurnId: undefined,
        diffFilePath: undefined,
      };
    },
  });
}
