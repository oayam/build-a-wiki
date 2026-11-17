import React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Spin } from "antd";
import type { InputRef } from "antd";
import type { components } from "./api.generated";
import { Account, request, useSession } from "./session";
import { PageTree } from "./Pages";
import Icon, { type IconName } from "./Icon";
type K = components["schemas"]["KnowledgeBase"];
export default function Workspace({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [collapsed, setCollapsed] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [more, setMore] = React.useState<K[]>([]);
  const [next, setNext] = React.useState<string | null>();
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState<string[]>([]);
  const search = React.useRef<InputRef>(null);
  const pageId = location.pathname.match(/^\/pages\/([^/]+)/)?.[1];
  const libraryId = location.pathname.match(/^\/knowledge-bases\/([^/]+)/)?.[1];
  const libraries = useQuery({
    queryKey: ["navigation", user.id, "libraries", location.pathname],
    queryFn: () =>
      request<components["schemas"]["KnowledgeList"]>("/knowledge-bases"),
    retry: false,
  });
  const page = useQuery({
    queryKey: ["navigation", user.id, "page", pageId, location.pathname],
    queryFn: () =>
      request<components["schemas"]["PageDetail"]>(`/pages/${pageId}`),
    enabled: !!pageId,
    retry: false,
  });
  const current = libraryId ?? page.data?.knowledge_base_id;
  const activeLibrary = useQuery({
    queryKey: ["navigation", user.id, "active-library", current],
    queryFn: () => request<K>(`/knowledge-bases/${current}`),
    enabled: !!current,
    retry: false,
  });
  const items = [
    ...(libraries.data?.items ?? []),
    ...more,
    ...(activeLibrary.isSuccess && activeLibrary.data
      ? [activeLibrary.data]
      : []),
  ].filter((k, i, all) => all.findIndex((x) => x.id === k.id) === i);
  React.useEffect(() => {
    setMore([]);
    setNext(undefined);
    setError("");
  }, [libraries.data]);
  React.useEffect(() => {
    const changed = () => {
      void client.invalidateQueries({ queryKey: ["navigation"] });
    };
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("wiki-navigation-changed", changed);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("wiki-navigation-changed", changed);
      window.removeEventListener("keydown", shortcut);
    };
  }, [client]);
  React.useEffect(() => {
    if (current)
      setOpen((old) => (old.includes(current) ? old : [...old, current]));
  }, [current]);
  const links: { to: string; text: string; icon: IconName }[] = [
    { to: "/", text: "我的知识库", icon: "home" },
    { to: "/shared", text: "与我共享", icon: "users" },
    { to: "/search", text: "搜索", icon: "search" },
    { to: "/trash", text: "回收站", icon: "trash" },
  ];
  const management: typeof links = [
    ...(user.is_system_admin
      ? [
          { to: "/admin/users", text: "账号与用户组", icon: "users" as const },
          {
            to: "/admin/operations",
            text: "审计与系统状态",
            icon: "settings" as const,
          },
        ]
      : []),
    { to: "/status", text: "服务状态", icon: "activity" },
    { to: "/editor", text: "编辑器验证", icon: "code" },
  ];
  const routeTitle =
    [...links, ...management].find((x) => x.to === location.pathname)?.text ??
    (pageId ? "文档工作区" : "知识库");
  const cursor = next === undefined ? libraries.data?.next_cursor : next;
  return (
    <div className={`shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Build-a-Wiki 首页">
          <span className="brand-mark">
            <Icon name="book" />
          </span>
          <span>Build-a-Wiki</span>
        </Link>
        <form
          className="global-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
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
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <div className="topbar-account">
          <Account />
        </div>
      </header>
      <aside className="sidebar" aria-label="知识库导航">
        <div className="sidebar-heading">
          <span>
            <Icon name="book" />
            知识库
          </span>
          <Button
            type="text"
            className="collapse-button"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon name="collapse" />
          </Button>
        </div>
        <div className="sidebar-body" hidden={collapsed}>
          <nav className="primary-nav" aria-label="工作区入口">
            {links.map((x) => (
              <NavLink key={x.to} to={x.to} end={x.to === "/"}>
                <Icon name={x.icon} />
                {x.text}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-section-label">
            知识库目录
            <Link
              to={current ? `/knowledge-bases/${current}` : "/"}
              aria-label="前往新建页面"
              title="前往知识库创建页面"
            >
              <Icon name="plus" />
            </Link>
          </div>
          {libraries.isPending && <Spin size="small" />}
          {libraries.error && (
            <Alert
              type="error"
              message="目录加载失败"
              action={
                <Button size="small" onClick={() => void libraries.refetch()}>
                  重试
                </Button>
              }
            />
          )}
          <div className="library-tree">
            {items.map((k) => (
              <section key={k.id}>
                <div
                  className={`library-tree-row ${current === k.id ? "current-library" : ""}`}
                >
                  <button
                    className="tree-toggle"
                    aria-label={`${open.includes(k.id) ? "收起" : "展开"}知识库：${k.name}`}
                    aria-expanded={open.includes(k.id)}
                    onClick={() =>
                      setOpen((old) =>
                        old.includes(k.id)
                          ? old.filter((id) => id !== k.id)
                          : [...old, k.id],
                      )
                    }
                  >
                    <Icon
                      name="chevron"
                      className={open.includes(k.id) ? "rotated" : ""}
                    />
                  </button>
                  <Link
                    to={`/knowledge-bases/${k.id}`}
                    aria-label={`打开知识库：${k.name}`}
                    title={k.name}
                  >
                    <Icon name="folder" /> <span>{k.name}</span>
                  </Link>
                </div>
                {open.includes(k.id) && (
                  <PageTree
                    key={`${k.id}:${location.pathname}`}
                    kb={k.id}
                    navigation
                    ancestors={page.data?.breadcrumbs.map((p) => p.id)}
                  />
                )}
              </section>
            ))}
          </div>
          {!libraries.isPending && !libraries.error && !items.length && (
            <p className="sidebar-empty">创建知识库，开始整理团队知识。</p>
          )}
          {error && <Alert type="error" message={error} />}
          {cursor && (
            <Button
              type="text"
              loading={loadingMore}
              onClick={async () => {
                setLoadingMore(true);
                try {
                  const r = await request<
                    components["schemas"]["KnowledgeList"]
                  >(`/knowledge-bases?cursor=${encodeURIComponent(cursor)}`);
                  setMore((old) => [...old, ...r.items]);
                  setNext(r.next_cursor);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoadingMore(false);
                }
              }}
            >
              更多知识库
            </Button>
          )}
          <nav className="secondary-nav" aria-label="管理与工具">
            {management.map((x) => (
              <NavLink key={x.to} to={x.to}>
                <Icon name={x.icon} />
                {x.text}
              </NavLink>
            ))}
          </nav>
          <footer>
            <span className="workspace-dot" />
            团队工作区<span>Build-a-Wiki</span>
          </footer>
        </div>
      </aside>
      <div className="content">
        <nav className="workspace-crumb" aria-label="页面路径">
          <Link to="/" aria-label="返回工作台">
            <Icon name="home" />
          </Link>
          <span>/</span>
          {page.isSuccess && page.data ? (
            page.data.breadcrumbs.map((p, index) => (
              <React.Fragment key={p.id}>
                {index > 0 && <span>/</span>}
                {p.id === pageId ? (
                  <span aria-current="page">{p.title}</span>
                ) : (
                  <Link to={`/pages/${p.id}`}>{p.title}</Link>
                )}
              </React.Fragment>
            ))
          ) : (
            <span>{routeTitle}</span>
          )}
        </nav>
        <main id="main-content">{children}</main>
      </div>
    </div>
  );
}
