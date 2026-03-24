export interface WorkspacePaneLayout {
  readonly flexGrow: number;
  readonly flexBasis: string;
  readonly minWidthPx: number;
}

export function resolveWorkspacePaneLayout(input: {
  readonly paneCount: number;
  readonly isActive: boolean;
  readonly stacked: boolean;
}): WorkspacePaneLayout {
  if (input.stacked || input.paneCount <= 1) {
    return {
      flexGrow: 1,
      flexBasis: "0%",
      minWidthPx: 0,
    };
  }

  // All panes get equal flex weight — no resize on focus change.
  // Use a fixed min-width so panes scroll horizontally when they can't fit.
  return {
    flexGrow: 0,
    flexBasis: "auto",
    minWidthPx: input.paneCount <= 2 ? 480 : input.paneCount <= 3 ? 400 : 360,
  };
}
