import { describe, expect, it } from "vitest";

import { resolveWorkspacePaneLayout } from "./workspacePaneLayout";

describe("resolveWorkspacePaneLayout", () => {
  it("returns a fully flexible layout for single-pane or stacked views", () => {
    expect(resolveWorkspacePaneLayout({ paneCount: 1, isActive: true, stacked: false })).toEqual({
      flexGrow: 1,
      flexBasis: "0%",
      minWidthPx: 0,
    });
    expect(resolveWorkspacePaneLayout({ paneCount: 3, isActive: true, stacked: true })).toEqual({
      flexGrow: 1,
      flexBasis: "0%",
      minWidthPx: 0,
    });
  });

  it("uses equal sizing for all panes in multi-pane layouts", () => {
    const active = resolveWorkspacePaneLayout({ paneCount: 3, isActive: true, stacked: false });
    const inactive = resolveWorkspacePaneLayout({ paneCount: 3, isActive: false, stacked: false });

    expect(active.flexGrow).toBe(inactive.flexGrow);
    expect(active.minWidthPx).toBe(inactive.minWidthPx);
  });

  it("uses fixed min-widths that enable horizontal scrolling", () => {
    const twoPaneLayout = resolveWorkspacePaneLayout({
      paneCount: 2,
      isActive: false,
      stacked: false,
    });
    const fourPaneLayout = resolveWorkspacePaneLayout({
      paneCount: 4,
      isActive: false,
      stacked: false,
    });

    expect(twoPaneLayout.minWidthPx).toBeGreaterThan(0);
    expect(fourPaneLayout.minWidthPx).toBeGreaterThan(0);
    expect(twoPaneLayout.flexGrow).toBe(0);
    expect(fourPaneLayout.flexGrow).toBe(0);
  });
});
