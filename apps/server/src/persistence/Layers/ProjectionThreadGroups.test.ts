import { ProjectId, ThreadGroupId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionThreadGroupRepository } from "../Services/ProjectionThreadGroups.ts";
import { ProjectionThreadGroupRepositoryLive } from "./ProjectionThreadGroups.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadGroupRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadGroupRepository", (it) => {
  it.effect("upserts a new thread group and retrieves it by ID", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadGroupRepository;
      const groupId = ThreadGroupId.makeUnsafe("group-upsert-get");
      const projectId = ProjectId.makeUnsafe("project-upsert-get");

      yield* repository.upsert({
        groupId,
        projectId,
        title: "My Group",
        color: "#ff0000",
        isCollapsed: false,
        orderIndex: 0,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        deletedAt: null,
      });

      const result = yield* repository.getById({ groupId });
      assert.ok(Option.isSome(result));
      const group = result.value;
      assert.equal(group.groupId, groupId);
      assert.equal(group.projectId, projectId);
      assert.equal(group.title, "My Group");
      assert.equal(group.color, "#ff0000");
      assert.equal(group.isCollapsed, false);
      assert.equal(group.orderIndex, 0);
    }),
  );

  it.effect("lists thread groups for a project, respecting order_index", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadGroupRepository;
      const projectId = ProjectId.makeUnsafe("project-list-order");

      yield* repository.upsert({
        groupId: ThreadGroupId.makeUnsafe("group-order-c"),
        projectId,
        title: "Third",
        color: "blue",
        isCollapsed: false,
        orderIndex: 2,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        deletedAt: null,
      });

      yield* repository.upsert({
        groupId: ThreadGroupId.makeUnsafe("group-order-a"),
        projectId,
        title: "First",
        color: "blue",
        isCollapsed: false,
        orderIndex: 0,
        createdAt: "2026-03-01T10:01:00.000Z",
        updatedAt: "2026-03-01T10:01:00.000Z",
        deletedAt: null,
      });

      yield* repository.upsert({
        groupId: ThreadGroupId.makeUnsafe("group-order-b"),
        projectId,
        title: "Second",
        color: "blue",
        isCollapsed: false,
        orderIndex: 1,
        createdAt: "2026-03-01T10:02:00.000Z",
        updatedAt: "2026-03-01T10:02:00.000Z",
        deletedAt: null,
      });

      const rows = yield* repository.listByProjectId({ projectId });
      assert.equal(rows.length, 3);
      assert.equal(rows[0]?.title, "First");
      assert.equal(rows[1]?.title, "Second");
      assert.equal(rows[2]?.title, "Third");
    }),
  );

  it.effect("updates an existing thread group (title, color, collapsed state)", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadGroupRepository;
      const groupId = ThreadGroupId.makeUnsafe("group-update");
      const projectId = ProjectId.makeUnsafe("project-update");

      yield* repository.upsert({
        groupId,
        projectId,
        title: "Original Title",
        color: "#00ff00",
        isCollapsed: false,
        orderIndex: 0,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        deletedAt: null,
      });

      yield* repository.upsert({
        groupId,
        projectId,
        title: "Updated Title",
        color: "#0000ff",
        isCollapsed: true,
        orderIndex: 0,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:01.000Z",
        deletedAt: null,
      });

      const result = yield* repository.getById({ groupId });
      assert.ok(Option.isSome(result));
      const group = result.value;
      assert.equal(group.title, "Updated Title");
      assert.equal(group.color, "#0000ff");
      assert.equal(group.isCollapsed, true);
    }),
  );

  it.effect("deletes a thread group by ID", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadGroupRepository;
      const groupId = ThreadGroupId.makeUnsafe("group-delete");
      const projectId = ProjectId.makeUnsafe("project-delete");

      yield* repository.upsert({
        groupId,
        projectId,
        title: "To Delete",
        color: "blue",
        isCollapsed: false,
        orderIndex: 0,
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        deletedAt: null,
      });

      yield* repository.deleteById({ groupId });

      const result = yield* repository.getById({ groupId });
      assert.ok(Option.isNone(result));
    }),
  );

  it.effect("returns empty array when listing groups for a nonexistent project", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadGroupRepository;
      const projectId = ProjectId.makeUnsafe("project-nonexistent");

      const rows = yield* repository.listByProjectId({ projectId });
      assert.equal(rows.length, 0);
    }),
  );

  it.effect("getById returns None for nonexistent group", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadGroupRepository;
      const groupId = ThreadGroupId.makeUnsafe("group-nonexistent");

      const result = yield* repository.getById({ groupId });
      assert.ok(Option.isNone(result));
    }),
  );
});
