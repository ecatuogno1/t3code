import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const MAX_PANE_ORDER_LENGTH = 24;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_workspaces
    SET
      layout_json = json_object(
        'paneOrder',
        CASE
          WHEN json_type(layout_json, '$.activePaneId') = 'text'
            AND trim(json_extract(layout_json, '$.activePaneId')) <> ''
            THEN json_array(json_extract(layout_json, '$.activePaneId'))
          WHEN json_type(layout_json, '$.paneOrder[0]') = 'text'
            AND trim(json_extract(layout_json, '$.paneOrder[0]')) <> ''
            THEN json_array(json_extract(layout_json, '$.paneOrder[0]'))
          ELSE json_array()
        END,
        'activePaneId',
        CASE
          WHEN json_type(layout_json, '$.activePaneId') = 'text'
            AND trim(json_extract(layout_json, '$.activePaneId')) <> ''
            THEN json_extract(layout_json, '$.activePaneId')
          WHEN json_type(layout_json, '$.paneOrder[0]') = 'text'
            AND trim(json_extract(layout_json, '$.paneOrder[0]')) <> ''
            THEN json_extract(layout_json, '$.paneOrder[0]')
          ELSE NULL
        END
      ),
      last_focused_pane_id = CASE
        WHEN json_type(layout_json, '$.activePaneId') = 'text'
          AND trim(json_extract(layout_json, '$.activePaneId')) <> ''
          THEN json_extract(layout_json, '$.activePaneId')
        WHEN json_type(layout_json, '$.paneOrder[0]') = 'text'
          AND trim(json_extract(layout_json, '$.paneOrder[0]')) <> ''
          THEN json_extract(layout_json, '$.paneOrder[0]')
        ELSE NULL
      END
    WHERE json_array_length(layout_json, '$.paneOrder') > ${MAX_PANE_ORDER_LENGTH}
  `;
});
