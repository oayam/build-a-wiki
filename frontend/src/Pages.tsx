import Attachments from "./Attachments";
import React from "react";
import {
  isPlainTreeClick,
  toggleTreeNode,
  expandTreeNode,
} from "./treeNavigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Icon from "./Icon";
import EditorToolbar from "./EditorToolbar";
import { Collapse, MotionAlert, TreeRow } from "./Motion";
import {
  OpenCreatePageDialog,
  type CreatePageTarget,
} from "./CreatePageDialog";
import { Alert, Button, Input, Space, Spin, Empty, Dropdown } from "antd";
import {
  Link,
  NavLink,
  useParams,
  useLocation,
  useBlocker,
} from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { components } from "./api.generated";
import { extensions } from "./editor";
import { request, RequestError, useSession } from "./session";
import { useEditLease } from "./useEditLease";
import { useDraft } from "./useDraft";
type Detail = components["schemas"]["PageDetail"];
type List = components["schemas"]["PageList"];
type Summary = components["schemas"]["PageSummary"];
const EMPTY_DOCUMENT_MESSAGE = "空空如也";
const DOCUMENT_PANEL_LABEL = "页面内容";
const VISIBLE_BLOCK_TYPES = new Set([
  "image",
  "horizontalRule",
  "table",
  "taskList",
]);
function hasVisibleBody(node: JSONContent): boolean {
  return (
    Boolean(node.text?.trim()) ||
    VISIBLE_BLOCK_TYPES.has(node.type ?? "") ||
    Boolean(node.content?.some(hasVisibleBody))
  );
}
export function PageTree({
  kb,
  parent,
  navigation = false,
  ancestors = [],
  onCreate,
  expanded = true,
}: {
  kb: string;
  parent?: string;
  navigation?: boolean;
  expanded?: boolean;
  ancestors?: string[];
  onCreate?: (target: CreatePageTarget) => void;
}) {
  const { user } = useSession();
  const [open, setOpen] = React.useState<string[]>(ancestors);
  const location = useLocation();
  const query = useInfiniteQuery({
    queryKey: ["navigation", user.id, "tree", kb, parent ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (parent) params.set("parent_id", parent);
      if (pageParam) params.set("cursor", pageParam);
      return request<List>(`/knowledge-bases/${kb}/pages?${params}`);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
    enabled: expanded,
  });
  // Reuse loaded rows on re-expansion while revalidating access in the background.
  // A failed refresh must not leave previously authorized rows visible.
  const items = query.isError
    ? []
    : (query.data?.pages.flatMap((page) => page.items) ?? []);
  const ancestorKey = ancestors.join(",");
  React.useEffect(() => {
    setOpen((old) => [...new Set([...old, ...ancestors])]);
  }, [ancestorKey]);
  const isEmpty = query.isSuccess && !items.length;
  const emptyMessage = isEmpty && <p className="tree-empty">暂无内容</p>;
  if (!navigation && !parent && expanded && emptyMessage) return emptyMessage;
  return (
    <div
      className="tree-branch"
      aria-busy={expanded && query.isPending}
      data-empty={isEmpty || undefined}
    >
      {expanded && query.isPending && (
        <span className="sr-only" role="status">
          正在加载目录…
        </span>
      )}
      <Collapse open={expanded && !query.isPending} className="tree-reveal">
        {query.isError && (
          <Alert
            type="error"
            message={query.error.message}
            action={
              <Button size="small" onClick={() => void query.refetch()}>
                重试
              </Button>
            }
          />
        )}
        <ul className="page-tree" aria-busy={query.isPending}>
          {items.map((p) => (
            <li key={p.id}>
              <TreeRow id={p.id} kind="page" className="page-tree-row">
                {p.has_children ? (
                  <button
                    className="tree-toggle"
                    aria-label={`${open.includes(p.id) ? "收起" : "展开"}-${p.title}`}
                    aria-expanded={open.includes(p.id)}
                    onClick={() =>
                      setOpen(
                        open.includes(p.id)
                          ? open.filter((x) => x !== p.id)
                          : [...open, p.id],
                      )
                    }
                  >
                    <span
                      className={`tree-triangle ${open.includes(p.id) ? "expanded" : ""}`}
                      aria-hidden="true"
                    >
                      ▲
                    </span>
                  </button>
                ) : (
                  <span className="tree-toggle-spacer" />
                )}
                <NavLink
                  to={`/pages/${p.id}`}
                  end
                  aria-label={navigation ? `打开页面：${p.title}` : undefined}
                  title={p.title}
                  onClick={(event) => {
                    if (
                      !navigation ||
                      !p.has_children ||
                      !isPlainTreeClick(event)
                    )
                      return;
                    if (location.pathname === `/pages/${p.id}`) {
                      event.preventDefault();
                      setOpen((old) => toggleTreeNode(old, p.id));
                    } else {
                      setOpen((old) => expandTreeNode(old, p.id));
                    }
                  }}
                >
                  <Icon name={p.has_children ? "folder" : "file"} />
                  <span>{p.title}</span>
                </NavLink>
                {navigation && onCreate && (
                  <button
                    className="tree-create"
                    aria-label={`创建子页面：${p.title}`}
                    title={
                      p.role >= 2 ? "创建子页面" : "需要编辑权限才能创建子页面"
                    }
                    disabled={p.role < 2}
                    onClick={() =>
                      onCreate({ kb, parent: p.id, title: p.title })
                    }
                  >
                    <Icon name="plus" />
                  </button>
                )}
              </TreeRow>
              {p.has_children && (
                <PageTree
                  kb={kb}
                  parent={p.id}
                  expanded={expanded && open.includes(p.id)}
                  navigation={navigation}
                  ancestors={ancestors}
                  onCreate={onCreate}
                />
              )}
            </li>
          ))}
        </ul>
        {query.hasNextPage && !query.isError && (
          <Button
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            加载更多页面
          </Button>
        )}
        {emptyMessage}
      </Collapse>
    </div>
  );
}
export function LibraryPages() {
  const { id } = useParams();
  const { user } = useSession();
  const openCreatePage = React.useContext(OpenCreatePageDialog);
  const { data: k, error } = useQuery({
    queryKey: ["navigation", user.id, "library", id],
    queryFn: () =>
      request<components["schemas"]["KnowledgeBase"]>(`/knowledge-bases/${id}`),
    retry: false,
  });
  return (
    <section className="library-directory">
      <header className="library-directory-header">
        <h1>{k?.name ?? "知识库"}</h1>
        <Link
          to={`/knowledge-bases/${id}/permissions`}
          className="library-settings-link"
          aria-label="管理权限与设置"
          title="管理权限与设置"
        >
          <Icon name="settings" />
        </Link>
      </header>
      {error && <Alert type="error" message={error.message} />}
      <div className="library-directory-body">
        {k && !error && k.role >= 2 && openCreatePage && (
          <Button
            className="library-create-button"
            type="primary"
            onClick={() => openCreatePage({ kb: k.id, title: k.name })}
          >
            创建页面
          </Button>
        )}
        {k && !error && <PageTree key={k.id} kb={k.id} />}
      </div>
    </section>
  );
}
export function SharedPages() {
  const [items, setItems] = React.useState<Summary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  async function load(next?: string) {
    const r = await request<List>(
      "/shared-pages" + (next ? "?cursor=" + next : ""),
    );
    setItems((old) => (next ? [...old, ...r.items] : r.items));
    setCursor(r.next_cursor ?? null);
  }
  React.useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <h1>与我共享的独立页面</h1>
      {error && <Alert type="error" message={error} />}
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <Link to={`/pages/${p.id}`}>{p.title}</Link>
          </li>
        ))}
      </ul>
      {!items.length && <Empty description="暂无独立共享页面" />}
      {cursor && <Button onClick={() => void load(cursor)}>加载更多</Button>}
    </>
  );
}
export function PageScreen() {
  const { id } = useParams();
  const [data, setData] = React.useState<Detail>();
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    setData(undefined);
    setError("");
    void request<Detail>(`/pages/${id}`)
      .then((data) => {
        setData(data);
        void request(`/pages/${id}/visit`, "PUT").catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [id]);
  return error ? (
    <Alert type="error" message={error} />
  ) : data ? (
    <Document key={data.id} page={data} onSaved={setData} />
  ) : (
    <Spin />
  );
}
function Document({
  page,
  onSaved,
}: {
  page: Detail;
  onSaved: (d: Detail) => void;
}) {
  const { user } = useSession();
  const [editing, setEditing] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [title, setTitle] = React.useState(page.title);
  const [body, setBody] = React.useState<JSONContent>(page.body as JSONContent);
  const [dirty, setDirty] = React.useState(false);
  const [base, setBase] = React.useState(page.current_revision_id);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const [uncertain, setUncertain] = React.useState(false);
  const lease = useEditLease(page.id);
  const writable = editing && lease.active && !busy;
  const [preview, setPreview] = React.useState(false);
  const [latest, setLatest] = React.useState<Detail>();
  const retry = React.useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const editor = useEditor({
    extensions,
    content: body,
    editable: false,
    onUpdate: ({ editor }) => {
      setBody(editor.getJSON());
      setDirty(true);
    },
  });
  React.useEffect(() => {
    const canType = writable && !preview;
    editor?.setEditable(canType, false);
    editor?.view.dom.setAttribute("aria-readonly", String(!canType));
  }, [editor, writable, preview]);
  useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      !window.confirm("有未保存的内容，确认离开？"),
  );
  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const localKey = `wiki-local:${user.id}:${page.id}`;
  const draft = useDraft(
    page.id,
    page.role >= 2,
    writable,
    dirty,
    { title, body, schema_version: 1, base_revision_id: base },
    localKey,
    lease.token.current,
  );
  React.useEffect(() => {
    if (dirty) {
      try {
        sessionStorage.setItem(
          localKey,
          JSON.stringify({
            title,
            body,
            base_revision_id: base,
          }),
        );
      } catch {
        /* The page can still be saved if browser storage is unavailable. */
      }
    }
  }, [title, body, base, dirty, localKey]);
  async function enter(restore = false) {
    setBusy(true);
    setError("");
    try {
      if (!(await lease.acquire())) return;
      const updated = await request<Detail>(
        `/pages/${page.id}`,
        "GET",
        undefined,
        AbortSignal.timeout(15000),
      );
      const candidate =
        editing && restore ? draft.candidate : await draft.reload(true);
      if (candidate && !restore) {
        lease.release();
        return;
      }
      if (candidate) draft.restore();
      const source = candidate ?? updated;
      onSaved(updated);
      setTitle(source.title);
      setBody(source.body as JSONContent);
      editor?.commands.setContent(source.body as JSONContent, {
        emitUpdate: false,
      });
      setBase(candidate?.base_revision_id ?? updated.current_revision_id);
      setDirty(!!candidate);
      setEditing(true);
      retry.current = undefined;
      setUncertain(false);
      setLatest(undefined);
      if (
        candidate &&
        candidate.base_revision_id !== updated.current_revision_id
      )
        setLatest(updated);
    } catch (e) {
      lease.release();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    const value = {
      title,
      schema_version: 1,
      body,
      base_revision_id: base,
      lease_id: lease.token.current,
    };
    const fingerprint = JSON.stringify(value);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await request(
        `/pages/${page.id}/revisions`,
        "POST",
        {
          ...value,
          request_id: retry.current.id,
        },
        AbortSignal.timeout(30000),
      );
      const updated = await request<Detail>(
        `/pages/${page.id}`,
        "GET",
        undefined,
        AbortSignal.timeout(15000),
      );
      lease.release();
      setDirty(false);
      sessionStorage.removeItem(localKey);
      onSaved(updated);
      setTitle(updated.title);
      setBody(updated.body as JSONContent);
      editor?.commands.setContent(updated.body as JSONContent, {
        emitUpdate: false,
      });
      setBase(updated.current_revision_id);
      try {
        await draft.discard();
      } catch (e) {
        setError("页面已保存，但草稿清理失败：" + (e as Error).message);
      }
      setUncertain(false);
      setMessage("已保存");
      setEditing(false);
      setPreview(false);
      setLatest(undefined);
    } catch (e) {
      if (!(e instanceof RequestError) || e.status >= 500) {
        setUncertain(true);
        lease.pause("保存结果尚未确认，本地内容已保留。");
        setError("保存结果尚未确认，本地内容已保留。");
      } else {
        setUncertain(false);
        if (e.code === "EDIT_LEASE") lease.pause(e.message);
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="document-panel" aria-label={DOCUMENT_PANEL_LABEL}>
        <div className="document-header">
          <div className="document-heading">
            <div
              className="document-title-slot"
              key={editing && !preview ? "edit" : "read"}
            >
              {editing && !preview ? (
                <Input
                  className="document-title"
                  aria-label="页面标题"
                  disabled={!writable}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                />
              ) : (
                <h1>{title}</h1>
              )}
            </div>
            <span className={`document-badge ${editing ? "is-draft" : ""}`}>
              {editing ? (!lease.active ? "编辑已暂停" : preview ? "预览" : "草稿") : "当前版本"}
            </span>
          </div>
          <Space wrap className="document-actions">
            {page.role >= 2 && !draft.ready && draft.status && (
              <Button
                onClick={() =>
                  void draft.reload(true).catch((e) => setError(e.message))
                }
              >
                重新读取草稿
              </Button>
            )}
            {page.role >= 2 && !editing && (
              <Button
                type="primary"
                disabled={!draft.ready || !!draft.candidate || busy}
                onClick={() => void enter()}
              >
                编辑页面
              </Button>
            )}
            {editing && (
              <>
                <Button
                  type="primary"
                  autoInsertSpace={false}
                  aria-label="保存"
                  aria-busy={busy}
                  loading={busy}
                  disabled={busy || !lease.active || !!latest}
                  onClick={() => void save()}
                >
                  保存
                </Button>
                <Button onClick={() => setPreview(!preview)}>
                  {preview ? "继续编辑" : "预览"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (!dirty || confirm("放弃未保存内容和个人草稿？")) {
                      setBusy(true);
                      try {
                        if (dirty) await draft.discard();
                      } catch (e) {
                        setError((e as Error).message);
                        return;
                      } finally {
                        setBusy(false);
                      }
                      lease.release();
                      setPreview(false);
                      setLatest(undefined);
                      setBase(page.current_revision_id);
                      setTitle(page.title);
                      setBody(page.body as JSONContent);
                      editor?.commands.setContent(page.body as JSONContent, {
                        emitUpdate: false,
                      });
                      setDirty(false);
                      setEditing(false);
                      sessionStorage.removeItem(localKey);
                    }
                  }}
                >
                  放弃编辑
                </Button>
              </>
            )}
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              autoFocus
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              overlayClassName="document-settings-dropdown"
              menu={{
                "aria-label": "页面设置",
                onClick: () => setSettingsOpen(false),
                items: [
                  {
                    key: "permissions",
                    icon: <Icon name="shield" />,
                    label: (
                      <Link to={`/pages/${page.id}/permissions`}>页面权限</Link>
                    ),
                  },
                  {
                    key: "history",
                    icon: <Icon name="history" />,
                    label: (
                      <Link to={`/pages/${page.id}/history`}>版本历史</Link>
                    ),
                  },
                  ...(page.role >= 3
                    ? [
                        {
                          key: "move",
                          icon: <Icon name="move" />,
                          label: (
                            <Link to={`/pages/${page.id}/move`}>
                              移动与排序
                            </Link>
                          ),
                        },
                        { type: "divider" as const },
                        {
                          key: "delete",
                          danger: true,
                          icon: <Icon name="trash" />,
                          label: (
                            <Link to={`/pages/${page.id}/delete`}>
                              删除页面
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ],
              }}
            >
              <Button
                className="document-settings-trigger"
                aria-label="页面设置"
                title="页面设置"
                aria-haspopup="menu"
                aria-expanded={settingsOpen}
                icon={<Icon name="settings" />}
              />
            </Dropdown>
          </Space>
        </div>
        <MotionAlert
          visible={!!message}
          type="success"
          message={message}
          action={
            <Button
              type="text"
              size="small"
              aria-label="关闭保存提示"
              onClick={() => setMessage("")}
            >
              ×
            </Button>
          }
        />
        <MotionAlert
          visible={!!(error || lease.notice)}
          type="error"
          message={error || lease.notice}
          description="本地内容不会被其他成员的版本覆盖。"
          action={
            <Button
              onClick={() =>
                void request<Detail>(`/pages/${page.id}`)
                  .then(setLatest)
                  .catch((e) => setError(e.message))
              }
            >
              查看最新版本
            </Button>
          }
        />
        {editing && uncertain && !lease.active && (
          <Button disabled={busy} onClick={() => void save()}>
            重试上次保存
          </Button>
        )}
        {editing && !lease.active && (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (!(await lease.acquire())) return;
                const updated = await request<Detail>(
                  `/pages/${page.id}`,
                  "GET",
                  undefined,
                  AbortSignal.timeout(15000),
                );
                if (updated.current_revision_id !== base) setLatest(updated);
                setError("");
                draft.retry();
              } catch (e) {
                lease.pause((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            重新获取编辑权
          </Button>
        )}
        <MotionAlert
          visible={!!draft.candidate}
          type="info"
          message="发现可恢复的个人草稿"
          action={
            <Space>
              <Button disabled={busy} onClick={() => void enter(true)}>
                恢复个人草稿
              </Button>
              <Button
                onClick={() => {
                  if (confirm("永久丢弃个人草稿？"))
                    void draft.discard().catch((e) => setError(e.message));
                }}
              >
                放弃个人草稿
              </Button>
            </Space>
          }
        />
        <section
          className={`document-canvas ${preview ? "preview" : editing ? "editing" : "reading"}`}
          aria-label={preview ? "文档预览" : "文档正文"}
        >
          <Collapse open={writable && !preview} className="toolbar-motion">
            <EditorToolbar editor={editor} />
          </Collapse>
          <div className="document-body">
            <EditorContent editor={editor} />
            {(!editing || preview) && !hasVisibleBody(body) && (
              <span className="document-empty-hint">
                {EMPTY_DOCUMENT_MESSAGE}
              </span>
            )}
          </div>
        </section>
      </section>
      {editing && (
        <>
          <p role="status">{draft.status}</p>
          <Button onClick={draft.retry}>重试草稿同步</Button>
          <Button
            onClick={() =>
              void draft.reload().catch((e) => setError(e.message))
            }
          >
            重新读取个人草稿
          </Button>
          <details>
            <summary>复制本地内容</summary>
            <textarea
              aria-label="本地草稿副本"
              readOnly
              value={JSON.stringify({ title, body }, null, 2)}
              style={{ width: "100%", height: 120 }}
            />
          </details>
        </>
      )}
      <p role="status">
        {busy ? "正在保存…" : dirty ? "有未保存的更改" : "内容已同步"}
      </p>
      {latest && (
        <section>
          <h2>最新版本：{latest.title}</h2>
          <pre>{latest.body_text}</pre>
          <h3>你的本地内容（可选择复制）</h3>
          <textarea
            aria-label="本地内容副本"
            readOnly
            value={JSON.stringify({ title, body }, null, 2)}
            style={{ width: "100%", height: 160 }}
          />
          <Button
            disabled={!writable}
            onClick={() => {
              onSaved(latest);
              setBase(latest.current_revision_id);
              draft.retry();
              setLatest(undefined);
              setError("");
              setDirty(true);
            }}
          >
            以最新版本为基准继续编辑
          </Button>
        </section>
      )}
      <Attachments
        page={page.id}
        editor={editor}
        editing={writable}
        canEdit={page.role >= 2}
      />
    </>
  );
}
