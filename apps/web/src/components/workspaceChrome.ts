import type { WorkspacePaneTier } from "@t3tools/contracts";
import { cn } from "~/lib/utils";

export function workspaceStripClassName(options?: { muted?: boolean }) {
  return cn(
    "flex min-w-0 items-center gap-2 border-t px-3 py-2",
    options?.muted
      ? "border-border/45 bg-background/72"
      : "border-border/55 bg-background/88 backdrop-blur-sm",
  );
}

export const workspaceStripScrollerClassName =
  "flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const workspaceStripLabelClassName =
  "hidden shrink-0 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/72 lg:inline-flex";

export function workspaceStripTabClassName(input: {
  active: boolean;
  dense?: boolean;
  quiet?: boolean;
}) {
  return cn(
    "inline-flex shrink-0 items-center rounded-xl border transition-[border-color,background-color,color,box-shadow] duration-150",
    input.dense ? "gap-1.5 px-2.5 py-1.5 text-xs" : "gap-2 px-3 py-2 text-sm",
    input.active
      ? "border-border/70 bg-card text-foreground shadow-[0_1px_0_rgba(255,255,255,0.45),0_10px_24px_-20px_rgba(15,23,42,0.45)]"
      : input.quiet
        ? "border-transparent bg-transparent text-muted-foreground hover:bg-muted/34 hover:text-foreground"
        : "border-transparent bg-muted/[0.38] text-muted-foreground hover:bg-muted/[0.58] hover:text-foreground",
  );
}

export const workspaceStripMetaClassName =
  "text-[9px] uppercase tracking-[0.18em] text-muted-foreground/72";

export function workspaceStripCountClassName(active: boolean) {
  return cn("shrink-0 text-[11px]", active ? "text-foreground/72" : "text-muted-foreground");
}

export const workspaceStripAddButtonClassName =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-transparent bg-muted/[0.4] text-muted-foreground transition-colors hover:bg-muted/[0.62] hover:text-foreground";

export function workspaceStripTierBadgeClassName(tier: WorkspacePaneTier): string {
  switch (tier) {
    case "workspace":
      return "text-sky-600/70 dark:text-sky-400/70";
    case "project":
      return "text-muted-foreground/60";
    case "ephemeral":
      return "text-muted-foreground/40";
  }
}
