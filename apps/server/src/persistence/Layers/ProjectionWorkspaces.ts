import {
  type WorkspaceBrowserTab,
  WorkspaceLayoutState,
  type WorkspacePane,
  type WorkspaceTerminalGroup,
} from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer, Option, Schema } from "effect";

import {
  toPersistenceDecodeCauseError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../Errors.ts";
import {
  ProjectionWorkspaceRepository,
  type ProjectionWorkspace,
  type ProjectionWorkspaceRepositoryShape,
} from "../Services/ProjectionWorkspaces.ts";

const decodeWorkspaceLayout = Schema.decodeUnknownEffect(WorkspaceLayoutState);

type ProjectionWorkspaceDbRow = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly title: string;
  readonly source: string;
  readonly contextKey: string | null;
  readonly parentWorkspaceId: string | null;
  readonly rootWorkspaceId: string;
  readonly originRepoKey: string;
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly panes: string;
  readonly terminalGroups: string;
  readonly browserTabs: string;
  readonly detectedDevServerUrls: string;
  readonly layout: string;
  readonly lastFocusedPaneId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
};

function parseJsonArray<T>(json: string): ReadonlyArray<T> {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ReadonlyArray<T>) : [];
  } catch {
    return [];
  }
}

const decodeWorkspaceRow = (
  row: ProjectionWorkspaceDbRow,
): Effect.Effect<ProjectionWorkspace, ProjectionRepositoryError> =>
  Effect.gen(function* () {
    const panes = parseJsonArray<WorkspacePane>(row.panes);
    const terminalGroups = parseJsonArray<WorkspaceTerminalGroup>(row.terminalGroups);
    const browserTabs = parseJsonArray<WorkspaceBrowserTab>(row.browserTabs);
    const detectedDevServerUrls = parseJsonArray<string>(row.detectedDevServerUrls);
    const layoutSource = yield* Effect.try({
      try: () => JSON.parse(row.layout),
      catch: toPersistenceDecodeCauseError(
        "ProjectionWorkspaceRepository.decodeWorkspaceRow:layout",
      ),
    });
    const layout = yield* decodeWorkspaceLayout(layoutSource).pipe(
      Effect.mapError(
        toPersistenceDecodeError("ProjectionWorkspaceRepository.decodeWorkspaceRow:layout"),
      ),
    );

    return {
      workspaceId: row.workspaceId as ProjectionWorkspace["workspaceId"],
      projectId: row.projectId as ProjectionWorkspace["projectId"],
      title: row.title as ProjectionWorkspace["title"],
      source: row.source as ProjectionWorkspace["source"],
      contextKey: row.contextKey as ProjectionWorkspace["contextKey"],
      parentWorkspaceId: row.parentWorkspaceId as ProjectionWorkspace["parentWorkspaceId"],
      rootWorkspaceId: row.rootWorkspaceId as ProjectionWorkspace["rootWorkspaceId"],
      originRepoKey: row.originRepoKey as ProjectionWorkspace["originRepoKey"],
      workspaceRoot: row.workspaceRoot,
      worktreePath: row.worktreePath,
      panes,
      terminalGroups,
      browserTabs,
      detectedDevServerUrls,
      layout,
      lastFocusedPaneId: row.lastFocusedPaneId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  });

const makeProjectionWorkspaceRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsert: ProjectionWorkspaceRepositoryShape["upsert"] = (row) =>
    sql`
      INSERT INTO projection_workspaces (
        workspace_id,
        project_id,
        title,
        source,
        context_key,
        parent_workspace_id,
        root_workspace_id,
        origin_repo_key,
        workspace_root,
        worktree_path,
        panes_json,
        terminal_groups_json,
        browser_tabs_json,
        detected_dev_server_urls_json,
        layout_json,
        last_focused_pane_id,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        ${row.workspaceId},
        ${row.projectId},
        ${row.title},
        ${row.source},
        ${row.contextKey},
        ${row.parentWorkspaceId},
        ${row.rootWorkspaceId},
        ${row.originRepoKey},
        ${row.workspaceRoot},
        ${row.worktreePath},
        ${JSON.stringify(row.panes)},
        ${JSON.stringify(row.terminalGroups)},
        ${JSON.stringify(row.browserTabs)},
        ${JSON.stringify(row.detectedDevServerUrls)},
        ${JSON.stringify(row.layout)},
        ${row.lastFocusedPaneId},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.deletedAt}
      )
      ON CONFLICT (workspace_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        source = excluded.source,
        context_key = excluded.context_key,
        parent_workspace_id = excluded.parent_workspace_id,
        root_workspace_id = excluded.root_workspace_id,
        origin_repo_key = excluded.origin_repo_key,
        workspace_root = excluded.workspace_root,
        worktree_path = excluded.worktree_path,
        panes_json = excluded.panes_json,
        terminal_groups_json = excluded.terminal_groups_json,
        browser_tabs_json = excluded.browser_tabs_json,
        detected_dev_server_urls_json = excluded.detected_dev_server_urls_json,
        layout_json = excluded.layout_json,
        last_focused_pane_id = excluded.last_focused_pane_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.upsert:query")),
    );

  const decodeRows = (
    rows: ReadonlyArray<ProjectionWorkspaceDbRow>,
  ): Effect.Effect<ReadonlyArray<ProjectionWorkspace>, ProjectionRepositoryError> =>
    Effect.forEach(rows, decodeWorkspaceRow, { concurrency: 1 });

  const getById: ProjectionWorkspaceRepositoryShape["getById"] = (input) =>
    sql<ProjectionWorkspaceDbRow>`
      SELECT
        workspace_id AS "workspaceId",
        project_id AS "projectId",
        title,
        source,
        context_key AS "contextKey",
        parent_workspace_id AS "parentWorkspaceId",
        root_workspace_id AS "rootWorkspaceId",
        origin_repo_key AS "originRepoKey",
        workspace_root AS "workspaceRoot",
        worktree_path AS "worktreePath",
        panes_json AS "panes",
        terminal_groups_json AS "terminalGroups",
        browser_tabs_json AS "browserTabs",
        detected_dev_server_urls_json AS "detectedDevServerUrls",
        layout_json AS "layout",
        last_focused_pane_id AS "lastFocusedPaneId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_workspaces
      WHERE workspace_id = ${input.workspaceId}
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.getById:query")),
      Effect.flatMap((rows) =>
        rows.length === 0
          ? Effect.succeed(Option.none())
          : decodeWorkspaceRow(rows[0]!).pipe(Effect.map(Option.some)),
      ),
    );

  const list: ProjectionWorkspaceRepositoryShape["list"] = () =>
    sql<ProjectionWorkspaceDbRow>`
      SELECT
        workspace_id AS "workspaceId",
        project_id AS "projectId",
        title,
        source,
        context_key AS "contextKey",
        parent_workspace_id AS "parentWorkspaceId",
        root_workspace_id AS "rootWorkspaceId",
        origin_repo_key AS "originRepoKey",
        workspace_root AS "workspaceRoot",
        worktree_path AS "worktreePath",
        panes_json AS "panes",
        terminal_groups_json AS "terminalGroups",
        browser_tabs_json AS "browserTabs",
        detected_dev_server_urls_json AS "detectedDevServerUrls",
        layout_json AS "layout",
        last_focused_pane_id AS "lastFocusedPaneId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_workspaces
      ORDER BY created_at ASC, workspace_id ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.list:query")),
      Effect.flatMap((rows) => decodeRows(rows)),
    );

  const listByProjectId: ProjectionWorkspaceRepositoryShape["listByProjectId"] = (input) =>
    sql<ProjectionWorkspaceDbRow>`
      SELECT
        workspace_id AS "workspaceId",
        project_id AS "projectId",
        title,
        source,
        context_key AS "contextKey",
        parent_workspace_id AS "parentWorkspaceId",
        root_workspace_id AS "rootWorkspaceId",
        origin_repo_key AS "originRepoKey",
        workspace_root AS "workspaceRoot",
        worktree_path AS "worktreePath",
        panes_json AS "panes",
        terminal_groups_json AS "terminalGroups",
        browser_tabs_json AS "browserTabs",
        detected_dev_server_urls_json AS "detectedDevServerUrls",
        layout_json AS "layout",
        last_focused_pane_id AS "lastFocusedPaneId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_workspaces
      WHERE project_id = ${input.projectId}
      ORDER BY created_at ASC, workspace_id ASC
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkspaceRepository.listByProjectId:query")),
      Effect.flatMap((rows) => decodeRows(rows)),
    );

  return {
    upsert,
    getById,
    list,
    listByProjectId,
  } satisfies ProjectionWorkspaceRepositoryShape;
});

export const ProjectionWorkspaceRepositoryLive = Layer.effect(
  ProjectionWorkspaceRepository,
  makeProjectionWorkspaceRepository,
);
