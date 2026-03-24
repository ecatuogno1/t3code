import { useCallback, useRef } from "react";
import { cn } from "../lib/utils";

interface PaneResizeHandleProps {
  /** Called with the horizontal pixel delta. Only affects the left pane's width. */
  onResize: (deltaX: number) => void;
}

export default function PaneResizeHandle(props: PaneResizeHandleProps) {
  const startXRef = useRef(0);
  const activeRef = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      startXRef.current = event.clientX;
      activeRef.current = true;
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      target.dataset.resizing = "true";
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!activeRef.current) return;
      const delta = event.clientX - startXRef.current;
      if (Math.abs(delta) > 1) {
        props.onResize(delta);
        startXRef.current = event.clientX;
      }
    },
    [props],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      activeRef.current = false;
      const target = event.currentTarget as HTMLElement;
      target.releasePointerCapture(event.pointerId);
      delete target.dataset.resizing;
    },
    [],
  );

  return (
    <div
      className={cn(
        "group/resize relative z-10 flex w-0 flex-none cursor-col-resize items-center justify-center",
        "before:absolute before:inset-y-0 before:-left-0.5 before:-right-0.5 before:z-10",
        "after:absolute after:inset-y-4 after:w-[2px] after:rounded-full after:bg-transparent after:transition-colors",
        "hover:after:bg-ring/40 data-[resizing]:after:bg-ring/60",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
