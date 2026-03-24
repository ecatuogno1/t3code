import { type WorkspaceId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLinkIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { openInPreferredEditor } from "../editorPreferences";
import { projectReadFileQueryOptions } from "../lib/projectReactQuery";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { useTheme } from "../hooks/useTheme";
import {
  decodeWorkspaceFileSelection,
  resolveWorkspaceAbsoluteFilePath,
  resolveWorkspacePreviewCwd,
} from "../workspaceFiles";
import { ancestorDirectories, DirectoryTree } from "./FilesPane";
import { cn } from "~/lib/utils";

const ROOT_DIRECTORY_PATH = "";

interface FileCompositorPaneProps {
  workspaceId: WorkspaceId;
}

export default function FileCompositorPane(props: FileCompositorPaneProps) {
  const { resolvedTheme } = useTheme();
  const workspaces = useStore((store) => store.workspaces);
  const workspaceFilesSidebarState = useStore(
    (store) => store.workspaceFilesSidebarById[props.workspaceId] ?? null,
  );
  const workspace = workspaces.find((entry) => entry.id === props.workspaceId) ?? null;
  const selectedFile = decodeWorkspaceFileSelection(workspaceFilesSidebarState?.selectionValue);
  const selectedRelativePath = selectedFile?.relativePath ?? null;
  const workspaceCwd = workspace ? resolveWorkspacePreviewCwd(workspace) : null;

  const [treeOpen, setTreeOpen] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>({
    [ROOT_DIRECTORY_PATH]: true,
  });
  const previewViewportRef = useRef<HTMLDivElement | null>(null);

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

  const filePreviewQuery = useQuery(
    projectReadFileQueryOptions({
      cwd: workspaceCwd,
      relativePath: selectedRelativePath,
      enabled: Boolean(workspaceCwd && selectedRelativePath),
    }),
  );

  const previewLines = useMemo(() => {
    if (!filePreviewQuery.data?.contents) {
      return [];
    }
    return filePreviewQuery.data.contents.replace(/\r\n/g, "\n").split("\n");
  }, [filePreviewQuery.data?.contents]);

  useEffect(() => {
    if (!previewViewportRef.current || !selectedFile?.line) {
      return;
    }
    const target = previewViewportRef.current.querySelector<HTMLElement>(
      `[data-file-line="${selectedFile.line}"]`,
    );
    target?.scrollIntoView({ block: "center" });
  }, [previewLines, selectedFile?.line]);

  const handleSelectFile = (relativePath: string) => {
    // Update sidebar selection so the tree highlights the file and the preview updates.
    useStore.getState().setWorkspaceFilesSidebarSelection(props.workspaceId, relativePath);
  };

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Files are unavailable.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Collapsible file tree — always mounted, width toggled */}
      <div
        className={cn(
          "flex flex-none flex-col border-r border-border/50 transition-[width] duration-150",
          treeOpen ? "w-56" : "w-9",
        )}
      >
        <div className="flex items-center justify-between border-b border-border/50 px-1.5 py-1.5">
          {treeOpen ? (
            <>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70 pl-0.5">
                Explorer
              </span>
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                onClick={() => setTreeOpen(false)}
                aria-label="Collapse file tree"
              >
                <PanelLeftCloseIcon className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted/30 hover:text-muted-foreground"
              onClick={() => setTreeOpen(true)}
              aria-label="Expand file tree"
            >
              <PanelLeftOpenIcon className="size-3.5" />
            </button>
          )}
        </div>
        {treeOpen ? (
          <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
            <DirectoryTree
              cwd={workspaceCwd ?? ""}
              directoryPath={ROOT_DIRECTORY_PATH}
              selectedRelativePath={selectedRelativePath}
              expandedDirectories={expandedDirectories}
              setExpandedDirectories={setExpandedDirectories}
              onSelectFile={handleSelectFile}
              theme={resolvedTheme}
            />
          </div>
        ) : null}
      </div>

      {/* File viewer */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {selectedRelativePath ? (
          <>
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
                {selectedRelativePath}
              </p>
              {selectedFile?.line ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  Ln {selectedFile.line}
                  {selectedFile.column ? `, Col ${selectedFile.column}` : ""}
                </span>
              ) : null}
              <button
                type="button"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                onClick={() => {
                  const api = readNativeApi();
                  if (!api || !selectedRelativePath) return;
                  void openInPreferredEditor(
                    api,
                    resolveWorkspaceAbsoluteFilePath({ workspace, relativePath: selectedRelativePath }),
                  );
                }}
                aria-label="Open in editor"
                title="Open in editor"
              >
                <ExternalLinkIcon className="size-3" />
              </button>
            </div>
            <div ref={previewViewportRef} className="min-h-0 flex-1 overflow-auto">
              {filePreviewQuery.isLoading ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : filePreviewQuery.data?.isBinary ? (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                  Binary file ({filePreviewQuery.data.sizeBytes.toLocaleString()} bytes)
                </div>
              ) : (
                <div className="min-w-max font-mono text-[12px] leading-5">
                  {previewLines.map((line, index) => {
                    const lineNumber = index + 1;
                    const isHighlighted = selectedFile?.line === lineNumber;
                    return (
                      <div
                        key={lineNumber}
                        data-file-line={lineNumber}
                        className={cn(
                          "grid grid-cols-[3.5rem_1fr]",
                          isHighlighted && "bg-accent/50",
                        )}
                      >
                        <div className="select-none border-r border-border/30 px-2 py-px text-right text-[11px] text-muted-foreground/50">
                          {lineNumber}
                        </div>
                        <pre className="overflow-visible px-3 py-px whitespace-pre text-foreground/90">
                          {line.length > 0 ? line : " "}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            Select a file to view
          </div>
        )}
      </div>
    </div>
  );
}
