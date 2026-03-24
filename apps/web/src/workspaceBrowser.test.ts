import { describe, expect, it } from "vitest";

import { resolveStoredWorkspaceBrowserTabTitle } from "./workspaceBrowser";

describe("workspaceBrowser", () => {
  it("preserves requested environment titles over snapshot titles", () => {
    expect(
      resolveStoredWorkspaceBrowserTabTitle({
        requestedTitle: "Remote Dev",
        existingTitle: null,
        snapshotTitle: "Example App",
      }),
    ).toBe("Remote Dev");
  });

  it("preserves existing environment titles while navigating", () => {
    expect(
      resolveStoredWorkspaceBrowserTabTitle({
        existingTitle: "Production",
        snapshotTitle: "Marketing Site",
      }),
    ).toBe("Production");
  });

  it("falls back to snapshot titles for regular browser tabs", () => {
    expect(
      resolveStoredWorkspaceBrowserTabTitle({
        requestedTitle: null,
        existingTitle: null,
        snapshotTitle: "Docs",
      }),
    ).toBe("Docs");
  });
});
