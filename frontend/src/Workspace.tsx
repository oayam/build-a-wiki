import React from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Spin } from "antd";
import type { InputRef } from "antd";
import type { components } from "./api.generated";
import { Account, request, useSession } from "./session";
import { PageTree } from "./Pages";
import Icon, { type IconName } from "./Icon";
import { CreatedNodeContext, TreeRow, type CreatedNode } from "./Motion";
import CreateLibraryDialog from "./CreateLibraryDialog";
import CreatePageDialog, { type CreatePageTarget } from "./CreatePageDialog";
type K = components["schemas"]["KnowledgeBase"];
export default function Workspace({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [createdNode, setCreatedNode] = React.useState<CreatedNode>();
  React.useEffect(() => {
    const created = (event: Event) =>
      setCreatedNode((event as CustomEvent<CreatedNode>).detail);
    window.addEventListener("wiki-node-created", created);
    return () => window.removeEventListener("wiki-node-created", created);
  }, []);
  React.useEffect(() => {
    if (!createdNode) return;
    if (createdNode.kind === "library")
      setOpen((old) =>
        old.includes(createdNode.id) ? old : [...old, createdNode.id],
      );
    const timer = window.setTimeout(() => setCreatedNode(undefined), 2400);
    return () => clearTimeout(timer);
  }, [createdNode]);
  const [collapsed, setCollapsed] = React.useState(false);
  const [createLibrary, setCreateLibrary] = React.useState(false);
  const [createTarget, setCreateTarget] = React.useState<CreatePageTarget>();
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
    queryKey: ["navigation", user.id, "libraries"],
    queryFn: () =>
      request<components["schemas"]["KnowledgeList"]>("/knowledge-bases"),
    retry: false,
  });
  const page = useQuery({
    queryKey: ["navigation", user.id, "page", pageId],
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
  const items = libraries.isError
    ? []
    : [
        ...(libraries.data?.items ?? []),
        ...more,
        ...(activeLibrary.isSuccess && activeLibrary.data
          ? [activeLibrary.data]
          : []),
      ].filter((k, i, all) => all.findIndex((x) => x.id === k.id) === i);
  // Route changes revalidate cached navigation without replacing the visible tree.
  React.useEffect(() => {
    void client.invalidateQueries({ queryKey: ["navigation", user.id] });
  }, [client, user.id, location.pathname]);
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
  const management: { to: string; text: string; icon: IconName }[] = [
    { to: "/shared", text: "与我共享", icon: "users" },
    { to: "/trash", text: "回收站", icon: "trash" },
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
    ({ "/": "我的知识库", "/search": "搜索" } as Record<string, string>)[
      location.pathname
    ] ??
    management.find((x) => x.to === location.pathname)?.text ??
    (pageId ? "文档工作区" : "知识库");
  const cursor = next === undefined ? libraries.data?.next_cursor : next;
  return (
    <CreatedNodeContext.Provider value={createdNode}>
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
          <div
            className="sidebar-body"
            aria-hidden={collapsed}
            inert={collapsed}
          >
            <div className="sidebar-section-label">
              知识库目录
              <button
                className="directory-create"
                aria-label="新建知识库"
                title="新建知识库"
                onClick={() => setCreateLibrary(true)}
              >
                <Icon name="plus" />
              </button>
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
                  <TreeRow
                    id={k.id}
                    kind="library"
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
                      <span
                        className={`tree-triangle ${open.includes(k.id) ? "expanded" : ""}`}
                        aria-hidden="true"
                      >
                        ▲
                      </span>
                    </button>
                    <Link
                      to={`/knowledge-bases/${k.id}`}
                      aria-label={`打开知识库：${k.name}`}
                      title={k.name}
                    >
                      <Icon name="folder" /> <span>{k.name}</span>
                    </Link>
                    <button
                      className="tree-create"
                      aria-label={`创建页面：${k.name}`}
                      title={
                        k.role >= 2 ? "创建页面" : "需要编辑权限才能创建页面"
                      }
                      disabled={k.role < 2}
                      onClick={() =>
                        setCreateTarget({ kb: k.id, title: k.name })
                      }
                    >
                      <Icon name="plus" />
                    </button>
                  </TreeRow>
                  <PageTree
                    key={k.id}
                    kb={k.id}
                    navigation
                    expanded={open.includes(k.id)}
                    onCreate={setCreateTarget}
                    ancestors={page.data?.breadcrumbs.map((p) => p.id)}
                  />
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
        {createLibrary && (
          <CreateLibraryDialog onClose={() => setCreateLibrary(false)} />
        )}
        {createTarget && (
          <CreatePageDialog
            target={createTarget}
            onClose={() => setCreateTarget(undefined)}
          />
        )}
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
    </CreatedNodeContext.Provider>
  );
}
