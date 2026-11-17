import React from "react";
import { Alert, Button, Table, Popconfirm, Spin } from "antd";
import { Link, useParams } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
type Detail = components["schemas"]["PageDetail"];
type Rev = components["schemas"]["Revision"];
type Row = components["schemas"]["RevisionSummary"];
export default function History() {
  const { id } = useParams();
  const [current, setCurrent] = React.useState<Detail>();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [selected, setSelected] = React.useState<Rev>();
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const attempt = React.useRef<
    { source: string; base: string; key: string } | undefined
  >(undefined);
  async function load(next?: number) {
    const r = await request<components["schemas"]["Revisions"]>(
      `/pages/${id}/revisions` + (next ? "?cursor=" + next : ""),
    );
    setRows((old) => (next ? [...old, ...r.items] : r.items));
    setCursor(r.next_cursor ?? null);
    setCurrent(await request<Detail>(`/pages/${id}`));
  }
  React.useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [id]);
  async function restore() {
    if (!selected || !current) return;
    setBusy(true);
    setError("");
    if (
      attempt.current?.source !== selected.id ||
      attempt.current.base !== current.current_revision_id
    )
      attempt.current = {
        source: selected.id,
        base: current.current_revision_id,
        key: crypto.randomUUID(),
      };
    try {
      await request(`/pages/${id}/restore-revision`, "POST", {
        request_id: attempt.current.key,
        base_revision_id: current.current_revision_id,
        revision_id: selected.id,
      });
      await load();
      setMessage(
        "已恢复为新的共享版本；个人草稿仍保留，打开编辑页时可选择恢复或丢弃。",
      );
      setSelected(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>版本历史：{current?.title}</h1>
      <Link to={`/pages/${id}`}>返回页面</Link>
      {error && (
        <Alert
          type="error"
          message={error}
          action={
            <Button
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              重新加载历史
            </Button>
          }
        />
      )}
      {message && <Alert type="success" message={message} />}
      {!current && !error && <Spin />}
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "版本", dataIndex: "revision_no" },
          { title: "标题", dataIndex: "title" },
          {
            title: "时间",
            render: (_, r) => new Date(r.created_at).toLocaleString(),
          },
          { title: "说明", dataIndex: "summary" },
          { title: "编辑者ID", dataIndex: "editor_id" },
          {
            title: "操作",
            render: (_, r) => (
              <Button
                aria-label={`查看版本${r.revision_no}`}
                onClick={() =>
                  void request<Rev>(`/pages/${id}/revisions/${r.id}`)
                    .then(setSelected)
                    .catch((e) => setError(e.message))
                }
              >
                查看版本
              </Button>
            ),
          },
        ]}
      />
      {cursor && (
        <Button
          onClick={() => void load(cursor).catch((e) => setError(e.message))}
        >
          更多版本
        </Button>
      )}
      {selected && (
        <section>
          <h2>
            历史版本 {selected.revision_no}：{selected.title}
          </h2>
          <div className="version-compare">
            <div>
              <h3>选择的历史正文</h3>
              <pre>{selected.body_text}</pre>
            </div>
            <div>
              <h3>当前共享正文</h3>
              <pre>{current?.body_text}</pre>
            </div>
          </div>
          {current && current.role >= 2 && (
            <Popconfirm
              title="将标题和正文恢复为新版本，权限保持不变，确认？"
              onConfirm={() => void restore()}
            >
              <Button type="primary" loading={busy}>
                恢复此版本
              </Button>
            </Popconfirm>
          )}
        </section>
      )}
    </>
  );
}
