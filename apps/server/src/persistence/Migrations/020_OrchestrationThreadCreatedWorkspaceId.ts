import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.workspaceId',
      CASE
        WHEN json_type(payload_json, '$.worktreePath') IS NULL
          OR TRIM(COALESCE(json_extract(payload_json, '$.worktreePath'), '')) = ''
          THEN 'workspace:' || json_extract(payload_json, '$.projectId') || ':project-root'
        ELSE 'workspace:' || json_extract(payload_json, '$.projectId') || ':' ||
          TRIM(json_extract(payload_json, '$.worktreePath'))
      END
    )
    WHERE event_type = 'thread.created'
      AND json_type(payload_json, '$.workspaceId') IS NULL
      AND json_type(payload_json, '$.projectId') IS NOT NULL
  `;
});
