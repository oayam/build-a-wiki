import React from "react";
import { Alert } from "antd";
import type { AlertProps } from "antd";

export const motionDuration = 200;
const preference = "(prefers-reduced-motion: reduce)";
function subscribe(listener: () => void) {
  const media = window.matchMedia(preference);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function useReducedMotion() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(preference).matches,
    () => true,
  );
}

// Keep exiting content mounted, but immediately remove it from keyboard and AT navigation.
// CSS grid transitions can reverse from the current height without measuring content.
export function Collapse({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [present, setPresent] = React.useState(open);
  const [shown, setShown] = React.useState(false);
  React.useLayoutEffect(() => {
    let first = 0;
    let second = 0;
    let timer = 0;
    if (open) {
      setPresent(true);
      if (reduced) setShown(true);
      else
        first = requestAnimationFrame(() => {
          second = requestAnimationFrame(() => setShown(true));
        });
    } else {
      setShown(false);
      if (reduced) setPresent(false);
      else
        timer = window.setTimeout(() => setPresent(false), motionDuration + 50);
    }
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      clearTimeout(timer);
    };
  }, [open, reduced]);
  if (!open && !present) return null;
  return (
    <div
      className={`motion-collapse ${shown && open ? "motion-open" : ""} ${className}`}
      aria-hidden={!open}
      inert={!open}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === "grid-template-rows" &&
          !open
        )
          setPresent(false);
      }}
    >
      <div className="motion-content">{children}</div>
    </div>
  );
}

export function MotionAlert({
  visible,
  ...props
}: AlertProps & { visible: boolean }) {
  const last = React.useRef(props);
  if (visible) last.current = props;
  return (
    <Collapse open={visible} className="notice-motion">
      <Alert {...(visible ? props : last.current)} />
    </Collapse>
  );
}

export type CreatedNode = { id: string; kind: "page" | "library"; at: number };
export function notifyCreatedNode(id: string, kind: CreatedNode["kind"]) {
  window.dispatchEvent(
    new CustomEvent<CreatedNode>("wiki-node-created", {
      detail: { id, kind, at: Date.now() },
    }),
  );
}
export const CreatedNodeContext = React.createContext<CreatedNode | undefined>(
  undefined,
);
export function useNodeFeedback(id: string, kind: CreatedNode["kind"]) {
  const node = React.useContext(CreatedNodeContext);
  const fresh = node?.id === id && node.kind === kind;
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  React.useEffect(() => {
    if (!fresh) return;
    const timer = window.setTimeout(
      () => {
        const row = ref.current;
        const scroller = row?.closest<HTMLElement>(".sidebar-body");
        if (!row || !scroller || scroller.closest('[aria-hidden="true"]'))
          return;
        const rect = row.getBoundingClientRect();
        const box = scroller.getBoundingClientRect();
        const delta =
          rect.bottom > box.bottom
            ? rect.bottom - box.bottom + 8
            : rect.top < box.top
              ? rect.top - box.top - 8
              : 0;
        if (delta)
          scroller.scrollTo({
            top: scroller.scrollTop + delta,
            behavior: reduced ? "instant" : "smooth",
          });
      },
      reduced ? 0 : motionDuration + 80,
    );
    return () => clearTimeout(timer);
  }, [fresh, reduced]);
  return { ref, fresh };
}
export function TreeRow({
  id,
  kind,
  className,
  children,
}: {
  id: string;
  kind: CreatedNode["kind"];
  className: string;
  children: React.ReactNode;
}) {
  const { ref, fresh } = useNodeFeedback(id, kind);
  return (
    <div
      ref={ref}
      data-created={fresh || undefined}
      className={`${className}${fresh ? " node-created" : ""}`}
    >
      {children}
    </div>
  );
}
