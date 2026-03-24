import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_import_sources (
      provider_name TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider_name, external_session_id, source_path)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_import_sources_thread_id
    ON thread_import_sources(thread_id)
  `;
});
