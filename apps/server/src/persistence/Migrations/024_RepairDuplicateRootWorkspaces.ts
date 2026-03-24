import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TEMP TABLE duplicate_root_workspace_repairs AS
    WITH ranked_roots AS (
      SELECT
        workspace_id AS duplicate_workspace_id,
        project_id,
        FIRST_VALUE(workspace_id) OVER (
          PARTITION BY project_id
          ORDER BY
            CASE
              WHEN workspace_id = 'workspace:' || project_id || ':project-root' THEN 0
              ELSE 1
            END,
            created_at ASC,
            workspace_id ASC
        ) AS canonical_workspace_id,
        ROW_NUMBER() OVER (
          PARTITION BY project_id
          ORDER BY
            CASE
              WHEN workspace_id = 'workspace:' || project_id || ':project-root' THEN 0
              ELSE 1
            END,
            created_at ASC,
            workspace_id ASC
        ) AS root_rank
      FROM projection_workspaces
      WHERE source IN ('root', 'project-default')
        AND deleted_at IS NULL
    ),
    donor_roots AS (
      SELECT DISTINCT
        project_id,
        FIRST_VALUE(panes_json) OVER (
          PARTITION BY project_id
          ORDER BY json_array_length(panes_json) DESC, updated_at DESC, workspace_id ASC
        ) AS panes_json,
        FIRST_VALUE(layout_json) OVER (
          PARTITION BY project_id
          ORDER BY json_array_length(panes_json) DESC, updated_at DESC, workspace_id ASC
        ) AS layout_json,
        FIRST_VALUE(last_focused_pane_id) OVER (
          PARTITION BY project_id
          ORDER BY json_array_length(panes_json) DESC, updated_at DESC, workspace_id ASC
        ) AS last_focused_pane_id,
        FIRST_VALUE(browser_tabs_json) OVER (
          PARTITION BY project_id
          ORDER BY json_array_length(browser_tabs_json) DESC, updated_at DESC, workspace_id ASC
        ) AS browser_tabs_json,
        FIRST_VALUE(terminal_groups_json) OVER (
          PARTITION BY project_id
          ORDER BY json_array_length(terminal_groups_json) DESC, updated_at DESC, workspace_id ASC
        ) AS terminal_groups_json,
        FIRST_VALUE(detected_dev_server_urls_json) OVER (
          PARTITION BY project_id
          ORDER BY json_array_length(detected_dev_server_urls_json) DESC, updated_at DESC, workspace_id ASC
        ) AS detected_dev_server_urls_json,
        MAX(updated_at) OVER (
          PARTITION BY project_id
        ) AS updated_at
      FROM projection_workspaces
      WHERE source IN ('root', 'project-default')
        AND deleted_at IS NULL
    )
    SELECT
      ranked_roots.project_id,
      ranked_roots.canonical_workspace_id,
      ranked_roots.duplicate_workspace_id,
      donor_roots.panes_json,
      donor_roots.layout_json,
      donor_roots.last_focused_pane_id,
      donor_roots.browser_tabs_json,
      donor_roots.terminal_groups_json,
      donor_roots.detected_dev_server_urls_json,
      donor_roots.updated_at
    FROM ranked_roots
    INNER JOIN donor_roots
      ON donor_roots.project_id = ranked_roots.project_id
    WHERE ranked_roots.root_rank > 1
  `;

  yield* sql`
    UPDATE projection_threads AS thread
    SET workspace_project_id = COALESCE(
      (
        SELECT canonical_project.workspace_project_id
        FROM projection_workspace_projects AS duplicate_project
        JOIN duplicate_root_workspace_repairs AS repair
          ON repair.duplicate_workspace_id = duplicate_project.workspace_id
        JOIN projection_workspace_projects AS canonical_project
          ON canonical_project.workspace_id = repair.canonical_workspace_id
         AND COALESCE(canonical_project.context_key, '') = COALESCE(duplicate_project.context_key, '')
         AND canonical_project.deleted_at IS NULL
        WHERE duplicate_project.workspace_project_id = thread.workspace_project_id
        LIMIT 1
      ),
      thread.workspace_project_id
    )
    WHERE thread.workspace_project_id IN (
      SELECT workspace_project_id
      FROM projection_workspace_projects
      WHERE workspace_id IN (
        SELECT duplicate_workspace_id
        FROM duplicate_root_workspace_repairs
      )
    )
  `;

  yield* sql`
    UPDATE projection_threads AS thread
    SET workspace_id = (
      SELECT repair.canonical_workspace_id
      FROM duplicate_root_workspace_repairs AS repair
      WHERE repair.duplicate_workspace_id = thread.workspace_id
      LIMIT 1
    )
    WHERE thread.workspace_id IN (
      SELECT duplicate_workspace_id
      FROM duplicate_root_workspace_repairs
    )
  `;

  yield* sql`
    UPDATE projection_workspaces AS workspace
    SET root_workspace_id = (
      SELECT repair.canonical_workspace_id
      FROM duplicate_root_workspace_repairs AS repair
      WHERE repair.duplicate_workspace_id = workspace.root_workspace_id
      LIMIT 1
    )
    WHERE workspace.root_workspace_id IN (
      SELECT duplicate_workspace_id
      FROM duplicate_root_workspace_repairs
    )
  `;

  yield* sql`
    UPDATE projection_workspaces AS workspace
    SET parent_workspace_id = (
      SELECT repair.canonical_workspace_id
      FROM duplicate_root_workspace_repairs AS repair
      WHERE repair.duplicate_workspace_id = workspace.parent_workspace_id
      LIMIT 1
    )
    WHERE workspace.parent_workspace_id IN (
      SELECT duplicate_workspace_id
      FROM duplicate_root_workspace_repairs
    )
  `;

  yield* sql`
    DELETE FROM projection_workspace_projects
    WHERE workspace_id IN (
      SELECT duplicate_workspace_id
      FROM duplicate_root_workspace_repairs
    )
  `;

  yield* sql`
    DELETE FROM projection_workspaces
    WHERE workspace_id IN (
      SELECT duplicate_workspace_id
      FROM duplicate_root_workspace_repairs
    )
  `;

  yield* sql`
    UPDATE projection_workspaces AS canonical
    SET
      panes_json = (
        SELECT repair.panes_json
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      layout_json = (
        SELECT repair.layout_json
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      last_focused_pane_id = (
        SELECT repair.last_focused_pane_id
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      browser_tabs_json = (
        SELECT repair.browser_tabs_json
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      terminal_groups_json = (
        SELECT repair.terminal_groups_json
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      detected_dev_server_urls_json = (
        SELECT repair.detected_dev_server_urls_json
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      updated_at = (
        SELECT repair.updated_at
        FROM duplicate_root_workspace_repairs AS repair
        WHERE repair.canonical_workspace_id = canonical.workspace_id
        LIMIT 1
      ),
      source = 'root',
      context_key = 'root',
      parent_workspace_id = NULL,
      root_workspace_id = canonical.workspace_id
    WHERE canonical.workspace_id IN (
      SELECT canonical_workspace_id
      FROM duplicate_root_workspace_repairs
    )
  `;

  yield* sql`
    UPDATE projection_workspaces
    SET
      source = 'root',
      context_key = 'root',
      parent_workspace_id = NULL,
      root_workspace_id = workspace_id
    WHERE source IN ('root', 'project-default')
      AND deleted_at IS NULL
      AND (context_key IS NULL OR context_key = 'project-default')
  `;

  yield* sql`
    DROP TABLE duplicate_root_workspace_repairs
  `;
});
