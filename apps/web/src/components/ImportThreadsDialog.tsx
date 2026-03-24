import type { ThreadImportCandidate } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useMemo } from "react";

import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { refreshImportedThreadState, scanThreadImports } from "../threadImports";
import { buildChatPaneId } from "../workspaceShell";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { toastManager } from "./ui/toast";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function providerLabel(provider: ThreadImportCandidate["provider"]): string {
  return provider === "codex" ? "Codex" : "Claude Code";
}

function compareCandidates(left: ThreadImportCandidate, right: ThreadImportCandidate): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.title.localeCompare(right.title) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

export function ImportThreadsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspaceRoot?: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const syncWorkspaceReadModel = useStore((store) => store.syncWorkspaceReadModel);
  const openWorkspaceThreadPane = useStore((store) => store.openWorkspaceThreadPane);
  const focusWorkspacePane = useStore((store) => store.focusWorkspacePane);
  const rememberVisitedWorkspace = useStore((store) => store.rememberVisitedWorkspace);
  const api = readNativeApi();

  const scanQuery = useQuery({
    queryKey: ["thread-imports", props.workspaceRoot ?? null],
    enabled: props.open,
    queryFn: async () => {
      if (!api) {
        return [];
      }
      return scanThreadImports(api, props.workspaceRoot);
    },
  });

  const groupedCandidates = useMemo(() => {
    const providerGroups = new Map<
      ThreadImportCandidate["provider"],
      Map<string, ThreadImportCandidate[]>
    >();
    for (const candidate of scanQuery.data ?? []) {
      const providerGroup =
        providerGroups.get(candidate.provider) ?? new Map<string, ThreadImportCandidate[]>();
      const cwdGroup = providerGroup.get(candidate.cwd) ?? [];
      cwdGroup.push(candidate);
      providerGroup.set(candidate.cwd, cwdGroup);
      providerGroups.set(candidate.provider, providerGroup);
    }

    return [...providerGroups.entries()]
      .toSorted(([left], [right]) => providerLabel(left).localeCompare(providerLabel(right)))
      .map(([provider, cwdGroups]) => ({
        provider,
        groups: [...cwdGroups.entries()]
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([cwd, candidates]) => ({
            cwd,
            candidates: [...candidates].toSorted(compareCandidates),
          })),
      }));
  }, [scanQuery.data]);

  const importMutation = useMutation({
    mutationFn: async (candidate: ThreadImportCandidate) => {
      if (!api) {
        throw new Error("Native API is unavailable.");
      }
      return api.imports.importSession({
        provider: candidate.provider,
        externalSessionId: candidate.externalSessionId,
        sourcePath: candidate.sourcePath,
      });
    },
    onSuccess: async (result, candidate) => {
      if (!api) {
        return;
      }
      await refreshImportedThreadState(api, {
        syncServerReadModel,
        syncWorkspaceReadModel,
      });
      rememberVisitedWorkspace(result.workspaceId);
      openWorkspaceThreadPane(result.workspaceId, result.threadId);
      focusWorkspacePane(result.workspaceId, buildChatPaneId(result.threadId));
      await queryClient.invalidateQueries({
        queryKey: ["thread-imports", props.workspaceRoot ?? null],
      });
      props.onOpenChange(false);
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: result.workspaceId },
      });
      toastManager.add({
        type: "success",
        title: candidate.alreadyImportedThreadId ? "Opened imported thread" : "Imported thread",
        description:
          result.continuationMode === "codex-resume"
            ? "Codex continuation is available."
            : "Continuation will start a fresh provider session.",
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Thread import failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    },
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-4xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Import Threads</DialogTitle>
          <DialogDescription>
            Import local Codex and Claude Code transcripts for the current project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {scanQuery.data
                ? `${scanQuery.data.length} import candidate${scanQuery.data.length === 1 ? "" : "s"}`
                : "Scanning project sessions..."}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void scanQuery.refetch()}
              disabled={scanQuery.isFetching}
            >
              <RefreshCwIcon className={`size-3.5 ${scanQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {scanQuery.isLoading ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Scanning local Codex and Claude sessions for this project…
            </div>
          ) : scanQuery.isError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-destructive">
              {scanQuery.error instanceof Error
                ? scanQuery.error.message
                : "Unable to scan local sessions."}
            </div>
          ) : groupedCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No local Codex or Claude Code threads were found for this project.
            </div>
          ) : (
            <div className="space-y-6">
              {groupedCandidates.map((providerGroup) => (
                <section key={providerGroup.provider} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">
                      {providerLabel(providerGroup.provider)}
                    </h3>
                    <Badge variant="outline" size="sm">
                      {providerGroup.groups.reduce(
                        (total, group) => total + group.candidates.length,
                        0,
                      )}{" "}
                      threads
                    </Badge>
                  </div>

                  {providerGroup.groups.map((cwdGroup) => (
                    <div
                      key={`${providerGroup.provider}:${cwdGroup.cwd}`}
                      className="overflow-hidden rounded-xl border"
                    >
                      <div className="border-b bg-muted/35 px-4 py-2.5">
                        <p className="truncate text-xs font-medium text-foreground/85">
                          {cwdGroup.cwd}
                        </p>
                      </div>
                      <div className="divide-y">
                        {cwdGroup.candidates.map((candidate) => {
                          const isPending =
                            importMutation.isPending &&
                            importMutation.variables?.provider === candidate.provider &&
                            importMutation.variables?.externalSessionId ===
                              candidate.externalSessionId &&
                            importMutation.variables?.sourcePath === candidate.sourcePath;
                          return (
                            <div
                              key={`${candidate.provider}:${candidate.externalSessionId}:${candidate.sourcePath}`}
                              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {candidate.title}
                                  </p>
                                  {candidate.resumable && (
                                    <Badge size="sm" variant="success">
                                      Resumable
                                    </Badge>
                                  )}
                                  {candidate.alreadyImportedThreadId && (
                                    <Badge size="sm" variant="secondary">
                                      Already imported
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {candidate.messageCount} visible messages • updated{" "}
                                  {formatDateTime(candidate.updatedAt)}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => importMutation.mutate(candidate)}
                                disabled={isPending}
                              >
                                {isPending
                                  ? "Working…"
                                  : candidate.alreadyImportedThreadId
                                    ? "Open"
                                    : "Import"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
