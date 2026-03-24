import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_workspaces
    ADD COLUMN parent_workspace_id TEXT
  `;

  yield* sql`
    ALTER TABLE projection_workspaces
    ADD COLUMN root_workspace_id TEXT
  `;

  yield* sql`
    ALTER TABLE projection_workspaces
    ADD COLUMN origin_repo_key TEXT
  `;

  yield* sql`
    UPDATE projection_workspaces
    SET source = CASE
      WHEN source = 'project-default' THEN 'root'
      WHEN source = 'manual' THEN 'manual-view'
      ELSE source
    END
  `;

  yield* sql`
    WITH root_workspace_by_project AS (
      SELECT
        project_id,
        MIN(workspace_id) AS root_workspace_id
      FROM projection_workspaces
      WHERE source = 'root'
      GROUP BY project_id
    )
    UPDATE projection_workspaces
    SET
      root_workspace_id = COALESCE(
        (
          SELECT root_workspace_id
          FROM root_workspace_by_project
          WHERE root_workspace_by_project.project_id = projection_workspaces.project_id
        ),
        projection_workspaces.workspace_id
      ),
      parent_workspace_id = CASE
        WHEN source = 'root' THEN NULL
        ELSE COALESCE(
          (
            SELECT root_workspace_id
            FROM root_workspace_by_project
            WHERE root_workspace_by_project.project_id = projection_workspaces.project_id
          ),
          projection_workspaces.workspace_id
        )
      END,
      origin_repo_key = COALESCE(origin_repo_key, 'repo:' || project_id)
    WHERE root_workspace_id IS NULL OR origin_repo_key IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_workspace_projects (
      workspace_project_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      context_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    INSERT OR IGNORE INTO projection_workspace_projects (
      workspace_project_id,
      workspace_id,
      title,
      path,
      kind,
      context_key,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      'workspace-project:' || workspace_id || ':root',
      workspace_id,
      title,
      '',
      'root',
      'root',
      created_at,
      updated_at,
      deleted_at
    FROM projection_workspaces
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN workspace_project_id TEXT
  `;

  yield* sql`
    UPDATE projection_threads
    SET workspace_project_id = 'workspace-project:' || workspace_id || ':root'
    WHERE workspace_project_id IS NULL
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.workspaceProjectId',
      'workspace-project:' || json_extract(payload_json, '$.workspaceId') || ':root'
    )
    WHERE event_type = 'thread.created'
      AND json_type(payload_json, '$.workspaceProjectId') IS NULL
      AND json_type(payload_json, '$.workspaceId') IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_workspace_projects_workspace_id
    ON projection_workspace_projects(workspace_id, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_workspace_project_id
    ON projection_threads(workspace_project_id)
  `;
});
