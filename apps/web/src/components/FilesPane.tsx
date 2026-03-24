import { type WorkspaceId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  memo,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  projectListDirectoryQueryOptions,
  projectSearchEntriesQueryOptions,
} from "../lib/projectReactQuery";
import { useStore } from "../store";
import { useTheme } from "../hooks/useTheme";
import {
  decodeWorkspaceFileSelection,
  resolveWorkspacePreviewCwd,
} from "../workspaceFiles";
import { openWorkspaceFileTarget } from "../workspaceFiles";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { cn } from "~/lib/utils";

interface FilesPaneProps {
  workspaceId: WorkspaceId;
  onClose?: (() => void) | undefined;
}

const ROOT_DIRECTORY_PATH = "";

export function ancestorDirectories(relativePath: string): string[] {
  const segments = relativePath.split("/").filter(Boolean);
  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

export const DirectoryTree = memo(function DirectoryTree(props: {
  cwd: string;
  directoryPath: string;
  selectedRelativePath: string | null;
  expandedDirectories: Record<string, boolean>;
  setExpandedDirectories: Dispatch<SetStateAction<Record<string, boolean>>>;
  onSelectFile: (relativePath: string) => void;
  theme: "light" | "dark";
  depth?: number;
}) {
  const query = useQuery(
    projectListDirectoryQueryOptions({
      cwd: props.cwd,
      directoryPath: props.directoryPath,
    }),
  );
  const entries = query.data?.entries ?? [];
  const depth = props.depth ?? 0;

  return (
    <div className="space-y-0.5">
      {entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const isExpanded = props.expandedDirectories[entry.path] ?? false;
        const isSelected = !isDirectory && props.selectedRelativePath === entry.path;
        const leftPadding = 10 + depth * 14;
        if (isDirectory) {
          return (
            <Fragment key={entry.path}>
              <button
                type="button"
                className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent/60"
                style={{ paddingLeft: `${leftPadding}px` }}
                onClick={() => {
                  props.setExpandedDirectories((current) => ({
                    ...current,
                    [entry.path]: !(current[entry.path] ?? false),
                  }));
                }}
              >
                <ChevronRightIcon
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
                {isExpanded ? (
                  <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono text-[11px] text-foreground/85">
                  {entry.path.split("/").at(-1) ?? entry.path}
                </span>
              </button>
              {isExpanded ? (
                <DirectoryTree
                  cwd={props.cwd}
                  directoryPath={entry.path}
                  selectedRelativePath={props.selectedRelativePath}
                  expandedDirectories={props.expandedDirectories}
                  setExpandedDirectories={props.setExpandedDirectories}
                  onSelectFile={props.onSelectFile}
                  theme={props.theme}
                  depth={depth + 1}
                />
              ) : null}
            </Fragment>
          );
        }

        return (
          <button
            key={entry.path}
            type="button"
            className={cn(
              "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent/60",
              isSelected && "bg-accent/70",
            )}
            style={{ paddingLeft: `${leftPadding + 14}px` }}
            onClick={() => props.onSelectFile(entry.path)}
          >
            <VscodeEntryIcon
              pathValue={entry.path}
              kind="file"
              theme={props.theme}
              className="size-3.5 text-muted-foreground/75"
            />
            <span
              className={cn(
                "truncate font-mono text-[11px] text-muted-foreground/85 group-hover:text-foreground/90",
                isSelected && "text-foreground",
              )}
            >
              {entry.path.split("/").at(-1) ?? entry.path}
            </span>
          </button>
        );
      })}
    </div>
  );
});

export default function FilesPane(props: FilesPaneProps) {
  const { resolvedTheme } = useTheme();
  const workspaces = useStore((store) => store.workspaces);
  const workspaceFilesSidebarState = useStore(
    (store) => store.workspaceFilesSidebarById[props.workspaceId] ?? null,
  );
  const workspace = workspaces.find((entry) => entry.id === props.workspaceId) ?? null;
  const selectedFile = decodeWorkspaceFileSelection(workspaceFilesSidebarState?.selectionValue);
  const selectedRelativePath = selectedFile?.relativePath ?? null;
  const workspaceCwd = workspace ? resolveWorkspacePreviewCwd(workspace) : null;
  const [search, setSearch] = useState("");
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({
    [ROOT_DIRECTORY_PATH]: true,
  });

  useEffect(() => {
    if (!selectedRelativePath) {
      return;
    }
    setExpandedDirectories((current) => {
      const next = { ...current };
      next[ROOT_DIRECTORY_PATH] = true;
      for (const directoryPath of ancestorDirectories(selectedRelativePath)) {
        next[directoryPath] = true;
      }
      return next;
    });
  }, [selectedRelativePath]);

  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceCwd,
      query: search,
      enabled: Boolean(workspaceCwd && search.trim().length > 0),
      limit: 40,
    }),
  );

  const handleSelectFile = (relativePath: string) => {
    if (!workspace) {
      return;
    }
    void openWorkspaceFileTarget({
      workspaceId: workspace.id,
      targetPath: `${resolveWorkspacePreviewCwd(workspace)}/${relativePath}`,
    });
  };

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Files are unavailable.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 border-b border-sidebar-border/60 px-3 py-2.5">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            className="w-full rounded-lg border border-sidebar-border/60 bg-sidebar-accent/12 py-1.5 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none"
          />
        </div>
        {props.onClose ? (
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-foreground"
            onClick={props.onClose}
            aria-label="Close files panel"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {search.trim().length > 0 ? (
          <div className="space-y-0.5">
            {(searchQuery.data?.entries ?? [])
              .filter((entry) => entry.kind === "file")
              .map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent/40",
                    selectedRelativePath === entry.path && "bg-sidebar-accent/50",
                  )}
                  onClick={() => handleSelectFile(entry.path)}
                >
                  <VscodeEntryIcon
                    pathValue={entry.path}
                    kind="file"
                    theme={resolvedTheme}
                    className="size-3.5 text-muted-foreground/75"
                  />
                  <span className="truncate font-mono text-[11px] text-sidebar-foreground/85">
                    {entry.path}
                  </span>
                </button>
              ))}
            {searchQuery.data && searchQuery.data.entries.length === 0 ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">No matching files.</div>
            ) : null}
          </div>
        ) : (
          <DirectoryTree
            cwd={workspaceCwd ?? ""}
            directoryPath={ROOT_DIRECTORY_PATH}
            selectedRelativePath={selectedRelativePath}
            expandedDirectories={expandedDirectories}
            setExpandedDirectories={setExpandedDirectories}
            onSelectFile={handleSelectFile}
            theme={resolvedTheme}
          />
        )}
      </div>
    </div>
  );
}
