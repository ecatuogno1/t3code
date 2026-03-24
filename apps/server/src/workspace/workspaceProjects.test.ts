import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectWorkspaceProjects } from "./workspaceProjects";

describe("detectWorkspaceProjects", () => {
  it("detects monorepo apps and packages from pnpm workspace globs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "t3-workspace-projects-"));
    try {
      fs.writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "repo-root", private: true }, null, 2),
      );
      fs.writeFileSync(
        path.join(root, "pnpm-workspace.yaml"),
        ["packages:", '  - "apps/*"', '  - "packages/*"'].join("\n"),
      );
      fs.mkdirSync(path.join(root, "apps", "web"), { recursive: true });
      fs.mkdirSync(path.join(root, "apps", "ios"), { recursive: true });
      fs.mkdirSync(path.join(root, "packages", "types"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "apps", "web", "package.json"),
        JSON.stringify({ name: "@repo/web" }, null, 2),
      );
      fs.writeFileSync(
        path.join(root, "apps", "ios", "package.json"),
        JSON.stringify({ name: "@repo/ios" }, null, 2),
      );
      fs.writeFileSync(
        path.join(root, "packages", "types", "package.json"),
        JSON.stringify({ name: "@repo/types" }, null, 2),
      );

      const projects = await detectWorkspaceProjects({
        workspaceId: "workspace:test" as any,
        workspaceRoot: root,
        worktreePath: null,
        updatedAt: "2026-03-21T00:00:00.000Z",
      });

      expect(
        projects.map((project) => ({
          title: project.title,
          path: project.path,
          kind: project.kind,
        })),
      ).toEqual([
        { title: path.basename(root), path: "", kind: "root" },
        { title: "@repo/ios", path: "apps/ios", kind: "app" },
        { title: "@repo/web", path: "apps/web", kind: "app" },
        { title: "@repo/types", path: "packages/types", kind: "package" },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
