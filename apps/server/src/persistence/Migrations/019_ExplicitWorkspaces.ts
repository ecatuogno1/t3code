import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_workspaces
    ADD COLUMN title TEXT
  `;

  yield* sql`
    ALTER TABLE projection_workspaces
    ADD COLUMN source TEXT
  `;

  yield* sql`
    ALTER TABLE projection_workspaces
    ADD COLUMN context_key TEXT
  `;

  yield* sql`
    UPDATE projection_workspaces
    SET
      title = CASE
        WHEN worktree_path IS NULL OR TRIM(worktree_path) = ''
          THEN COALESCE(
            (
              SELECT title
              FROM projection_projects AS project
              WHERE project.project_id = projection_workspaces.project_id
            ),
            workspace_root
          )
        ELSE TRIM(worktree_path)
      END,
      source = CASE
        WHEN worktree_path IS NULL OR TRIM(worktree_path) = ''
          THEN 'project-default'
        ELSE 'worktree'
      END,
      context_key = CASE
        WHEN worktree_path IS NULL OR TRIM(worktree_path) = ''
          THEN 'project-default'
        ELSE 'worktree:' || TRIM(worktree_path)
      END
    WHERE title IS NULL OR source IS NULL OR context_key IS NULL
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_workspaces_project_context_key
    ON projection_workspaces(project_id, context_key)
    WHERE context_key IS NOT NULL
  `;
});
