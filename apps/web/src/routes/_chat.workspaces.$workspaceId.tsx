import { type TurnId, WorkspaceId } from "@t3tools/contracts";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell";
import { Spinner } from "../components/ui/spinner";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useStore } from "../store";
import { resolveDefaultWorkspaceId } from "../workspaceShell";

const MAX_CACHED_WORKSPACES = 3;
const EVICTION_TIMEOUT_MS = 60_000;
const FADE_DURATION_MS = 150;
const EMPTY_DIFF_SEARCH: DiffRouteSearch = {};

type TransitionPhase = "idle" | "fade-out" | "loading" | "fade-in";

interface CachedWorkspaceEntry {
  id: WorkspaceId;
  lastActiveAt: number;
}

function WorkspaceRouteView() {
  const navigate = useNavigate();
  const search = useSearch({
    strict: false,
    select: (params) => parseDiffRouteSearch(params),
  });
  const workspaceId = Route.useParams({
    select: (params) => WorkspaceId.makeUnsafe(params.workspaceId),
  });
  const workspaceExists = useStore(
    (store) => store.workspaces.some((workspace) => workspace.id === workspaceId),
  );
  const workspacesHydrated = useStore((store) => store.workspacesHydrated);
  const rememberVisitedWorkspace = useStore((store) => store.rememberVisitedWorkspace);

  const [cachedEntries, setCachedEntries] = useState<CachedWorkspaceEntry[]>([]);
  // The workspace currently visible on screen (lags behind workspaceId during transitions)
  const [visibleWorkspaceId, setVisibleWorkspaceId] = useState<WorkspaceId | null>(null);
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const pendingWorkspaceIdRef = useRef<WorkspaceId | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!workspaceExists) {
      return;
    }
    rememberVisitedWorkspace(workspaceId);
  }, [rememberVisitedWorkspace, workspaceExists, workspaceId]);

  useEffect(() => {
    if (!workspacesHydrated || workspaceExists) {
      return;
    }
    const fallbackWorkspaceId = resolveDefaultWorkspaceId(useStore.getState().workspaces);
    if (!fallbackWorkspaceId) {
      void navigate({ to: "/", replace: true });
      return;
    }
    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: fallbackWorkspaceId },
      replace: true,
    });
  }, [navigate, workspaceExists, workspaceId, workspacesHydrated]);

  // Maintain cache of recently visited workspaces
  useEffect(() => {
    if (!workspaceExists) {
      return;
    }
    setCachedEntries((prev) => {
      const now = Date.now();
      const withoutCurrent = prev.filter((e) => e.id !== workspaceId);
      const updated = [...withoutCurrent, { id: workspaceId, lastActiveAt: now }];
      return updated.slice(-MAX_CACHED_WORKSPACES);
    });
  }, [workspaceExists, workspaceId]);

  // Evict stale cached entries
  useEffect(() => {
    const timer = setInterval(() => {
      setCachedEntries((prev) => {
        const now = Date.now();
        const filtered = prev.filter(
          (e) => e.id === workspaceId || now - e.lastActiveAt < EVICTION_TIMEOUT_MS,
        );
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 30_000);
    return () => clearInterval(timer);
  }, [workspaceId]);

  // Transition orchestrator: fade-out → (loading) → fade-in
  useEffect(() => {
    if (!workspaceExists) {
      return;
    }

    // First mount — show immediately, no transition
    if (visibleWorkspaceId === null) {
      setVisibleWorkspaceId(workspaceId);
      setPhase("fade-in");
      fadeTimerRef.current = setTimeout(() => {
        setPhase("idle");
        fadeTimerRef.current = null;
      }, FADE_DURATION_MS);
      return;
    }

    // Same workspace — nothing to do
    if (workspaceId === visibleWorkspaceId && phase === "idle") {
      return;
    }

    // New workspace requested — start fade-out
    if (workspaceId !== pendingWorkspaceIdRef.current || phase === "idle") {
      pendingWorkspaceIdRef.current = workspaceId;

      // Clear any running timer
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }

      setPhase("fade-out");
      fadeTimerRef.current = setTimeout(() => {
        fadeTimerRef.current = null;
        const target = pendingWorkspaceIdRef.current;
        if (!target) return;

        // Check if the target workspace is already cached (instant switch)
        const isCached = cachedEntries.some((e) => e.id === target);
        if (isCached) {
          // Skip loading, go straight to fade-in
          setVisibleWorkspaceId(target);
          setPhase("fade-in");
          fadeTimerRef.current = setTimeout(() => {
            setPhase("idle");
            fadeTimerRef.current = null;
          }, FADE_DURATION_MS);
        } else {
          // Show loading spinner briefly while new workspace mounts
          setPhase("loading");
          setVisibleWorkspaceId(target);
          // Give React a frame to mount the workspace, then fade in
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setPhase("fade-in");
              fadeTimerRef.current = setTimeout(() => {
                setPhase("idle");
                fadeTimerRef.current = null;
              }, FADE_DURATION_MS);
            });
          });
        }
      }, FADE_DURATION_MS);
    }

    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, workspaceExists]);

  const closeDiff = useCallback(() => {
    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
      search: (previous) => ({
        ...stripDiffSearchParams(previous),
      }),
    });
  }, [navigate, workspaceId]);

  const openDiff = useCallback(() => {
    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
      search: (previous) => ({
        ...stripDiffSearchParams(previous),
        diff: "1",
      }),
    });
  }, [navigate, workspaceId]);

  const openTurnDiff = useCallback(
    (turnId: TurnId, filePath?: string) => {
      void navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return filePath
            ? { ...rest, diff: "1", diffTurnId: turnId, diffFilePath: filePath }
            : { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [navigate, workspaceId],
  );

  const selectDiffTurn = useCallback(
    (turnId: TurnId) => {
      void navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId },
        search: (previous) => ({
          ...stripDiffSearchParams(previous),
          diff: "1",
          diffTurnId: turnId,
        }),
      });
    },
    [navigate, workspaceId],
  );

  const selectWholeConversationDiff = useCallback(() => {
    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
      search: (previous) => ({
        ...stripDiffSearchParams(previous),
        diff: "1",
      }),
    });
  }, [navigate, workspaceId]);

  if (!workspacesHydrated || !workspaceExists) {
    return null;
  }

  // During loading phase, show spinner
  if (phase === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {cachedEntries.map((entry) => {
        const isVisible = entry.id === visibleWorkspaceId;
        return (
          <div
            key={entry.id}
            className={
              isVisible
                ? phase === "fade-out"
                  ? "workspace-fade-out"
                  : phase === "fade-in"
                    ? "workspace-fade-in"
                    : undefined
                : undefined
            }
            style={{ display: isVisible ? "contents" : "none" }}
          >
            <WorkspaceShell
              workspaceId={entry.id}
              isWorkspaceActive={isVisible}
              diffSearch={isVisible ? search : EMPTY_DIFF_SEARCH}
              onCloseDiff={closeDiff}
              onOpenDiff={openDiff}
              onOpenTurnDiff={openTurnDiff}
              onSelectDiffTurn={selectDiffTurn}
              onSelectWholeConversationDiff={selectWholeConversationDiff}
            />
          </div>
        );
      })}
    </>
  );
}

export const Route = createFileRoute("/_chat/workspaces/$workspaceId")({
  component: WorkspaceRouteView,
});
