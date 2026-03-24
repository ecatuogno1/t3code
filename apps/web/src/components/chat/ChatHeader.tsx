import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
  type WorkspaceProjectId,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, MoreHorizontalIcon, XIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { OpenInPicker } from "./OpenInPicker";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  showTitle?: boolean;
  activeProjectName: string | undefined;
  ownershipLabel: string;
  moveTargets: ReadonlyArray<{
    workspaceProjectId: WorkspaceProjectId | null;
    label: string;
    active: boolean;
  }>;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onCloseThread?: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleDiff: () => void;
  onMoveThread: (workspaceProjectId: WorkspaceProjectId | null) => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  showTitle = true,
  activeProjectName,
  ownershipLabel,
  moveTargets,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onCloseThread,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleDiff,
  onMoveThread,
}: ChatHeaderProps) {
  const hasSupplementaryControls = Boolean(
    activeProjectScripts || activeProjectName || moveTargets.length > 1,
  );

  return (
    <div
      className="@container/chat-header flex min-w-0 flex-1 items-center gap-2"
      data-chat-header="true"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden @md/chat-header:flex-row @md/chat-header:items-center @md/chat-header:gap-3">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          {showTitle ? (
            <h2
              className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              title={activeThreadTitle}
            >
              {activeThreadTitle}
            </h2>
          ) : (
            <span className="sr-only">{activeThreadTitle}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {activeProjectName && (
            <Badge variant="outline" className="min-w-0 max-w-[16rem] shrink truncate">
              {activeProjectName}
            </Badge>
          )}
          <Badge variant="secondary" className="hidden shrink-0 @sm/chat-header:inline-flex">
            {ownershipLabel}
          </Badge>
          {activeProjectName && !isGitRepo && (
            <Badge
              variant="outline"
              className="hidden shrink-0 text-[10px] text-amber-700 @md/chat-header:inline-flex"
            >
              No Git
            </Badge>
          )}
        </div>
      </div>
      <div
        className="@container/header-actions flex shrink-0 items-center justify-end gap-1.5 @sm/header-actions:gap-2"
        data-chat-header-actions="true"
      >
        {onCloseThread ? (
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close thread window"
            onClick={onCloseThread}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
        <div className="hidden items-center gap-1.5 @md/chat-header:flex">
          {activeProjectScripts && (
            <ProjectScriptsControl
              scripts={activeProjectScripts}
              keybindings={keybindings}
              preferredScriptId={preferredScriptId}
              onRunScript={onRunProjectScript}
              onAddScript={onAddProjectScript}
              onUpdateScript={onUpdateProjectScript}
              onDeleteScript={onDeleteProjectScript}
            />
          )}
          {activeProjectName && (
            <OpenInPicker
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
            />
          )}
          {activeProjectName && (
            <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
          )}
        </div>
        {hasSupplementaryControls ? (
          <Menu>
            <MenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="More thread controls"
                  data-chat-header-overflow-trigger="true"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </button>
              }
            />
            <MenuPopup align="end" className="w-72">
              <div className="flex flex-col gap-2 px-2 py-2">
                {activeProjectScripts ? (
                  <ProjectScriptsControl
                    scripts={activeProjectScripts}
                    keybindings={keybindings}
                    preferredScriptId={preferredScriptId}
                    onRunScript={onRunProjectScript}
                    onAddScript={onAddProjectScript}
                    onUpdateScript={onUpdateProjectScript}
                    onDeleteScript={onDeleteProjectScript}
                  />
                ) : null}
                {activeProjectName ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <OpenInPicker
                      keybindings={keybindings}
                      availableEditors={availableEditors}
                      openInCwd={openInCwd}
                    />
                    <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
                  </div>
                ) : null}
              </div>
              {moveTargets.length > 1 ? (
                <>
                  <MenuSeparator />
                  {moveTargets.map((target) => (
                    <MenuItem
                      key={target.workspaceProjectId ?? "repo"}
                      disabled={target.active}
                      onClick={() => onMoveThread(target.workspaceProjectId)}
                    >
                      Move to {target.label}
                    </MenuItem>
                  ))}
                  <MenuSeparator />
                  <MenuItem disabled>Thread ownership: {ownershipLabel}</MenuItem>
                </>
              ) : (
                <MenuItem disabled>Thread ownership: {ownershipLabel}</MenuItem>
              )}
            </MenuPopup>
          </Menu>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
