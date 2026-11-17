import React from "react";
import { Alert, Button, Input, Popconfirm, Table } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
export function DeletePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [preview, setPreview] =
    React.useState<components["schemas"]["DeletePreview"]>();
  const [error, setError] = React.useState("");
  return (
    <>
      <h1>删除页面子树</h1>
      <Link to={`/pages/${id}`}>返回页面</Link>
      {error && <Alert type="error" message={error} />}
      <Button
        onClick={() =>
          void request<components["schemas"]["DeletePreview"]>(
            `/pages/${id}/delete-preview`,
            "POST",
          )
            .then(setPreview)
            .catch((e) => setError(e.message))
        }
      >
        预览删除影响
      </Button>
      {preview && (
        <>
          <p>
            本次将删除 {preview.affected_pages}{" "}
            个页面，30天内可在回收站恢复。此前单独删除的页面不属于本批次。
          </p>
          <Popconfirm
            title="确认将这棵子树移入回收站？"
            onConfirm={() =>
              void request(`/pages/${id}`, "DELETE", {
                preview_token: preview.preview_token,
              })
                .then(() => navigate("/trash"))
                .catch((e) => {
                  setError(e.message);
                  setPreview(undefined);
                })
            }
          >
            <Button danger>确认删除</Button>
          </Popconfirm>
        </>
      )}
    </>
  );
}
export default function Trash() {
  const [rows, setRows] = React.useState<components["schemas"]["TrashItem"][]>(
    [],
  );
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [parent, setParent] = React.useState("");
  const [error, setError] = React.useState("");
  async function load(next?: string) {
    const r = await request<components["schemas"]["TrashList"]>(
      "/trash" + (next ? "?cursor=" + next : ""),
    );
    setRows((old) => (next ? [...old, ...r.items] : r.items));
    setCursor(r.next_cursor ?? null);
  }
  React.useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <h1>回收站</h1>
      <p>
        仅显示当前能管理完整批次的页面。恢复会保留当前授权，30天后自动永久清理。
      </p>
      <Input
        aria-label="恢复目标父页面ID"
        placeholder="恢复到此父页面，留空表示原知识库根目录"
        value={parent}
        onChange={(e) => setParent(e.target.value)}
      />
      {error && <Alert type="error" message={error} />}
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "标题", dataIndex: "title" },
          { title: "页数", dataIndex: "affected_pages" },
          { title: "删除时间", dataIndex: "deleted_at" },
          {
            title: "操作",
            render: (_, r) => (
              <Popconfirm
                title="确认恢复此批次到指定位置？"
                onConfirm={() =>
                  void request(`/pages/${r.root_id}/restore`, "POST", {
                    parent_id: parent.trim() || null,
                  })
                    .then(() => load())
                    .catch((e) => setError(e.message))
                }
              >
                <Button>恢复页面</Button>
              </Popconfirm>
            ),
          },
        ]}
      />
      {cursor && (
        <Button
          onClick={() => void load(cursor).catch((e) => setError(e.message))}
        >
          更多批次
        </Button>
      )}
    </>
  );
}
