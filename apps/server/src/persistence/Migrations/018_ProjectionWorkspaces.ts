import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN workspace_id TEXT
  `;

  yield* sql`
    UPDATE projection_threads
    SET workspace_id = CASE
      WHEN worktree_path IS NULL OR TRIM(worktree_path) = ''
        THEN 'workspace:' || project_id || ':project-root'
      ELSE 'workspace:' || project_id || ':' || TRIM(worktree_path)
    END
    WHERE workspace_id IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_workspaces (
      workspace_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workspace_root TEXT NOT NULL,
      worktree_path TEXT,
      panes_json TEXT NOT NULL,
      terminal_groups_json TEXT NOT NULL,
      browser_tabs_json TEXT NOT NULL,
      detected_dev_server_urls_json TEXT NOT NULL,
      layout_json TEXT NOT NULL,
      last_focused_pane_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    INSERT INTO projection_workspaces (
      workspace_id,
      project_id,
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
    SELECT
      CASE
        WHEN thread.worktree_path IS NULL OR TRIM(thread.worktree_path) = ''
          THEN 'workspace:' || thread.project_id || ':project-root'
        ELSE 'workspace:' || thread.project_id || ':' || TRIM(thread.worktree_path)
      END AS workspace_id,
      thread.project_id,
      project.workspace_root,
      thread.worktree_path,
      json_array(
        json_object(
          'id', 'chat:' || thread.thread_id,
          'kind', 'chat',
          'title', thread.title,
          'threadId', thread.thread_id,
          'terminalGroupId', NULL,
          'browserTabId', NULL,
          'filePath', NULL,
          'createdAt', thread.created_at,
          'updatedAt', thread.updated_at
        )
      ),
      '[]',
      '[]',
      '[]',
      json_object(
        'paneOrder', json_array('chat:' || thread.thread_id),
        'activePaneId', 'chat:' || thread.thread_id
      ),
      'chat:' || thread.thread_id,
      thread.created_at,
      thread.updated_at,
      NULL
    FROM projection_threads AS thread
    INNER JOIN projection_projects AS project
      ON project.project_id = thread.project_id
    WHERE thread.deleted_at IS NULL
    ON CONFLICT (workspace_id)
    DO NOTHING
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_workspace_id
    ON projection_threads(workspace_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_workspaces_project_id
    ON projection_workspaces(project_id, updated_at)
  `;
});
