import React from "react";
import { useDialogFocusReturn } from "./useDialogFocusReturn";
import { notifyCreatedNode } from "./Motion";
import { Alert, Form, Input, Modal } from "antd";
import { useNavigate } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
export type CreatePageTarget = { kb: string; parent?: string; title: string };
export default function CreatePageDialog({
  target,
  onClose,
}: {
  target: CreatePageTarget;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const restoreFocus = useDialogFocusReturn();
  const close = () => setVisible(false);
  const [visible, setVisible] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const attempt = React.useRef<{ title: string; id: string } | undefined>(
    undefined,
  );
  const navigate = useNavigate();
  async function create({ title }: { title: string }) {
    if (busy) return;
    setBusy(true);
    setError("");
    const name = title.trim();
    if (attempt.current?.title !== name)
      attempt.current = { title: name, id: crypto.randomUUID() };
    try {
      const saved = await request<components["schemas"]["Saved"]>(
        `/knowledge-bases/${target.kb}/pages`,
        "POST",
        {
          request_id: attempt.current.id,
          parent_id: target.parent,
          title: name,
          schema_version: 1,
          body: { type: "doc", content: [{ type: "paragraph" }] },
        },
      );
      close();
      notifyCreatedNode(saved.id, "page");
      navigate(`/pages/${saved.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={visible}
      focusTriggerAfterClose={false}
      afterClose={() => {
        restoreFocus();
        onClose();
      }}
      transitionName="wiki-dialog"
      maskTransitionName="wiki-mask"
      title={target.parent ? "创建子页面" : "创建页面"}
      okText="确认创建"
      cancelText="取消"
      confirmLoading={busy}
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      onCancel={() => {
        if (!busy) close();
      }}
      onOk={() => form.submit()}
    >
      <p className="create-page-location">创建位置：{target.title}</p>
      {error && <Alert type="error" message={error} />}
      <Form form={form} layout="vertical" onFinish={create}>
        <Form.Item
          label="页面标题"
          name="title"
          rules={[
            {
              required: true,
              whitespace: true,
              max: 200,
              message: "请输入 1～200 个字符的页面标题",
            },
          ]}
        >
          <Input
            autoFocus
            aria-label="新建页面标题"
            placeholder="为新页面起一个名字"
            disabled={busy}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
