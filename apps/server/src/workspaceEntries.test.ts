import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, assert, describe, it, vi } from "vitest";

import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  resolveWorkspaceFileTestTarget,
  searchWorkspaceEntries,
} from "./workspaceEntries";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(cwd: string, relativePath: string, contents = ""): void {
  const absolutePath = path.join(cwd, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}

describe("searchWorkspaceEntries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns files and directories relative to cwd", async () => {
    const cwd = makeTempDir("t3code-workspace-entries-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/index.ts");
    writeFile(cwd, "README.md");
    writeFile(cwd, ".git/HEAD");
    writeFile(cwd, "node_modules/pkg/index.js");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/components");
    assert.include(paths, "src/components/Composer.tsx");
    assert.include(paths, "README.md");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".git")));
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith("node_modules")));
    assert.isFalse(result.truncated);
  });

  it("filters and ranks entries by query", async () => {
    const cwd = makeTempDir("t3code-workspace-query-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/components/composePrompt.ts");
    writeFile(cwd, "docs/composition.md");

    const result = await searchWorkspaceEntries({ cwd, query: "compo", limit: 5 });

    assert.isAbove(result.entries.length, 0);
    assert.isTrue(result.entries.some((entry) => entry.path === "src/components"));
    assert.isTrue(result.entries.every((entry) => entry.path.toLowerCase().includes("compo")));
  });

  it("supports fuzzy subsequence queries for composer path search", async () => {
    const cwd = makeTempDir("t3code-workspace-fuzzy-query-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/components/composePrompt.ts");
    writeFile(cwd, "docs/composition.md");

    const result = await searchWorkspaceEntries({ cwd, query: "cmp", limit: 10 });
    const paths = result.entries.map((entry) => entry.path);

    assert.isAbove(result.entries.length, 0);
    assert.include(paths, "src/components");
    assert.include(paths, "src/components/Composer.tsx");
  });

  it("tracks truncation without sorting every fuzzy match", async () => {
    const cwd = makeTempDir("t3code-workspace-fuzzy-limit-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/components/composePrompt.ts");
    writeFile(cwd, "docs/composition.md");

    const result = await searchWorkspaceEntries({ cwd, query: "cmp", limit: 1 });

    assert.lengthOf(result.entries, 1);
    assert.isTrue(result.truncated);
  });

  it("excludes gitignored paths for git repositories", async () => {
    const cwd = makeTempDir("t3code-workspace-gitignore-");
    runGit(cwd, ["init"]);
    writeFile(cwd, ".gitignore", ".convex/\nconvex/\nignored.txt\n");
    writeFile(cwd, "src/keep.ts", "export {};");
    writeFile(cwd, "ignored.txt", "ignore me");
    writeFile(cwd, ".convex/local-storage/data.json", "{}");
    writeFile(cwd, "convex/UOoS-l/convex_local_storage/modules/data.json", "{}");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/keep.ts");
    assert.notInclude(paths, "ignored.txt");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".convex/")));
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith("convex/")));
  });

  it("excludes tracked paths that match ignore rules", async () => {
    const cwd = makeTempDir("t3code-workspace-tracked-gitignore-");
    runGit(cwd, ["init"]);
    writeFile(cwd, ".convex/local-storage/data.json", "{}");
    writeFile(cwd, "src/keep.ts", "export {};");
    runGit(cwd, ["add", ".convex/local-storage/data.json", "src/keep.ts"]);
    writeFile(cwd, ".gitignore", ".convex/\n");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/keep.ts");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".convex/")));
  });

  it("excludes .convex in non-git workspaces", async () => {
    const cwd = makeTempDir("t3code-workspace-non-git-convex-");
    writeFile(cwd, ".convex/local-storage/data.json", "{}");
    writeFile(cwd, "src/keep.ts", "export {};");

    const result = await searchWorkspaceEntries({ cwd, query: "", limit: 100 });
    const paths = result.entries.map((entry) => entry.path);

    assert.include(paths, "src");
    assert.include(paths, "src/keep.ts");
    assert.isFalse(paths.some((entryPath) => entryPath.startsWith(".convex/")));
  });

  it("deduplicates concurrent index builds for the same cwd", async () => {
    const cwd = makeTempDir("t3code-workspace-concurrent-build-");
    writeFile(cwd, "src/components/Composer.tsx");

    let rootReadCount = 0;
    const originalReaddir = fsPromises.readdir.bind(fsPromises);
    vi.spyOn(fsPromises, "readdir").mockImplementation((async (
      ...args: Parameters<typeof fsPromises.readdir>
    ) => {
      if (args[0] === cwd) {
        rootReadCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return originalReaddir(...args);
    }) as typeof fsPromises.readdir);

    await Promise.all([
      searchWorkspaceEntries({ cwd, query: "", limit: 100 }),
      searchWorkspaceEntries({ cwd, query: "comp", limit: 100 }),
      searchWorkspaceEntries({ cwd, query: "src", limit: 100 }),
    ]);

    assert.equal(rootReadCount, 1);
  });

  it("limits concurrent directory reads while walking the filesystem", async () => {
    const cwd = makeTempDir("t3code-workspace-read-concurrency-");
    for (let index = 0; index < 80; index += 1) {
      writeFile(cwd, `group-${index}/entry-${index}.ts`, "export {};");
    }

    let activeReads = 0;
    let peakReads = 0;
    const originalReaddir = fsPromises.readdir.bind(fsPromises);
    vi.spyOn(fsPromises, "readdir").mockImplementation((async (
      ...args: Parameters<typeof fsPromises.readdir>
    ) => {
      const target = args[0];
      if (typeof target === "string" && target.startsWith(cwd)) {
        activeReads += 1;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 4));
        try {
          return await originalReaddir(...args);
        } finally {
          activeReads -= 1;
        }
      }
      return originalReaddir(...args);
    }) as typeof fsPromises.readdir);

    await searchWorkspaceEntries({ cwd, query: "", limit: 200 });

    assert.isAtMost(peakReads, 32);
  });

  it("lists a directory's direct children with directories first", async () => {
    const cwd = makeTempDir("t3code-workspace-list-directory-");
    writeFile(cwd, "src/components/Composer.tsx");
    writeFile(cwd, "src/index.ts");
    writeFile(cwd, "README.md");

    const result = await listWorkspaceDirectory({ cwd, directoryPath: "src" });

    assert.deepEqual(result, {
      directoryPath: "src",
      entries: [
        { path: "src/components", kind: "directory", parentPath: "src" },
        { path: "src/index.ts", kind: "file", parentPath: "src" },
      ],
    });
  });

  it("reads text file previews and marks oversized previews as truncated", async () => {
    const cwd = makeTempDir("t3code-workspace-read-file-");
    writeFile(cwd, "src/app.ts", `export const value = 1;\n${"a".repeat(300_000)}`);

    const result = await readWorkspaceFile({ cwd, relativePath: "src/app.ts" });

    assert.strictEqual(result.relativePath, "src/app.ts");
    assert.strictEqual(result.isBinary, false);
    assert.strictEqual(result.truncated, true);
    assert.isNotNull(result.contents);
    assert.isAbove(result.sizeBytes, result.previewMaxBytes);
  });

  it("returns binary metadata for undecodable files", async () => {
    const cwd = makeTempDir("t3code-workspace-binary-file-");
    const binaryPath = path.join(cwd, "assets", "logo.png");
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, Buffer.from([0, 159, 146, 150]));

    const result = await readWorkspaceFile({ cwd, relativePath: "assets/logo.png" });

    assert.deepInclude(result, {
      relativePath: "assets/logo.png",
      contents: null,
      isBinary: true,
      truncated: false,
    });
  });

  it("resolves vitest file targets from matching test files", async () => {
    const cwd = makeTempDir("t3code-workspace-vitest-target-");
    writeFile(
      cwd,
      "package.json",
      JSON.stringify({
        devDependencies: { vitest: "^3.0.0" },
      }),
    );
    writeFile(cwd, "src/math.ts", "export const add = (a, b) => a + b;\n");
    writeFile(cwd, "src/math.test.ts", "import { describe, it } from 'vitest';\n");

    const result = await resolveWorkspaceFileTestTarget({
      cwd,
      relativePath: "src/math.ts",
    });

    assert.deepInclude(result, {
      kind: "command",
      cwd,
      relatedTestPath: "src/math.test.ts",
    });
    if (result.kind === "command") {
      assert.include(result.command, "vitest run");
      assert.strictEqual(result.env.T3CODE_RELATIVE_PATH, "src/math.ts");
      assert.strictEqual(result.env.T3CODE_TEST_RELATIVE_PATH, "src/math.test.ts");
    }
  });

  it("resolves python unittest targets from matching test files", async () => {
    const cwd = makeTempDir("t3code-workspace-python-target-");
    writeFile(cwd, "tests/test_math.py", "import unittest\n");
    writeFile(cwd, "math.py", "def add(a, b):\n    return a + b\n");

    const result = await resolveWorkspaceFileTestTarget({
      cwd,
      relativePath: "math.py",
    });

    assert.deepInclude(result, {
      kind: "command",
      cwd,
      relatedTestPath: "tests/test_math.py",
    });
    if (result.kind === "command") {
      assert.include(result.command, "python -m unittest tests.test_math");
    }
  });
});
