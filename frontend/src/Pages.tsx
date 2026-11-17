import React from "react";
import { Alert, Button, Input, Form, Space, Spin, Empty } from "antd";
import { Link, useParams, useNavigate, useBlocker } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import type { components } from "./api.generated";
import { extensions } from "./editor";
import { request, useSession } from "./session";
type Detail = components["schemas"]["PageDetail"];
type List = components["schemas"]["PageList"];
type Summary = components["schemas"]["PageSummary"];
const emptyBody = { type: "doc", content: [{ type: "paragraph" }] };
export function PageTree({ kb, parent }: { kb: string; parent?: string }) {
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
    void load().catch((e) => setError(e.message));
  }, [kb, parent]);
  return (
    <>
      {error && <Alert type="error" message={error} />}
      <ul className="page-tree">
        {items.map((p) => (
          <li key={p.id}>
            <Space>
              {p.has_children && (
                <Button
                  size="small"
                  aria-label={`展开-${p.title}`}
                  onClick={() =>
                    setOpen(
                      open.includes(p.id)
                        ? open.filter((x) => x !== p.id)
                        : [...open, p.id],
                    )
                  }
                >
                  {open.includes(p.id) ? "−" : "+"}
                </Button>
              )}
              <Link to={`/pages/${p.id}`}>{p.title}</Link>
            </Space>
            {open.includes(p.id) && <PageTree kb={kb} parent={p.id} />}
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
      {!items.length && !error && <p>暂无可见页面</p>}
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
      .then(setData)
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
  const navigate = useNavigate();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(page.title);
  const [body, setBody] = React.useState<JSONContent>(page.body as JSONContent);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
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
    editor?.setEditable(editing && !preview);
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
  React.useEffect(() => {
    if (dirty) {
      try {
        sessionStorage.setItem(
          localKey,
          JSON.stringify({
            title,
            body,
            base_revision_id: page.current_revision_id,
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
      base_revision_id: page.current_revision_id,
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
      setMessage("共享版本已保存");
      setEditing(false);
      setLatest(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <nav className="breadcrumbs">
        {page.breadcrumbs.map((p) => (
          <Link key={p.id} to={`/pages/${p.id}`}>
            {p.title} /{" "}
          </Link>
        ))}
      </nav>
      {editing ? (
        <Input
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
      <Space wrap style={{ margin: "16px 0" }}>
        <Link to={`/pages/${page.id}/permissions`}>页面权限</Link>
        {page.role >= 2 && !editing && (
          <Button onClick={() => setEditing(true)}>编辑页面</Button>
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
              onClick={() => {
                if (!dirty || confirm("放弃未保存内容？")) {
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
      {message && <Alert type="success" message={message} />}
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
      {editing && !preview && (
        <div className="toolbar">
          <Button onClick={() => editor?.chain().focus().toggleBold().run()}>
            粗体
          </Button>
          <Button
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            标题
          </Button>
          <Button
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            列表
          </Button>
          <Button
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            代码
          </Button>
          <Button
            onClick={() =>
              editor
                ?.chain()
                .focus()
                .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
                .run()
            }
          >
            表格
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
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
              setLatest(undefined);
              setError("");
              setDirty(true);
            }}
          >
            以最新版本为基准继续编辑
          </Button>
        </section>
      )}
      {page.role >= 2 && (
        <Form
          layout="inline"
          style={{ marginTop: 24 }}
          onFinish={async (v) => {
            try {
              const p = await request<components["schemas"]["Saved"]>(
                `/knowledge-bases/${page.knowledge_base_id}/pages`,
                "POST",
                {
                  request_id: crypto.randomUUID(),
                  parent_id: page.id,
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
            <Input aria-label="子页面标题" placeholder="子页面标题" />
          </Form.Item>
          <Button htmlType="submit">创建子页面</Button>
        </Form>
      )}
      <h2>子页面</h2>
      <PageTree kb={page.knowledge_base_id} parent={page.id} />
    </>
  );
}
