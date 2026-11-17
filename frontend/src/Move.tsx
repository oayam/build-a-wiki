import React from "react";
import { Alert, Button, Input, InputNumber, Popconfirm, Space } from "antd";
import { Link, useParams, useNavigate } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
export default function Move() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [parent, setParent] = React.useState("");
  const [position, setPosition] = React.useState(0);
  const [preview, setPreview] =
    React.useState<components["schemas"]["MovePreview"]>();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function run(execute: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await request<components["schemas"]["MovePreview"]>(
        `/pages/${id}/${execute ? "move" : "move-preview"}`,
        "POST",
        {
          parent_id: parent.trim() || null,
          position,
          preview_token: execute ? preview?.preview_token : null,
        },
      );
      if (execute) navigate(`/pages/${id}`);
      else setPreview(r);
    } catch (e) {
      setError((e as Error).message);
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>移动与排序</h1>
      <Link to={`/pages/${id}`}>返回页面</Link>
      <p>
        输入同一知识库中目标父页面的网址末尾
        ID；留空表示移至库根目录。序号较小的页面排在前面，同序号按页面 ID 排序。
      </p>
      <Space direction="vertical">
        <Input
          aria-label="目标父页面ID"
          placeholder="留空表示知识库根目录"
          value={parent}
          onChange={(e) => {
            setParent(e.target.value);
            setPreview(undefined);
          }}
        />
        <InputNumber
          aria-label="排序序号"
          min={-1000000000}
          max={1000000000}
          precision={0}
          value={position}
          onChange={(n) => {
            setPosition(n ?? 0);
            setPreview(undefined);
          }}
        />
        <Button loading={busy} onClick={() => void run(false)}>
          预览移动影响
        </Button>
      </Space>
      {error && <Alert type="error" message={error} />}
      {preview && (
        <>
          <Alert
            type="warning"
            message={`将移动 ${preview.affected_pages} 个页面，其中 ${preview.inherited_pages} 个页面将继承目标位置的权限。`}
            description={preview.notice}
          />
          <Popconfirm
            title="确认移动并应用上述权限变化？"
            onConfirm={() => void run(true)}
          >
            <Button loading={busy} type="primary">
              确认移动
            </Button>
          </Popconfirm>
        </>
      )}
    </>
  );
}
