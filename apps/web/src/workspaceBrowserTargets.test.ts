import { describe, expect, it } from "vitest";

import { resolveWorkspaceEnvironmentBrowserTargets } from "./workspaceBrowserTargets";

describe("workspaceBrowserTargets", () => {
  it("always returns local, remote, and production browser targets", () => {
    expect(
      resolveWorkspaceEnvironmentBrowserTargets({
        workspace: {
          id: "workspace:project-1:project-root" as never,
          browserTabs: [],
          detectedDevServerUrls: [],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        environment: "local-dev",
        title: "Local Dev",
        url: null,
        configured: false,
      }),
      expect.objectContaining({
        environment: "remote-dev",
        title: "Remote Dev",
        url: null,
        configured: false,
      }),
      expect.objectContaining({
        environment: "production",
        title: "Production",
        url: null,
        configured: false,
      }),
    ]);
  });

  it("reuses configured environment tabs for the active workspace project", () => {
    const targets = resolveWorkspaceEnvironmentBrowserTargets({
      workspaceProjectId: "workspace-project:web" as never,
      workspace: {
        id: "workspace:project-1:project-root" as never,
        detectedDevServerUrls: ["http://localhost:4173"],
        browserTabs: [
          {
            id: "browser-local",
            title: "Local Dev",
            url: "http://localhost:4173",
            workspaceProjectId: "workspace-project:web" as never,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
          },
          {
            id: "browser-remote",
            title: "Remote Dev",
            url: "https://web-dev.example.com",
            workspaceProjectId: "workspace-project:web" as never,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
          },
          {
            id: "browser-prod",
            title: "Production",
            url: "https://web.example.com",
            workspaceProjectId: "workspace-project:web" as never,
            createdAt: "2026-03-22T00:00:00.000Z",
            updatedAt: "2026-03-22T00:00:00.000Z",
          },
        ],
      },
    });

    expect(targets).toEqual([
      expect.objectContaining({
        environment: "local-dev",
        tabId: "browser-local",
        url: "http://localhost:4173",
        configured: true,
      }),
      expect.objectContaining({
        environment: "remote-dev",
        tabId: "browser-remote",
        url: "https://web-dev.example.com",
        configured: true,
      }),
      expect.objectContaining({
        environment: "production",
        tabId: "browser-prod",
        url: "https://web.example.com",
        configured: true,
      }),
    ]);
  });

  it("prefers configured environment URLs even before a native browser tab exists", () => {
    const targets = resolveWorkspaceEnvironmentBrowserTargets({
      workspaceProjectId: "workspace-project:web" as never,
      configuredUrlsByEnvironment: {
        "remote-dev": "https://web-dev.example.com",
        production: "https://web.example.com",
      },
      workspace: {
        id: "workspace:project-1:project-root" as never,
        detectedDevServerUrls: [],
        browserTabs: [],
      },
    });

    expect(targets).toEqual([
      expect.objectContaining({
        environment: "local-dev",
        url: null,
        configured: false,
      }),
      expect.objectContaining({
        environment: "remote-dev",
        tabId: null,
        url: "https://web-dev.example.com",
        configured: true,
      }),
      expect.objectContaining({
        environment: "production",
        tabId: null,
        url: "https://web.example.com",
        configured: true,
      }),
    ]);
  });
});
