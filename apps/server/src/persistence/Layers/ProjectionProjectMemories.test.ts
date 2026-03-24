import { ProjectId, ProjectMemoryId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";

import { ProjectionProjectMemoryRepository } from "../Services/ProjectionProjectMemories.ts";
import { ProjectionProjectMemoryRepositoryLive } from "./ProjectionProjectMemories.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionProjectMemoryRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionProjectMemoryRepository", (it) => {
  it.effect("upserts a new project memory and retrieves it by ID", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const memoryId = ProjectMemoryId.makeUnsafe("mem-upsert-get");
      const projectId = ProjectId.makeUnsafe("proj-upsert-get");

      yield* repository.upsert({
        memoryId,
        projectId,
        title: "Setup Guide",
        content: "How to set up the project",
        kind: "note",
        tags: ["setup", "guide"],
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-01T10:00:00.000Z",
        deletedAt: null,
      });

      const result = yield* repository.getById({ memoryId });
      assert.isTrue(Option.isSome(result));
      const memory = Option.getOrThrow(result);
      assert.equal(memory.memoryId, memoryId);
      assert.equal(memory.projectId, projectId);
      assert.equal(memory.title, "Setup Guide");
      assert.equal(memory.content, "How to set up the project");
      assert.equal(memory.kind, "note");
      assert.deepEqual(memory.tags, ["setup", "guide"]);
      assert.equal(memory.createdAt, "2026-03-01T10:00:00.000Z");
      assert.equal(memory.updatedAt, "2026-03-01T10:00:00.000Z");
      assert.isNull(memory.deletedAt);
    }),
  );

  it.effect("lists project memories for a project", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const projectId = ProjectId.makeUnsafe("proj-list");

      yield* repository.upsert({
        memoryId: ProjectMemoryId.makeUnsafe("mem-list-1"),
        projectId,
        title: "First Memory",
        content: "First content",
        kind: "note",
        tags: [],
        createdAt: "2026-03-01T11:00:00.000Z",
        updatedAt: "2026-03-01T11:00:00.000Z",
        deletedAt: null,
      });

      yield* repository.upsert({
        memoryId: ProjectMemoryId.makeUnsafe("mem-list-2"),
        projectId,
        title: "Second Memory",
        content: "Second content",
        kind: "context",
        tags: ["important"],
        createdAt: "2026-03-01T12:00:00.000Z",
        updatedAt: "2026-03-01T12:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* repository.listByProjectId({ projectId });
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.title, "First Memory");
      assert.equal(rows[1]?.title, "Second Memory");
    }),
  );

  it.effect("updates an existing project memory (title, content, tags)", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const memoryId = ProjectMemoryId.makeUnsafe("mem-update");
      const projectId = ProjectId.makeUnsafe("proj-update");

      yield* repository.upsert({
        memoryId,
        projectId,
        title: "Original Title",
        content: "Original content",
        kind: "note",
        tags: ["old"],
        createdAt: "2026-03-01T13:00:00.000Z",
        updatedAt: "2026-03-01T13:00:00.000Z",
        deletedAt: null,
      });

      yield* repository.upsert({
        memoryId,
        projectId,
        title: "Updated Title",
        content: "Updated content",
        kind: "note",
        tags: ["new", "updated"],
        createdAt: "2026-03-01T13:00:00.000Z",
        updatedAt: "2026-03-01T13:30:00.000Z",
        deletedAt: null,
      });

      const result = yield* repository.getById({ memoryId });
      const memory = Option.getOrThrow(result);
      assert.equal(memory.title, "Updated Title");
      assert.equal(memory.content, "Updated content");
      assert.deepEqual(memory.tags, ["new", "updated"]);
      assert.equal(memory.updatedAt, "2026-03-01T13:30:00.000Z");
    }),
  );

  it.effect("handles JSON serialization of tags array correctly", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const memoryId = ProjectMemoryId.makeUnsafe("mem-tags-json");
      const projectId = ProjectId.makeUnsafe("proj-tags-json");
      const tags = ["typescript", "effect", "testing"];

      yield* repository.upsert({
        memoryId,
        projectId,
        title: "Tags Test",
        content: "Testing tags serialization",
        kind: "reference",
        tags,
        createdAt: "2026-03-01T14:00:00.000Z",
        updatedAt: "2026-03-01T14:00:00.000Z",
        deletedAt: null,
      });

      const result = yield* repository.getById({ memoryId });
      const memory = Option.getOrThrow(result);
      assert.deepEqual(memory.tags, tags);
      assert.isArray(memory.tags);
      assert.equal(memory.tags.length, 3);
    }),
  );

  it.effect("deletes a project memory by ID", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const memoryId = ProjectMemoryId.makeUnsafe("mem-delete");
      const projectId = ProjectId.makeUnsafe("proj-delete");

      yield* repository.upsert({
        memoryId,
        projectId,
        title: "To Be Deleted",
        content: "This will be deleted",
        kind: "note",
        tags: [],
        createdAt: "2026-03-01T15:00:00.000Z",
        updatedAt: "2026-03-01T15:00:00.000Z",
        deletedAt: null,
      });

      const beforeDelete = yield* repository.getById({ memoryId });
      assert.isTrue(Option.isSome(beforeDelete));

      yield* repository.deleteById({ memoryId });

      const afterDelete = yield* repository.getById({ memoryId });
      assert.isTrue(Option.isNone(afterDelete));
    }),
  );

  it.effect("returns empty array when listing memories for a nonexistent project", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const projectId = ProjectId.makeUnsafe("proj-nonexistent");

      const rows = yield* repository.listByProjectId({ projectId });
      assert.deepEqual(rows, []);
    }),
  );

  it.effect("getById returns None for nonexistent memory", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionProjectMemoryRepository;
      const memoryId = ProjectMemoryId.makeUnsafe("mem-nonexistent");

      const result = yield* repository.getById({ memoryId });
      assert.isTrue(Option.isNone(result));
    }),
  );
});
