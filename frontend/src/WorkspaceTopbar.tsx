import React from "react";
import { flushSync } from "react-dom";
import { Button, Input, type InputRef } from "antd";
import { Link, useNavigate } from "react-router-dom";
import { Account, useSession } from "./session";
import Icon from "./Icon";

export const WorkspaceTopInset = React.createContext(0);
type Mode = "pinned" | "hidden" | "revealed";

export default function WorkspaceTopbar({
  onInsetChange,
}: {
  onInsetChange: (height: number) => void;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  const preference = `wiki:auto-hide-topbar:${user.id}`;
  const [mode, setMode] = React.useState<Mode>(() => {
    try {
      return localStorage.getItem(preference) === "1" ? "hidden" : "pinned";
    } catch {
      return "pinned";
    }
  });
  const [query, setQuery] = React.useState("");
  const dock = React.useRef<HTMLDivElement>(null);
  const bar = React.useRef<HTMLElement>(null);
  const edge = React.useRef<HTMLButtonElement>(null);
  const search = React.useRef<InputRef>(null);
  const hoverTimer = React.useRef<number | undefined>(undefined);
  const visible = mode !== "hidden";

  React.useLayoutEffect(() => {
    const element = visible ? bar.current! : dock.current!;
    const measure = () => onInsetChange(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, onInsetChange]);

  function cancelHover() {
    window.clearTimeout(hoverTimer.current);
  }
  React.useEffect(() => cancelHover, []);

  function reveal() {
    cancelHover();
    flushSync(() =>
      setMode((previous) => (previous === "hidden" ? "revealed" : previous)),
    );
  }
  React.useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        reveal();
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

  function togglePin(keyboard: boolean) {
    cancelHover();
    const hide = mode === "pinned";
    flushSync(() => setMode(hide ? "hidden" : "pinned"));
    if (hide && keyboard) edge.current?.focus({ preventScroll: true });
    try {
      if (hide) localStorage.setItem(preference, "1");
      else localStorage.removeItem(preference);
    } catch {
      // The current session still uses the selected mode.
    }
  }

  return (
    <div
      ref={dock}
      className="topbar-dock"
      data-mode={mode}
      onPointerEnter={(event) => {
        if (mode === "hidden" && event.pointerType !== "touch") {
          cancelHover();
          hoverTimer.current = window.setTimeout(
            () => setMode("revealed"),
            1000,
          );
        }
      }}
      onPointerLeave={(event) => {
        cancelHover();
        if (
          mode === "revealed" &&
          event.pointerType !== "touch" &&
          !dock.current?.contains(document.activeElement)
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
      {mode === "hidden" && (
        <button
          className="topbar-edge"
          type="button"
          ref={edge}
          aria-label="展开顶部栏"
          aria-controls="workspace-topbar"
          aria-expanded={false}
          onClick={(event) => {
            reveal();
            if (event.detail === 0)
              search.current?.focus({ preventScroll: true });
          }}
        />
      )}
      <header
        ref={bar}
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
          <Button
            type="text"
            className="topbar-pin"
            aria-label="固定顶部栏"
            aria-pressed={mode === "pinned"}
            title={mode === "pinned" ? "取消固定顶部栏" : "固定顶部栏"}
            icon={<Icon name="pin" />}
            onClick={(event) => togglePin(event.detail === 0)}
          />
          <Account />
        </div>
      </header>
    </div>
  );
}
