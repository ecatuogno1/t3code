import { FileSearchIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceSurface } from "@t3tools/contracts";

import { projectSearchEntriesQueryOptions } from "../../lib/projectReactQuery";
import { resolveWorkspacePreviewCwd } from "../../workspaceFiles";
import { openWorkspaceFileTarget } from "../../workspaceFiles";
import {
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";

interface SearchPanelProps {
  workspace: WorkspaceSurface;
}

export default function SearchPanel(props: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const workspaceCwd = resolveWorkspacePreviewCwd(props.workspace);

  const searchQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: workspaceCwd,
      query,
      enabled: query.trim().length > 0,
      limit: 50,
    }),
  );

  const results = searchQuery.data?.entries ?? [];

  return (
    <>
      <SidebarHeader className="gap-2 border-b border-sidebar-border/60 px-3 py-3">
        <span className="text-sm font-semibold tracking-tight text-foreground">Search</span>
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            placeholder="Search files..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-sidebar-border/60 bg-sidebar-accent/12 py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none"
            autoFocus
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {results.length > 0 ? (
              results.map((entry) => (
                <SidebarMenuItem key={entry.path}>
                  <SidebarMenuButton
                    size="sm"
                    onClick={() =>
                      void openWorkspaceFileTarget({
                        workspaceId: props.workspace.id,
                        targetPath: `${workspaceCwd}/${entry.path}`,
                      })
                    }
                  >
                    <span className="min-w-0 truncate font-mono text-[11px]">{entry.path}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))
            ) : query.trim().length > 0 ? (
              <SidebarMenuItem>
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  {searchQuery.isFetching ? "Searching..." : "No results found."}
                </div>
              </SidebarMenuItem>
            ) : (
              <SidebarMenuItem>
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
                  <FileSearchIcon className="size-8 text-muted-foreground/30" />
                  Type to search files in this workspace.
                </div>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}
