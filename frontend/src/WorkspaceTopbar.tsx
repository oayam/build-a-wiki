import React from "react";
import { flushSync } from "react-dom";
import { Input, type InputRef } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { Account } from "./session";
import Icon from "./Icon";

export const WorkspaceTopInset = React.createContext(0);
type Mode = "expanded" | "hidden" | "revealed";

export default function WorkspaceTopbar({
  breadcrumb,
  onInsetChange,
}: {
  breadcrumb: React.RefObject<HTMLElement | null>;
  onInsetChange: (height: number) => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<Mode>("expanded");
  const [query, setQuery] = React.useState("");
  const dock = React.useRef<HTMLDivElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const edge = React.useRef<HTMLButtonElement>(null);
  const search = React.useRef<InputRef>(null);
  const hoverY = React.useRef<number | null>(null);
  const visible = mode !== "hidden";

  React.useLayoutEffect(() => {
    const element = visible ? panel.current! : dock.current!;
    const measure = () => onInsetChange(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, onInsetChange]);

  React.useEffect(() => {
    if (mode !== "hidden") return;
    const row = breadcrumb.current;
    const home = row?.firstElementChild;
    const strip = dock.current;
    if (!row || !home || !strip) return;

    let bandTimer: number | undefined;
    let aboveTimer: number | undefined;
    const open = () =>
      setMode((current) => (current === "hidden" ? "revealed" : current));
    function dwell(inside: boolean, timer: number | undefined, delay: number) {
      if (inside) return timer ?? window.setTimeout(open, delay);
      window.clearTimeout(timer);
    }
    const update = () => {
      const y = hoverY.current;
      if (y === null) return;
      const box = row.getBoundingClientRect();
      const stripBottom = strip.getBoundingClientRect().bottom;
      // When the breadcrumb scrolls away, keep its bands at the viewport edge.
      const top =
        box.bottom <= stripBottom || box.top >= window.innerHeight
          ? stripBottom
          : box.top;
      const pathTop = Math.max(
        stripBottom,
        top + home.getBoundingClientRect().top - box.top,
      );
      bandTimer = dwell(y >= 0 && y <= top + box.height, bandTimer, 2500);
      aboveTimer = dwell(y >= 0 && y < pathTop, aboveTimer, 1000);
    };
    const clear = () => {
      hoverY.current = null;
      window.clearTimeout(bandTimer);
      window.clearTimeout(aboveTimer);
      bandTimer = aboveTimer = undefined;
    };
    function track(event: PointerEvent) {
      if (event.pointerType === "touch" || event.buttons) return clear();
      hoverY.current = event.clientY;
      update();
    }
    function leave(event: PointerEvent) {
      if (!event.relatedTarget) clear();
    }
    update();
    const controller = new AbortController();
    const options = { signal: controller.signal, passive: true };
    window.addEventListener("pointermove", track, options);
    window.addEventListener("pointerup", track, options);
    window.addEventListener("pointerdown", clear, options);
    window.addEventListener("pointerout", leave, options);
    window.addEventListener("pointercancel", clear, options);
    window.addEventListener("blur", clear, options);
    window.addEventListener("resize", update, options);
    window.addEventListener("scroll", update, options);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) clear();
      },
      options,
    );
    return () => {
      controller.abort();
      clear();
    };
  }, [mode, breadcrumb]);

  function reveal(nextMode: "expanded" | "revealed") {
    flushSync(() =>
      setMode((previous) => (previous === "hidden" ? nextMode : previous)),
    );
  }
  React.useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        reveal("revealed");
        search.current?.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  React.useEffect(() => {
    if (mode !== "revealed") return;
    function outside(event: PointerEvent) {
      if (!dock.current?.contains(event.target as Node)) setMode("hidden");
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [mode]);

  function toggleBar(event: React.MouseEvent<HTMLButtonElement>) {
    if (!visible) {
      reveal("expanded");
      if (event.detail === 0) search.current?.focus({ preventScroll: true });
      return;
    }
    if (
      "pointerType" in event.nativeEvent &&
      event.nativeEvent.pointerType === "mouse"
    )
      hoverY.current = event.clientY;
    setMode("hidden");
  }

  return (
    <div
      ref={dock}
      className="topbar-dock"
      data-mode={mode}
      onPointerLeave={(event) => {
        if (
          mode === "revealed" &&
          event.pointerType !== "touch" &&
          (!dock.current?.contains(document.activeElement) ||
            (document.activeElement === edge.current &&
              !edge.current?.matches(":focus-visible")))
        )
          setMode("hidden");
      }}
      onBlur={(event) => {
        if (
          mode === "revealed" &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !event.currentTarget.matches(":hover")
        )
          setMode("hidden");
      }}
      onKeyDown={(event) => {
        if (mode === "revealed" && event.key === "Escape") {
          event.preventDefault();
          flushSync(() => setMode("hidden"));
          edge.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div className="topbar-panel" ref={panel}>
        <header
          id="workspace-topbar"
          className="topbar"
          inert={!visible}
          aria-hidden={!visible}
        >
          <Link className="brand" to="/" aria-label="Build-a-Wiki 首页">
            <span className="brand-mark">
              <Icon name="book" />
            </span>
            <span>Build-a-Wiki</span>
          </Link>
          <form
            className="global-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <Input
              ref={search}
              aria-label="全局搜索"
              placeholder="搜索 wiki 内容（如：使用指南、功能、部署…）"
              prefix={<Icon name="search" />}
              suffix={<kbd>Ctrl K</kbd>}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
          <div className="topbar-account">
            <Account />
          </div>
        </header>
        <button
          className="topbar-edge"
          type="button"
          ref={edge}
          aria-label={visible ? "收起顶部栏" : "展开顶部栏"}
          aria-controls="workspace-topbar"
          aria-expanded={visible}
          onClick={toggleBar}
        >
          <Icon name="chevron" />
        </button>
      </div>
    </div>
  );
}
