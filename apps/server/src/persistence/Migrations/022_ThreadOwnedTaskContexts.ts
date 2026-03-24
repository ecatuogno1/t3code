import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN pull_request_url TEXT
  `;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN preview_urls_json TEXT NOT NULL DEFAULT '[]'
  `;

  yield* sql`
    UPDATE projection_threads
    SET preview_urls_json = '[]'
    WHERE preview_urls_json IS NULL OR trim(preview_urls_json) = ''
  `;

  yield* sql`
    UPDATE projection_threads
    SET workspace_id = (
      SELECT projection_workspaces.root_workspace_id
      FROM projection_workspaces
      WHERE projection_workspaces.workspace_id = projection_threads.workspace_id
    )
    WHERE EXISTS (
      SELECT 1
      FROM projection_workspaces
      WHERE projection_workspaces.workspace_id = projection_threads.workspace_id
        AND projection_workspaces.source IN ('worktree', 'pull-request')
        AND projection_workspaces.root_workspace_id IS NOT NULL
    )
  `;
});
