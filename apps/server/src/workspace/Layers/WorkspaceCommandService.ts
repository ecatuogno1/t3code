import {
  type WorkspaceDispatchCommandResult,
  type WorkspaceProjectId,
  WorkspaceId,
} from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { ProjectionProjectRepository } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionWorkspaceRepository } from "../../persistence/Services/ProjectionWorkspaces.ts";
import { ProjectionWorkspaceProjectRepository } from "../../persistence/Services/ProjectionWorkspaceProjects.ts";
import {
  WorkspaceCommandError,
  WorkspaceCommandService,
  type WorkspaceCommandServiceShape,
} from "../Services/WorkspaceCommandService.ts";
import { WorkspaceSnapshotQuery } from "../Services/WorkspaceSnapshotQuery.ts";
import {
  applyWorkspaceCommandToProjection,
  buildWorkspaceContextKey,
  createDefaultWorkspaceProjection,
  deriveWorkspaceTitle,
} from "../workspaceProjection.ts";

function normalizeWorkspaceCreateContextKey(contextKey: string | null): string | null {
  return contextKey === "project-default" ? "root" : contextKey;
}

function isRootWorkspaceCandidate(input: {
  readonly source: string;
  readonly contextKey: string | null;
  readonly deletedAt: string | null;
}): boolean {
  if (input.deletedAt !== null) {
    return false;
  }
  return (
    input.source === "root" ||
    input.source === "project-default" ||
    normalizeWorkspaceCreateContextKey(input.contextKey) === "root"
  );
}

const makeWorkspaceCommandService = Effect.gen(function* () {
  const workspaceRepository = yield* ProjectionWorkspaceRepository;
  const workspaceProjectRepository = yield* ProjectionWorkspaceProjectRepository;
  const projectRepository = yield* ProjectionProjectRepository;
  const workspaceSnapshotQuery = yield* WorkspaceSnapshotQuery;

  const dispatch: WorkspaceCommandServiceShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      if (command.type === "workspace.create") {
        const project = yield* projectRepository.getById({
          projectId: command.projectId,
        });
        if (Option.isNone(project) || project.value.deletedAt !== null) {
          return yield* new WorkspaceCommandError({
            message: `Project not found: ${command.projectId}`,
          });
        }

        const normalizedWorktreePath = command.worktreePath?.trim() ? command.worktreePath : null;
        const normalizedSource =
          command.source === "project-default"
            ? "root"
            : command.source === "manual"
              ? "manual-view"
              : command.source;
        const contextKey = normalizeWorkspaceCreateContextKey(
          command.contextKey !== undefined
            ? (command.contextKey ?? null)
            : buildWorkspaceContextKey({
                source: normalizedSource,
                worktreePath: normalizedWorktreePath,
              }),
        );
        const title = deriveWorkspaceTitle({
          projectTitle: project.value.title,
          workspaceRoot: project.value.workspaceRoot,
          source: normalizedSource,
          worktreePath: normalizedWorktreePath,
          ...(command.title !== undefined ? { title: command.title } : {}),
        });
        const existingWorkspaces = yield* workspaceRepository.listByProjectId({
          projectId: command.projectId,
        });
        const existingRootWorkspace =
          existingWorkspaces.find((workspace) =>
            isRootWorkspaceCandidate({
              source: workspace.source,
              contextKey: workspace.contextKey,
              deletedAt: workspace.deletedAt,
            }),
          ) ?? null;
        const originRepoKey = `repo:${command.projectId}` as const;
        const createdRootWorkspaceId = WorkspaceId.makeUnsafe(`workspace:${crypto.randomUUID()}`);
        const resolvedRootWorkspace =
          existingRootWorkspace ??
          createDefaultWorkspaceProjection({
            workspaceId: createdRootWorkspaceId,
            projectId: command.projectId,
            title: deriveWorkspaceTitle({
              projectTitle: project.value.title,
              workspaceRoot: project.value.workspaceRoot,
              source: "root",
              worktreePath: null,
            }),
            source: "root",
            contextKey: buildWorkspaceContextKey({
              source: "root",
              worktreePath: null,
            }),
            parentWorkspaceId: null,
            rootWorkspaceId: createdRootWorkspaceId,
            originRepoKey,
            workspaceRoot: project.value.workspaceRoot,
            worktreePath: null,
            createdAt: command.createdAt,
            updatedAt: command.createdAt,
          });
        if (!existingRootWorkspace && normalizedSource !== "root") {
          yield* workspaceRepository.upsert(resolvedRootWorkspace);
        }
        const existingAutoWorkspace =
          normalizedSource === "root"
            ? existingRootWorkspace
            : contextKey === null
              ? null
              : (existingWorkspaces.find(
                  (workspace) =>
                    workspace.deletedAt === null &&
                    normalizeWorkspaceCreateContextKey(workspace.contextKey) === contextKey,
                ) ?? null);
        if (existingAutoWorkspace) {
          const resolvedRootWorkspaceId =
            normalizedSource === "root"
              ? existingAutoWorkspace.workspaceId
              : resolvedRootWorkspace.workspaceId;
          const updatedWorkspace = {
            ...existingAutoWorkspace,
            title,
            source: normalizedSource,
            contextKey,
            parentWorkspaceId: normalizedSource === "root" ? null : resolvedRootWorkspaceId,
            rootWorkspaceId: resolvedRootWorkspaceId,
            originRepoKey,
            workspaceRoot: project.value.workspaceRoot,
            worktreePath: normalizedWorktreePath,
            updatedAt: command.createdAt,
            deletedAt: null,
          };
          yield* workspaceRepository.upsert(updatedWorkspace);
          return {
            updatedAt: updatedWorkspace.updatedAt,
            workspaceId: updatedWorkspace.workspaceId,
          } satisfies WorkspaceDispatchCommandResult;
        }

        const workspaceId = WorkspaceId.makeUnsafe(`workspace:${crypto.randomUUID()}`);
        const rootWorkspaceId =
          normalizedSource === "root" ? workspaceId : resolvedRootWorkspace.workspaceId;
        const workspace = createDefaultWorkspaceProjection({
          workspaceId,
          projectId: command.projectId,
          title,
          source: normalizedSource,
          contextKey,
          parentWorkspaceId: normalizedSource === "root" ? null : rootWorkspaceId,
          rootWorkspaceId,
          originRepoKey,
          workspaceRoot: project.value.workspaceRoot,
          worktreePath: normalizedWorktreePath,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
        });
        yield* workspaceRepository.upsert(workspace);
        return {
          updatedAt: workspace.updatedAt,
          workspaceId: workspace.workspaceId,
        } satisfies WorkspaceDispatchCommandResult;
      }

      if (command.type === "workspaceProject.create") {
        const existingWorkspace = yield* workspaceRepository.getById({
          workspaceId: command.workspaceId,
        });
        if (Option.isNone(existingWorkspace) || existingWorkspace.value.deletedAt !== null) {
          return yield* new WorkspaceCommandError({
            message: `Workspace not found: ${command.workspaceId}`,
          });
        }
        const normalizedPath = command.path
          .trim()
          .replace(/^\.\/+/, "")
          .replace(/^\/+|\/+$/g, "");
        const workspaceProjectId =
          `workspace-project:${command.workspaceId}:${crypto.randomUUID()}` as WorkspaceProjectId;
        yield* workspaceProjectRepository.upsert({
          workspaceProjectId,
          workspaceId: command.workspaceId,
          title: command.title,
          path: normalizedPath,
          kind: command.kind,
          contextKey: null,
          createdAt: command.createdAt,
          updatedAt: command.createdAt,
          deletedAt: null,
        });
        return {
          updatedAt: command.createdAt,
          workspaceId: command.workspaceId,
        } satisfies WorkspaceDispatchCommandResult;
      }

      const existing = yield* workspaceRepository.getById({
        workspaceId: command.workspaceId,
      });
      if (Option.isNone(existing)) {
        return yield* new WorkspaceCommandError({
          message: `Workspace not found: ${command.workspaceId}`,
        });
      }
      if (command.type === "workspace.archive") {
        const snapshot = yield* workspaceSnapshotQuery.getSnapshot();
        const linkedWorkspace =
          snapshot.workspaces.find((workspace) => workspace.id === command.workspaceId) ?? null;
        const linkedThreadCount = linkedWorkspace?.linkedThreadIds.length ?? 0;
        const hasResources =
          existing.value.panes.length > 0 ||
          existing.value.browserTabs.length > 0 ||
          existing.value.terminalGroups.length > 0 ||
          existing.value.detectedDevServerUrls.length > 0;
        const archiveableSource =
          existing.value.source === "manual-view" || existing.value.source === "manual";
        if (!archiveableSource || linkedThreadCount > 0 || hasResources) {
          return yield* new WorkspaceCommandError({
            message: `Workspace cannot be archived: ${command.workspaceId}`,
          });
        }
      }
      const updatedWorkspace = applyWorkspaceCommandToProjection({
        workspace: existing.value,
        command,
      });
      yield* workspaceRepository.upsert({
        ...updatedWorkspace,
        ...(command.type === "workspace.archive" ? { deletedAt: command.updatedAt } : {}),
      });
      return {
        updatedAt: updatedWorkspace.updatedAt,
        workspaceId: updatedWorkspace.workspaceId,
      } satisfies WorkspaceDispatchCommandResult;
    });

  return {
    dispatch,
    getSnapshot: workspaceSnapshotQuery.getSnapshot,
  } satisfies WorkspaceCommandServiceShape;
});

export const WorkspaceCommandServiceLive = Layer.effect(
  WorkspaceCommandService,
  makeWorkspaceCommandService,
);
