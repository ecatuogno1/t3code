import "../index.css";

import type { NativeApi } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const nativeApiState = vi.hoisted(() => ({
  api: undefined as NativeApi | undefined,
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => nativeApiState.api,
  ensureNativeApi: () => {
    if (!nativeApiState.api) {
      throw new Error("Native API not configured for test.");
    }
    return nativeApiState.api;
  },
}));

import { BranchToolbarBranchSelector } from "./BranchToolbarBranchSelector";
import { toastManager } from "./ui/toast";

function createGitApiMock(options?: {
  createBranchError?: Error;
  checkoutError?: Error;
  branches?: Array<{
    name: string;
    current: boolean;
    isDefault: boolean;
    worktreePath: string | null;
    isRemote?: boolean;
    remoteName?: string;
  }>;
}) {
  const branches = options?.branches ?? [
    {
      name: "main",
      current: true,
      isDefault: true,
      worktreePath: null,
    },
    {
      name: "release/1.0",
      current: false,
      isDefault: false,
      worktreePath: null,
    },
  ];

  return {
    git: {
      listBranches: vi.fn(async () => ({
        branches,
        isRepo: true,
        hasOriginRemote: true,
      })),
      status: vi.fn(async () => ({
        branch: "main",
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      })),
      createBranch: options?.createBranchError
        ? vi.fn(async () => {
            throw options.createBranchError;
          })
        : vi.fn(async () => undefined),
      checkout: options?.checkoutError
        ? vi.fn(async () => {
            throw options.checkoutError;
          })
        : vi.fn(async () => undefined),
    },
  } as unknown as NativeApi;
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    { timeout: 5_000, interval: 16 },
  );
  return element!;
}

function queryButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === text,
  ) ?? null) as HTMLButtonElement | null;
}

function queryInputByPlaceholder(placeholder: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
}

async function openBranchMenu(triggerLabel = "main") {
  const trigger = await waitForElement(
    () => queryButtonByText(triggerLabel),
    `Unable to find branch trigger button "${triggerLabel}".`,
  );
  trigger.click();
}

async function mountSelector(options?: {
  effectiveEnvMode?: "local" | "worktree";
  envLocked?: boolean;
  activeWorktreePath?: string | null;
  activeThreadBranch?: string | null;
  api?: NativeApi;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const api = options?.api ?? createGitApiMock();
  nativeApiState.api = api;

  const onSetThreadBranch = vi.fn();
  const onComposerFocusRequest = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <BranchToolbarBranchSelector
        activeProjectCwd="/repo/project"
        activeThreadBranch={options?.activeThreadBranch ?? null}
        activeWorktreePath={options?.activeWorktreePath ?? null}
        branchCwd="/repo/project"
        effectiveEnvMode={options?.effectiveEnvMode ?? "local"}
        envLocked={options?.envLocked ?? false}
        onSetThreadBranch={onSetThreadBranch}
        onComposerFocusRequest={onComposerFocusRequest}
      />
    </QueryClientProvider>,
    { container: host },
  );

  await vi.waitFor(
    () => {
      expect(api.git.listBranches).toHaveBeenCalled();
      expect(api.git.status).toHaveBeenCalled();
    },
    { timeout: 5_000, interval: 16 },
  );

  return {
    api,
    onSetThreadBranch,
    onComposerFocusRequest,
    cleanup: async () => {
      await screen.unmount();
      queryClient.clear();
      host.remove();
    },
  };
}

describe("BranchToolbarBranchSelector add branch dialog", () => {
  afterEach(() => {
    nativeApiState.api = undefined;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows Add branch in normal branch-selection mode and prefills the dialog from search", async () => {
    const mounted = await mountSelector();

    try {
      await openBranchMenu();
      await waitForElement(
        () => queryInputByPlaceholder("Search branches..."),
        "Search input should be visible when the branch menu is open.",
      );
      await page.getByPlaceholder("Search branches...").fill("feature/dialog-prefill");

      const addBranchButton = await waitForElement(
        () => queryButtonByText("Add branch"),
        'Expected "Add branch" action in the branch popup.',
      );
      addBranchButton.click();

      const branchNameInput = await waitForElement(
        () => queryInputByPlaceholder("feature/my-change"),
        "Branch dialog should render its input.",
      );
      expect(branchNameInput.value).toBe("feature/dialog-prefill");
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides Add branch while selecting a new worktree base branch", async () => {
    const mounted = await mountSelector({
      effectiveEnvMode: "worktree",
      envLocked: false,
      activeWorktreePath: null,
      activeThreadBranch: null,
    });

    try {
      await openBranchMenu("From main");
      await vi.waitFor(
        () => {
          expect(queryButtonByText("Add branch")).toBeNull();
        },
        { timeout: 3_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables submit for empty and duplicate branch names", async () => {
    const mounted = await mountSelector();

    try {
      await openBranchMenu();

      const addBranchButton = await waitForElement(
        () => queryButtonByText("Add branch"),
        'Expected "Add branch" action in the branch popup.',
      );
      addBranchButton.click();

      const branchNameInput = await waitForElement(
        () => queryInputByPlaceholder("feature/my-change"),
        "Branch dialog should render its input.",
      );
      const createBranchButton = await waitForElement(
        () => queryButtonByText("Create branch"),
        "Create branch button should be visible.",
      );

      expect(branchNameInput.value).toBe("");
      expect(createBranchButton.disabled).toBe(true);

      await page.getByPlaceholder("feature/my-change").fill("main");
      await vi.waitFor(
        () => {
          expect(createBranchButton.disabled).toBe(true);
          expect(document.body.textContent).toContain("A branch with this name already exists.");
        },
        { timeout: 3_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates, checks out, updates thread state, and restores composer focus on success", async () => {
    const mounted = await mountSelector();

    try {
      await openBranchMenu();

      const addBranchButton = await waitForElement(
        () => queryButtonByText("Add branch"),
        'Expected "Add branch" action in the branch popup.',
      );
      addBranchButton.click();

      await waitForElement(
        () => queryInputByPlaceholder("feature/my-change"),
        "Branch dialog should render its input.",
      );
      await page.getByPlaceholder("feature/my-change").fill("feature/new-ui");

      const createBranchButton = await waitForElement(
        () => queryButtonByText("Create branch"),
        "Create branch button should be visible.",
      );
      createBranchButton.click();

      await vi.waitFor(
        () => {
          expect(mounted.api.git.createBranch).toHaveBeenCalledWith({
            cwd: "/repo/project",
            branch: "feature/new-ui",
          });
          expect(mounted.api.git.checkout).toHaveBeenCalledWith({
            cwd: "/repo/project",
            branch: "feature/new-ui",
          });
          expect(mounted.onSetThreadBranch).toHaveBeenCalledWith("feature/new-ui", null);
          expect(mounted.onComposerFocusRequest).toHaveBeenCalled();
        },
        { timeout: 5_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          expect(queryInputByPlaceholder("feature/my-change")).toBeNull();
          expect(queryInputByPlaceholder("Search branches...")).toBeNull();
        },
        { timeout: 3_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows an error toast and does not update thread metadata when branch creation fails", async () => {
    const toastSpy = vi.spyOn(toastManager, "add");
    const mounted = await mountSelector({
      api: createGitApiMock({
        createBranchError: new Error("create exploded"),
      }),
    });

    try {
      await openBranchMenu();

      const addBranchButton = await waitForElement(
        () => queryButtonByText("Add branch"),
        'Expected "Add branch" action in the branch popup.',
      );
      addBranchButton.click();

      await waitForElement(
        () => queryInputByPlaceholder("feature/my-change"),
        "Branch dialog should render its input.",
      );
      await page.getByPlaceholder("feature/my-change").fill("feature/create-fail");

      const createBranchButton = await waitForElement(
        () => queryButtonByText("Create branch"),
        "Create branch button should be visible.",
      );
      createBranchButton.click();

      await vi.waitFor(
        () => {
          expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "error",
              title: "Failed to create branch.",
              description: "create exploded",
            }),
          );
          expect(mounted.api.git.checkout).not.toHaveBeenCalled();
          expect(mounted.onSetThreadBranch).not.toHaveBeenCalled();
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows an error toast and does not update thread metadata when checkout fails", async () => {
    const toastSpy = vi.spyOn(toastManager, "add");
    const mounted = await mountSelector({
      api: createGitApiMock({
        checkoutError: new Error("checkout exploded"),
      }),
    });

    try {
      await openBranchMenu();

      const addBranchButton = await waitForElement(
        () => queryButtonByText("Add branch"),
        'Expected "Add branch" action in the branch popup.',
      );
      addBranchButton.click();

      await waitForElement(
        () => queryInputByPlaceholder("feature/my-change"),
        "Branch dialog should render its input.",
      );
      await page.getByPlaceholder("feature/my-change").fill("feature/checkout-fail");

      const createBranchButton = await waitForElement(
        () => queryButtonByText("Create branch"),
        "Create branch button should be visible.",
      );
      createBranchButton.click();

      await vi.waitFor(
        () => {
          expect(mounted.api.git.createBranch).toHaveBeenCalledWith({
            cwd: "/repo/project",
            branch: "feature/checkout-fail",
          });
          expect(mounted.api.git.checkout).toHaveBeenCalledWith({
            cwd: "/repo/project",
            branch: "feature/checkout-fail",
          });
          expect(toastSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              type: "error",
              title: "Failed to checkout branch.",
              description: "checkout exploded",
            }),
          );
          expect(mounted.onSetThreadBranch).not.toHaveBeenCalled();
        },
        { timeout: 5_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
