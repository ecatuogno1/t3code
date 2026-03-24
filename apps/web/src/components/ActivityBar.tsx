import {
  ActivityIcon,
  ArrowDownIcon,
  FileSearchIcon,
  FolderTreeIcon,
  GitBranchIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export type ActivityPanelId = "files" | "source-control" | "activity" | "search";

interface ActivityBarProps {
  activePanel: ActivityPanelId | null;
  onSelectPanel: (panelId: ActivityPanelId) => void;
  badges?: Partial<Record<ActivityPanelId, number>>;
  onImportThreads?: () => void;
  isSettingsActive?: boolean;
}

const PANEL_ITEMS: Array<{
  id: ActivityPanelId;
  icon: ReactNode;
  label: string;
}> = [
  { id: "files", icon: <FolderTreeIcon className="size-5" />, label: "Files" },
  { id: "search", icon: <SearchIcon className="size-5" />, label: "Search" },
  {
    id: "source-control",
    icon: <GitBranchIcon className="size-5" />,
    label: "Source Control",
  },
  {
    id: "activity",
    icon: <ActivityIcon className="size-5" />,
    label: "Activity",
  },
];

export default function ActivityBar(props: ActivityBarProps) {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-y-0 left-0 z-20 flex w-12 flex-col items-center justify-between border-r border-border/50 bg-card/80">
      <div className="flex flex-col items-center gap-0.5 pt-2">
        {PANEL_ITEMS.map((item) => {
          const isActive = props.activePanel === item.id;
          const badge = props.badges?.[item.id];
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              title={item.label}
              className={cn(
                "relative flex size-10 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "text-foreground before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-r before:bg-foreground"
                  : "text-muted-foreground/60 hover:text-muted-foreground",
              )}
              onClick={() => props.onSelectPanel(item.id)}
            >
              {item.icon}
              {badge != null && badge > 0 ? (
                <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-sky-500 text-[9px] font-bold text-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-0.5 pb-2">
        {props.onImportThreads ? (
          <button
            type="button"
            aria-label="Import Threads"
            title="Import Threads"
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            onClick={props.onImportThreads}
          >
            <ArrowDownIcon className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className={cn(
            "relative flex size-10 items-center justify-center rounded-lg transition-colors",
            props.isSettingsActive
              ? "text-foreground before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-r before:bg-foreground"
              : "text-muted-foreground/60 hover:text-muted-foreground",
          )}
          onClick={() => void navigate({ to: "/settings" })}
        >
          <SettingsIcon className="size-5" />
        </button>
      </div>
    </div>
  );
}
