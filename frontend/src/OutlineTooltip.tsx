import React from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  computePosition,
  hide,
  offset,
  shift,
} from "@floating-ui/dom";

export default function OutlineTooltip({
  id,
  anchor,
  title,
}: {
  id: string;
  anchor?: HTMLButtonElement;
  title?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const tip = ref.current!;
    if (!anchor?.isConnected || !title) {
      // Keep the last text and position until the fade-out finishes.
      tip.removeAttribute("data-open");
      return;
    }
    tip.textContent = title;
    let active = true;
    const stop = autoUpdate(anchor, tip, async () => {
      const { x, y, middlewareData } = await computePosition(anchor, tip, {
        placement: "left",
        strategy: "fixed",
        middleware: [offset(8), shift({ padding: 8, crossAxis: true }), hide()],
      });
      if (!active) return;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.toggleAttribute("data-open", !middlewareData.hide?.referenceHidden);
    });
    return () => {
      active = false;
      stop();
    };
  }, [anchor, title]);

  return createPortal(
    <div ref={ref} id={id} role="tooltip" className="document-tooltip" />,
    document.body,
  );
}
