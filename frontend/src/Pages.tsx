import Attachments from "./Attachments";
import React from "react";
import Icon from "./Icon";
import EditorToolbar from "./EditorToolbar";
import type { CreatePageTarget } from "./CreatePageDialog";
import { Alert, Button, Input, Form, Space, Spin, Empty } from "antd";
import {
  Link,
  NavLink,
  useParams,
  useNavigate,
  useBlocker,
} from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { components } from "./api.generated";
import { extensions } from "./editor";
import { request, useSession } from "./session";
import { useDraft } from "./useDraft";
type Detail = components["schemas"]["PageDetail"];
type List = components["schemas"]["PageList"];
type Summary = components["schemas"]["PageSummary"];
const emptyBody = { type: "doc", content: [{ type: "paragraph" }] };
export function PageTree({
  kb,
  parent,
  navigation = false,
  ancestors = [],
  onCreate,
}: {
  kb: string;
  parent?: string;
  navigation?: boolean;
  ancestors?: string[];
  onCreate?: (target: CreatePageTarget) => void;
}) {
  const [items, setItems] = React.useState<Summary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState<string[]>([]);
  async function load(next?: string) {
    const q = new URLSearchParams();
    if (parent) q.set("parent_id", parent);
    if (next) q.set("cursor", next);
    const r = await request<List>(`/knowledge-bases/${kb}/pages?${q}`);
    setItems((old) => (next ? [...old, ...r.items] : r.items));
    setCursor(r.next_cursor ?? null);
  }
  React.useEffect(() => {
    const refresh = () => {
      setError("");
      void load().catch((e) => {
        setItems([]);
        setError(e.message);
      });
    };
    refresh();
    window.addEventListener("wiki-navigation-changed", refresh);
    return () => window.removeEventListener("wiki-navigation-changed", refresh);
  }, [kb, parent]);
  const ancestorKey = ancestors.join(",");
  React.useEffect(() => {
    setOpen((old) => [...new Set([...old, ...ancestors])]);
  }, [ancestorKey]);
  return (
    <>
      {error && <Alert type="error" message={error} />}
      <ul className="page-tree">
        {items.map((p) => (
          <li key={p.id}>
            <div className="page-tree-row">
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
                  onClick={() => onCreate({ kb, parent: p.id, title: p.title })}
                >
                  <Icon name="plus" />
                </button>
              )}
            </div>
            {p.has_children && open.includes(p.id) && (
              <PageTree
                kb={kb}
                parent={p.id}
                navigation={navigation}
                ancestors={ancestors}
                onCreate={onCreate}
              />
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          onClick={() => void load(cursor).catch((e) => setError(e.message))}
        >
          加载更多页面
        </Button>
      )}
      {!items.length && !error && <p className="tree-empty">暂无可见页面</p>}
    </>
  );
}
export function LibraryPages() {
  const { id } = useParams();
  const [error, setError] = React.useState("");
  const [k, setK] = React.useState<components["schemas"]["KnowledgeBase"]>();
  const navigate = useNavigate();
  React.useEffect(() => {
    void request<components["schemas"]["KnowledgeBase"]>(
      `/knowledge-bases/${id}`,
    )
      .then(setK)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <>
      <h1>{k?.name ?? "知识库"}</h1>
      <Link to={`/knowledge-bases/${id}/permissions`}>管理权限与设置</Link>
      {error && <Alert type="error" message={error} />}
      {k && k.role >= 2 && (
        <Form
          layout="inline"
          style={{ margin: "24px 0" }}
          onFinish={async (v) => {
            try {
              const p = await request<components["schemas"]["Saved"]>(
                `/knowledge-bases/${id}/pages`,
                "POST",
                {
                  request_id: crypto.randomUUID(),
                  title: v.title,
                  schema_version: 1,
                  body: emptyBody,
                },
              );
              navigate(`/pages/${p.id}`);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <Form.Item name="title" rules={[{ required: true, max: 200 }]}>
            <Input aria-label="新页面标题" placeholder="新页面标题" />
          </Form.Item>
          <Button htmlType="submit" type="primary">
            创建页面
          </Button>
        </Form>
      )}
      {k && <PageTree kb={id!} />}
    </>
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
    editor?.setEditable(editing && !preview, false);
  }, [editor, editing, preview]);
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
    editing,
    dirty,
    { title, body, schema_version: 1, base_revision_id: base },
    localKey,
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
        /* Shared save remains available if browser storage is unavailable. */
      }
    }
  }, [title, body, dirty, localKey, page.current_revision_id]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    const value = {
      title,
      schema_version: 1,
      body,
      base_revision_id: base,
    };
    const fingerprint = JSON.stringify(value);
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, id: crypto.randomUUID() };
    try {
      await request(`/pages/${page.id}/revisions`, "POST", {
        ...value,
        request_id: retry.current.id,
      });
      setDirty(false);
      sessionStorage.removeItem(localKey);
      const updated = await request<Detail>(`/pages/${page.id}`);
      onSaved(updated);
      setBase(updated.current_revision_id);
      try {
        await draft.discard();
      } catch (e) {
        setError("共享版本已保存，但草稿清理失败：" + (e as Error).message);
      }
      setMessage("共享版本已保存");
      setEditing(false);
      setPreview(false);
      setLatest(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="document-header">
        <div className="document-heading">
          {editing && !preview ? (
            <Input
              className="document-title"
              aria-label="页面标题"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          ) : (
            <h1>{title}</h1>
          )}
          <span className={`document-badge ${editing ? "is-draft" : ""}`}>
            {editing ? (preview ? "预览" : "草稿") : "已发布"}
          </span>
        </div>
        <Space wrap className="document-actions">
          {page.role >= 2 && !editing && (
            <Button
              type="primary"
              disabled={!draft.ready || !!draft.candidate}
              onClick={() => setEditing(true)}
            >
              编辑页面
            </Button>
          )}
          {editing && (
            <>
              <Button type="primary" loading={busy} onClick={() => void save()}>
                保存共享版本
              </Button>
              <Button onClick={() => setPreview(!preview)}>
                {preview ? "继续编辑" : "预览"}
              </Button>
              <Button
                onClick={async () => {
                  if (!dirty || confirm("放弃未保存内容和个人草稿？")) {
                    try {
                      await draft.discard();
                    } catch (e) {
                      setError((e as Error).message);
                      return;
                    }
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
        </Space>
      </div>
      <div className="document-links">
        {" "}
        <Link to={`/pages/${page.id}/permissions`}>页面权限</Link>
        <Link to={`/pages/${page.id}/history`}>版本历史</Link>
        {page.role >= 3 && (
          <Link to={`/pages/${page.id}/delete`}>删除页面</Link>
        )}
        {page.role >= 3 && (
          <Link to={`/pages/${page.id}/move`}>移动与排序</Link>
        )}
      </div>
      {message && (
        <Alert
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
      )}
      {error && (
        <Alert
          type="error"
          message={error}
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
      )}
      {draft.candidate && (
        <Alert
          type="info"
          message="发现未共享的个人草稿"
          action={
            <Space>
              <Button
                onClick={() => {
                  const v = draft.restore();
                  if (v) {
                    setTitle(v.title);
                    setBody(v.body as JSONContent);
                    setBase(v.base_revision_id);
                    editor?.commands.setContent(v.body as JSONContent, {
                      emitUpdate: false,
                    });
                    setEditing(true);
                    setDirty(true);
                  }
                }}
              >
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
      )}
      <section
        className={`document-canvas ${preview ? "preview" : editing ? "editing" : "reading"}`}
        aria-label={preview ? "文档预览" : "文档正文"}
      >
        {editing && !preview && <EditorToolbar editor={editor} />}
        <EditorContent editor={editor} />
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
          <h2>最新共享版本：{latest.title}</h2>
          <pre>{latest.body_text}</pre>
          <h3>你的本地内容（可选择复制）</h3>
          <textarea
            aria-label="本地内容副本"
            readOnly
            value={JSON.stringify({ title, body }, null, 2)}
            style={{ width: "100%", height: 160 }}
          />
          <Button
            onClick={() => {
              onSaved(latest);
              setBase(latest.current_revision_id);
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
        editing={editing}
        canEdit={page.role >= 2}
      />
    </>
  );
}
