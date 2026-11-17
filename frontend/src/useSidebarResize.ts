import React from "react";

export const SIDEBAR_MIN_RATIO = 0.1;
export const SIDEBAR_MAX_RATIO = 0.45;
const MOBILE_BREAKPOINT = 760;
const COMPACT_BREAKPOINT = 1100;
const WIDE_BREAKPOINT = 1600;
const DEFAULT_WIDTH = 280;
const COMPACT_WIDTH = 230;
const WIDE_WIDTH = 320;
const KEYBOARD_STEP = 16;
const PERCENT_SCALE = 100;
const PRIMARY_BUTTON = 0;
const RESIZE_EVENT = "resize";
const SEPARATOR_LABEL = "调整目录宽度";
const SEPARATOR_HINT =
  "拖动调整目录宽度，或使用左右方向键；Home 最窄，End 最宽";
const KEYS = {
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  MIN: "Home",
  MAX: "End",
} as const;

const viewportWidth = () => document.documentElement.clientWidth;
const clampWidth = (width: number, viewport: number) =>
  Math.max(
    viewport * SIDEBAR_MIN_RATIO,
    Math.min(viewport * SIDEBAR_MAX_RATIO, width),
  );
const defaultWidth = (viewport: number) =>
  viewport >= WIDE_BREAKPOINT
    ? WIDE_WIDTH
    : viewport <= COMPACT_BREAKPOINT
      ? COMPACT_WIDTH
      : DEFAULT_WIDTH;

export function useSidebarResize(collapsed: boolean) {
  const [viewport, setViewport] = React.useState(viewportWidth);
  const [ratio, setRatio] = React.useState<number>();
  const [resizing, setResizing] = React.useState(false);
  const drag = React.useRef<
    { id: number; x: number; width: number } | undefined
  >(undefined);
  const width = clampWidth(
    ratio === undefined ? defaultWidth(viewport) : ratio * viewport,
    viewport,
  );
  React.useEffect(() => {
    const resize = () => setViewport(viewportWidth());
    window.addEventListener(RESIZE_EVENT, resize);
    return () => window.removeEventListener(RESIZE_EVENT, resize);
  }, []);
  const stop = () => {
    drag.current = undefined;
    setResizing(false);
  };
  React.useEffect(() => {
    if (collapsed || viewport <= MOBILE_BREAKPOINT) stop();
  }, [collapsed, viewport]);
  const updateWidth = (value: number) => {
    const available = viewportWidth();
    setRatio(clampWidth(value, available) / available);
  };
  const separatorProps: React.HTMLAttributes<HTMLDivElement> = {
    role: "separator",
    tabIndex: 0,
    "aria-label": SEPARATOR_LABEL,
    "aria-orientation": "vertical",
    "aria-valuemin": SIDEBAR_MIN_RATIO * PERCENT_SCALE,
    "aria-valuemax": SIDEBAR_MAX_RATIO * PERCENT_SCALE,
    "aria-valuenow": Math.round((width / viewport) * PERCENT_SCALE),
    title: SEPARATOR_HINT,
    hidden: collapsed || viewport <= MOBILE_BREAKPOINT,
    onPointerDown: (event) => {
      if (event.button !== PRIMARY_BUTTON) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, width };
      setResizing(true);
    },
    onPointerMove: (event) => {
      if (drag.current?.id === event.pointerId)
        updateWidth(drag.current.width + event.clientX - drag.current.x);
    },
    onPointerUp: (event) => {
      if (drag.current?.id !== event.pointerId) return;
      updateWidth(drag.current.width + event.clientX - drag.current.x);
      stop();
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onKeyDown: (event) => {
      let next: number;
      switch (event.key) {
        case KEYS.LEFT:
          next = width - KEYBOARD_STEP;
          break;
        case KEYS.RIGHT:
          next = width + KEYBOARD_STEP;
          break;
        case KEYS.MIN:
          next = viewport * SIDEBAR_MIN_RATIO;
          break;
        case KEYS.MAX:
          next = viewport * SIDEBAR_MAX_RATIO;
          break;
        default:
          return;
      }
      event.preventDefault();
      updateWidth(next);
    },
  };
  return {
    resizing,
    separatorProps,
    style: { "--sidebar-width": `${width}px` } as React.CSSProperties,
  };
}
