import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { normalizeBrowserUrlInput, toBrowserAddressDisplayValue } from "../browserUrl";
import { readNativeApi } from "../nativeApi";
import { navigateWorkspaceBrowserTab } from "../workspaceBrowser";
import { Button } from "./ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "./ui/input-group";

interface BrowserPaneProps {
  paneId: string;
  tabId: string;
  title: string | null;
  url: string;
  isActive: boolean;
  isWorkspaceActive?: boolean;
}

function hasDesktopBrowserBridge(): boolean {
  return Boolean(window.desktopBridge?.browser);
}

export default function BrowserPane(props: BrowserPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [addressValue, setAddressValue] = useState(toBrowserAddressDisplayValue(props.url));
  const [navigationError, setNavigationError] = useState<string | null>(null);

  useEffect(() => {
    setAddressValue(toBrowserAddressDisplayValue(props.url));
    setNavigationError(null);
  }, [props.url]);

  const submitNavigation = async () => {
    const nextUrl = normalizeBrowserUrlInput(addressValue);
    if (!nextUrl || nextUrl === props.url) {
      return;
    }
    try {
      await navigateWorkspaceBrowserTab({
        tabId: props.tabId,
        url: nextUrl,
      });
      setNavigationError(null);
    } catch (error) {
      setNavigationError(
        error instanceof Error ? error.message : "Failed to navigate browser tab.",
      );
    }
  };

  const isWorkspaceActive = props.isWorkspaceActive !== false;

  useEffect(() => {
    const api = readNativeApi();
    if (!api || !hasDesktopBrowserBridge()) {
      return;
    }
    void api.browser.setPaneVisibility({
      paneId: props.paneId,
      tabId: props.tabId,
      visible: isWorkspaceActive,
    });
    return () => {
      void api.browser.setPaneVisibility({
        paneId: props.paneId,
        tabId: props.tabId,
        visible: false,
      });
    };
  }, [props.paneId, props.tabId, isWorkspaceActive]);

  useLayoutEffect(() => {
    const api = readNativeApi();
    const host = hostRef.current;
    if (!api || !host || !hasDesktopBrowserBridge()) {
      return;
    }

    let scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;

    const syncBounds = () => {
      if (!isWorkspaceActive) {
        void api.browser.setPaneVisibility({
          paneId: props.paneId,
          tabId: props.tabId,
          visible: false,
        });
        return;
      }
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        return;
      }
      // Native BrowserViews can't be clipped by CSS overflow. Instead of
      // resizing the view (which re-layouts the page content), we only
      // show it when the pane is fully visible within the scroll container.
      // If any part of the pane is scrolled off-screen, hide the view
      // entirely — the user can scroll to reveal it at full size.
      const scrollParent = host.closest<HTMLElement>("[data-workspace-pane-count]");
      if (scrollParent) {
        const containerRect = scrollParent.getBoundingClientRect();
        if (
          rect.left < containerRect.left - 2 ||
          rect.right > containerRect.right + 2
        ) {
          void api.browser.setPaneVisibility({
            paneId: props.paneId,
            tabId: props.tabId,
            visible: false,
          });
          return;
        }
      }
      void api.browser.setPaneBounds({
        paneId: props.paneId,
        tabId: props.tabId,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
      void api.browser.setPaneVisibility({
        paneId: props.paneId,
        tabId: props.tabId,
        visible: true,
      });
    };

    // Hide the native view during horizontal scroll since BrowserViews
    // can't participate in CSS overflow scrolling. Re-show once settled.
    const handleScroll = () => {
      void api.browser.setPaneVisibility({
        paneId: props.paneId,
        tabId: props.tabId,
        visible: false,
      });
      if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
      scrollSettleTimer = setTimeout(() => {
        scrollSettleTimer = null;
        syncBounds();
      }, 150);
    };

    syncBounds();
    const resizeObserver = new ResizeObserver(() => {
      syncBounds();
    });
    resizeObserver.observe(host);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", handleScroll, true);
      if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
    };
  }, [props.paneId, props.tabId, isWorkspaceActive]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api || !hasDesktopBrowserBridge() || !props.isActive) {
      return;
    }
    void api.browser.focus({ tabId: props.tabId }).catch(() => undefined);
  }, [props.isActive, props.tabId]);

  if (!hasDesktopBrowserBridge()) {
    return (
      <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_srgb,var(--background)_92%,var(--color-black))_0%,var(--muted)_100%)] p-6">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card/90 p-5 shadow-lg">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Browser Pane
          </p>
          <p className="mt-2 truncate text-sm font-medium text-foreground">
            {props.title ?? props.url}
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{props.url}</p>
          <Button
            size="sm"
            className="mt-4"
            onClick={() => {
              const api = readNativeApi();
              if (!api) {
                return;
              }
              void api.shell.openExternal(props.url);
            }}
          >
            Open in browser
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/86 px-3 py-2 backdrop-blur-sm">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <InputGroupText>
              <GlobeIcon className="size-3.5" />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            type="url"
            value={addressValue}
            onChange={(event) => setAddressValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              void submitNavigation();
            }}
            placeholder="Enter browser URL"
            aria-label="Browser URL"
          />
        </InputGroup>
        <Button size="sm" variant="outline" onClick={() => void submitNavigation()}>
          Go
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Open in external browser"
          disabled={!props.url}
          onClick={() => {
            const api = readNativeApi();
            if (!api) {
              return;
            }
            void api.shell.openExternal(props.url);
          }}
        >
          <ExternalLinkIcon className="size-4" />
        </Button>
      </div>
      {navigationError ? (
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {navigationError}
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--color-blue-500)_14%,transparent),transparent_42%),linear-gradient(180deg,color-mix(in_srgb,var(--background)_92%,var(--color-black))_0%,var(--background)_100%)]"
      >
        <div className="pointer-events-none absolute inset-0 border border-transparent" />
      </div>
    </div>
  );
}
