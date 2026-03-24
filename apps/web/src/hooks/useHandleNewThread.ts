import {
  DEFAULT_RUNTIME_MODE,
  type ProjectId,
  ThreadId,
  WorkspaceId,
  type WorkspaceProjectId,
} from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { useStore } from "../store";
import {
  buildChatPaneId,
  parseChatPaneThreadId,
  resolveActiveWorkspaceProjectId,
  resolveDefaultWorkspaceId,
  resolveWorkspaceRootId,
} from "../workspaceShell";
import { ensureWorkspaceEntity, resolveProjectDefaultWorkspace } from "../workspaceEntities";

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const workspaces = useStore((store) => store.workspaces);
  const workspaceProjects = useStore((store) => store.workspaceProjects);
  const workspaceShellById = useStore((store) => store.workspaceShellById);
  const activeWorkspaceProjectIdByWorkspaceId = useStore(
    (store) => store.activeWorkspaceProjectIdByWorkspaceId,
  );
  const openWorkspaceThreadPane = useStore((store) => store.openWorkspaceThreadPane);
  const focusWorkspacePane = useStore((store) => store.focusWorkspacePane);
  const navigate = useNavigate();
  const routeParams = useParams({
    strict: false,
    select: (params) => ({
      threadId: params.threadId ? ThreadId.makeUnsafe(params.threadId) : null,
      workspaceId: params.workspaceId ? WorkspaceId.makeUnsafe(params.workspaceId) : null,
    }),
  });
  const routeThreadId = routeParams.threadId;
  const routeWorkspaceId = routeParams.workspaceId;
  const routeWorkspace =
    (routeWorkspaceId ? workspaces.find((workspace) => workspace.id === routeWorkspaceId) : null) ??
    null;
  const routeWorkspaceProjectId = routeWorkspaceId
    ? resolveActiveWorkspaceProjectId({
        workspaceId: routeWorkspaceId,
        workspaceProjects,
        activeWorkspaceProjectIdByWorkspaceId,
      })
    : null;
  const activeWorkspaceThreadId =
    routeWorkspaceId && workspaceShellById[routeWorkspaceId]?.activePaneId
      ? parseChatPaneThreadId(workspaceShellById[routeWorkspaceId].activePaneId ?? "")
      : null;
  const effectiveThreadId = routeThreadId ?? activeWorkspaceThreadId;
  const activeDraftThread = useComposerDraftStore((store) =>
    effectiveThreadId ? (store.draftThreadsByThreadId[effectiveThreadId] ?? null) : null,
  );

  const activeThread = effectiveThreadId
    ? threads.find((thread) => thread.id === effectiveThreadId)
    : undefined;

  const navigateToWorkspaceThread = useCallback(
    async (input: { workspaceId: WorkspaceId | null; threadId: ThreadId }) => {
      const targetWorkspaceId = input.workspaceId ?? resolveDefaultWorkspaceId(workspaces);
      if (!targetWorkspaceId) {
        return;
      }
      openWorkspaceThreadPane(targetWorkspaceId, input.threadId);
      focusWorkspacePane(targetWorkspaceId, buildChatPaneId(input.threadId));
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: targetWorkspaceId },
      });
    },
    [focusWorkspacePane, navigate, openWorkspaceThreadPane, workspaces],
  );

  const resolveTargetWorkspaceId = useCallback(
    async (input: {
      projectId: ProjectId;
      workspaceId?: WorkspaceId | null;
    }): Promise<WorkspaceId | null> => {
      if (input.workspaceId) {
        const explicitWorkspace = workspaces.find(
          (workspace) => workspace.id === input.workspaceId,
        );
        if (explicitWorkspace) {
          return resolveWorkspaceRootId({
            workspace: explicitWorkspace,
            workspaces,
          });
        }
        return input.workspaceId;
      }
      if (routeWorkspace && routeWorkspace.projectId === input.projectId) {
        return resolveWorkspaceRootId({
          workspace: routeWorkspace,
          workspaces,
        });
      }
      const projectDefaultWorkspace = resolveProjectDefaultWorkspace(workspaces, input.projectId);
      if (projectDefaultWorkspace) {
        return resolveWorkspaceRootId({
          workspace: projectDefaultWorkspace,
          workspaces,
        });
      }
      const ensuredWorkspace = await ensureWorkspaceEntity({
        projectId: input.projectId,
        source: "root",
      });
      return (
        ensuredWorkspace?.id ??
        (routeWorkspace?.projectId === input.projectId
          ? resolveWorkspaceRootId({
              workspace: routeWorkspace,
              workspaces,
            })
          : null) ??
        resolveDefaultWorkspaceId(useStore.getState().workspaces)
      );
    },
    [routeWorkspace, workspaces],
  );

  const resolveTargetWorkspaceProjectId = useCallback(
    (input: {
      workspaceId: WorkspaceId | null;
      requestedWorkspaceProjectIdExplicitlySet?: boolean;
      requestedWorkspaceProjectId?: WorkspaceProjectId | null;
    }): WorkspaceProjectId | null => {
      if (!input.workspaceId) {
        return null;
      }
      const availableProjects = workspaceProjects.filter(
        (workspaceProject) =>
          workspaceProject.workspaceId === input.workspaceId && workspaceProject.deletedAt === null,
      );
      if (
        input.requestedWorkspaceProjectIdExplicitlySet &&
        input.requestedWorkspaceProjectId === null
      ) {
        return null;
      }
      const requestedWorkspaceProject = input.requestedWorkspaceProjectId
        ? (availableProjects.find(
            (workspaceProject) => workspaceProject.id === input.requestedWorkspaceProjectId,
          ) ?? null)
        : null;
      if (requestedWorkspaceProject) {
        return requestedWorkspaceProject.kind === "root" ? null : requestedWorkspaceProject.id;
      }
      const activeWorkspaceProjectId =
        activeWorkspaceProjectIdByWorkspaceId[input.workspaceId] ?? null;
      if (
        activeWorkspaceProjectId &&
        availableProjects.some(
          (workspaceProject) => workspaceProject.id === activeWorkspaceProjectId,
        )
      ) {
        return activeWorkspaceProjectId;
      }
      return (
        availableProjects.find((workspaceProject) => workspaceProject.kind === "root")?.id ??
        availableProjects[0]?.id ??
        null
      );
    },
    [activeWorkspaceProjectIdByWorkspaceId, workspaceProjects],
  );

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        pullRequestUrl?: string | null;
        target?: {
          workspaceId?: WorkspaceId | null;
          workspaceProjectId: WorkspaceProjectId | null;
        };
        workspaceProjectId?: WorkspaceProjectId | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        setDraftThreadContext,
        setProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasPullRequestUrlOption = options?.pullRequestUrl !== undefined;
      const hasExplicitTarget = options?.target !== undefined;
      const hasTargetWorkspaceOption =
        hasExplicitTarget &&
        Object.prototype.hasOwnProperty.call(options.target ?? {}, "workspaceId");
      const hasWorkspaceProjectOption = options?.workspaceProjectId !== undefined;
      const hasTargetWorkspaceProjectOption =
        hasExplicitTarget &&
        Object.prototype.hasOwnProperty.call(options.target ?? {}, "workspaceProjectId");
      const hasEnvModeOption = options?.envMode !== undefined;
      const requestedWorkspaceProjectId = hasTargetWorkspaceProjectOption
        ? (options?.target?.workspaceProjectId ?? null)
        : options?.workspaceProjectId;
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null;
      if (storedDraftThread) {
        return (async () => {
          if (
            hasBranchOption ||
            hasWorktreePathOption ||
            hasPullRequestUrlOption ||
            hasTargetWorkspaceOption ||
            hasTargetWorkspaceProjectOption ||
            hasWorkspaceProjectOption ||
            hasEnvModeOption
          ) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasTargetWorkspaceOption
                ? { workspaceId: options?.target?.workspaceId ?? null }
                : {}),
              ...(hasTargetWorkspaceProjectOption || hasWorkspaceProjectOption
                ? { workspaceProjectId: requestedWorkspaceProjectId ?? null }
                : {}),
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasPullRequestUrlOption
                ? { pullRequestUrl: options?.pullRequestUrl ?? null }
                : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          const targetWorkspaceId = await resolveTargetWorkspaceId({
            projectId,
            workspaceId: hasTargetWorkspaceOption ? (options?.target?.workspaceId ?? null) : null,
          });
          const targetWorkspaceProjectId = resolveTargetWorkspaceProjectId({
            workspaceId: targetWorkspaceId,
            requestedWorkspaceProjectIdExplicitlySet:
              hasTargetWorkspaceProjectOption || hasWorkspaceProjectOption,
            requestedWorkspaceProjectId:
              requestedWorkspaceProjectId ??
              storedDraftThread.workspaceProjectId ??
              routeWorkspaceProjectId,
          });
          setDraftThreadContext(storedDraftThread.threadId, {
            workspaceId: targetWorkspaceId,
            workspaceProjectId: targetWorkspaceProjectId,
          });
          await navigateToWorkspaceThread({
            workspaceId: targetWorkspaceId,
            threadId: storedDraftThread.threadId,
          });
        })();
      }

      clearProjectDraftThreadId(projectId);

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        if (
          hasBranchOption ||
          hasWorktreePathOption ||
          hasPullRequestUrlOption ||
          hasTargetWorkspaceOption ||
          hasTargetWorkspaceProjectOption ||
          hasWorkspaceProjectOption ||
          hasEnvModeOption
        ) {
          setDraftThreadContext(routeThreadId, {
            ...(hasTargetWorkspaceOption
              ? { workspaceId: options?.target?.workspaceId ?? null }
              : routeWorkspaceId
                ? { workspaceId: routeWorkspaceId }
                : {}),
            ...(hasTargetWorkspaceProjectOption || hasWorkspaceProjectOption
              ? { workspaceProjectId: requestedWorkspaceProjectId ?? null }
              : routeWorkspaceProjectId
                ? { workspaceProjectId: routeWorkspaceProjectId }
                : {}),
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasPullRequestUrlOption ? { pullRequestUrl: options?.pullRequestUrl ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        const targetWorkspaceId = await resolveTargetWorkspaceId({
          projectId,
          workspaceId: hasTargetWorkspaceOption ? (options?.target?.workspaceId ?? null) : null,
        });
        const targetWorkspaceProjectId = resolveTargetWorkspaceProjectId({
          workspaceId: targetWorkspaceId,
          requestedWorkspaceProjectIdExplicitlySet:
            hasTargetWorkspaceProjectOption || hasWorkspaceProjectOption,
          requestedWorkspaceProjectId: requestedWorkspaceProjectId ?? routeWorkspaceProjectId,
        });
        setProjectDraftThreadId(projectId, threadId, {
          workspaceId: targetWorkspaceId,
          workspaceProjectId: targetWorkspaceProjectId,
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          pullRequestUrl: options?.pullRequestUrl ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
        });

        await navigateToWorkspaceThread({
          workspaceId: targetWorkspaceId,
          threadId,
        });
      })();
    },
    [
      navigateToWorkspaceThread,
      resolveTargetWorkspaceId,
      resolveTargetWorkspaceProjectId,
      routeThreadId,
      routeWorkspaceId,
      routeWorkspaceProjectId,
    ],
  );

  return {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeWorkspaceProjectId,
    routeWorkspaceId,
    routeThreadId,
  };
}
