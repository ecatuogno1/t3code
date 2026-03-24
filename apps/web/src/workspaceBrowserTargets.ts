import type {
  WorkspaceBrowserTab,
  WorkspaceId,
  WorkspaceProjectId,
  WorkspaceSurface,
} from "@t3tools/contracts";

export type WorkspaceBrowserEnvironment = "local-dev" | "remote-dev" | "production";

export interface WorkspaceEnvironmentBrowserTarget {
  key: string;
  kind: "environment";
  environment: WorkspaceBrowserEnvironment;
  title: string;
  url: string | null;
  tabId: string | null;
  configured: boolean;
}

export function buildWorkspaceEnvironmentTargetKey(input: {
  workspaceId: WorkspaceId;
  workspaceProjectId?: WorkspaceProjectId | null | undefined;
  environment: WorkspaceBrowserEnvironment;
}): string {
  return `${input.workspaceId}:${input.workspaceProjectId ?? "root"}:${input.environment}`;
}

function normalizeWorkspaceProjectId(
  workspaceProjectId: WorkspaceProjectId | null | undefined,
): WorkspaceProjectId | null {
  return workspaceProjectId ?? null;
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i.test(url);
}

function matchesEnvironmentTarget(input: {
  tab: WorkspaceBrowserTab;
  environment: WorkspaceBrowserEnvironment;
  detectedDevServerUrls: ReadonlySet<string>;
}): boolean {
  const normalizedTitle = (input.tab.title ?? "").trim().toLowerCase();
  switch (input.environment) {
    case "local-dev":
      return (
        normalizedTitle === "local dev" ||
        normalizedTitle === "localhost dev" ||
        input.detectedDevServerUrls.has(input.tab.url) ||
        isLocalUrl(input.tab.url)
      );
    case "remote-dev":
      return normalizedTitle === "remote dev" || normalizedTitle === "remotehost dev";
    case "production":
      return normalizedTitle === "production" || normalizedTitle === "prod";
  }
}

function findEnvironmentBrowserTab(input: {
  browserTabs: ReadonlyArray<WorkspaceBrowserTab>;
  workspaceProjectId: WorkspaceProjectId | null;
  environment: WorkspaceBrowserEnvironment;
  detectedDevServerUrls: ReadonlySet<string>;
}): WorkspaceBrowserTab | null {
  return (
    input.browserTabs.find(
      (tab) =>
        normalizeWorkspaceProjectId(tab.workspaceProjectId) === input.workspaceProjectId &&
        matchesEnvironmentTarget({
          tab,
          environment: input.environment,
          detectedDevServerUrls: input.detectedDevServerUrls,
        }),
    ) ?? null
  );
}

export function resolveWorkspaceEnvironmentBrowserTargets(input: {
  workspace: Pick<WorkspaceSurface, "id" | "browserTabs" | "detectedDevServerUrls">;
  workspaceProjectId?: WorkspaceProjectId | null;
  configuredUrlsByEnvironment?: Partial<
    Record<WorkspaceBrowserEnvironment, string | null | undefined>
  >;
}): WorkspaceEnvironmentBrowserTarget[] {
  const workspaceProjectId = normalizeWorkspaceProjectId(input.workspaceProjectId);
  const detectedDevServerUrls = new Set(input.workspace.detectedDevServerUrls);
  const localTab = findEnvironmentBrowserTab({
    browserTabs: input.workspace.browserTabs,
    workspaceProjectId,
    environment: "local-dev",
    detectedDevServerUrls,
  });
  const remoteTab = findEnvironmentBrowserTab({
    browserTabs: input.workspace.browserTabs,
    workspaceProjectId,
    environment: "remote-dev",
    detectedDevServerUrls,
  });
  const productionTab = findEnvironmentBrowserTab({
    browserTabs: input.workspace.browserTabs,
    workspaceProjectId,
    environment: "production",
    detectedDevServerUrls,
  });

  const firstDetectedDevUrl = input.workspace.detectedDevServerUrls[0] ?? null;
  const configuredLocalUrl = input.configuredUrlsByEnvironment?.["local-dev"] ?? null;
  const configuredRemoteUrl = input.configuredUrlsByEnvironment?.["remote-dev"] ?? null;
  const configuredProductionUrl = input.configuredUrlsByEnvironment?.production ?? null;

  return [
    {
      key: buildWorkspaceEnvironmentTargetKey({
        workspaceId: input.workspace.id,
        workspaceProjectId,
        environment: "local-dev",
      }),
      kind: "environment",
      environment: "local-dev",
      title: "Local Dev",
      url: configuredLocalUrl ?? localTab?.url ?? firstDetectedDevUrl ?? null,
      tabId: localTab?.id ?? null,
      configured: Boolean(configuredLocalUrl ?? localTab ?? firstDetectedDevUrl),
    },
    {
      key: buildWorkspaceEnvironmentTargetKey({
        workspaceId: input.workspace.id,
        workspaceProjectId,
        environment: "remote-dev",
      }),
      kind: "environment",
      environment: "remote-dev",
      title: "Remote Dev",
      url: configuredRemoteUrl ?? remoteTab?.url ?? null,
      tabId: remoteTab?.id ?? null,
      configured: Boolean(configuredRemoteUrl ?? remoteTab),
    },
    {
      key: buildWorkspaceEnvironmentTargetKey({
        workspaceId: input.workspace.id,
        workspaceProjectId,
        environment: "production",
      }),
      kind: "environment",
      environment: "production",
      title: "Production",
      url: configuredProductionUrl ?? productionTab?.url ?? null,
      tabId: productionTab?.id ?? null,
      configured: Boolean(configuredProductionUrl ?? productionTab),
    },
  ];
}
