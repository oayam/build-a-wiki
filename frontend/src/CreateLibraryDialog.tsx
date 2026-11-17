import React from "react";
import { useReducedMotion, notifyCreatedNode } from "./Motion";
import { Alert, Form, Input, Modal } from "antd";
import { useNavigate } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";

export default function CreateLibraryDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const reduced = useReducedMotion();
  const close = () => {
    if (reduced) onClose();
    else setVisible(false);
  };
  const [visible, setVisible] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const navigate = useNavigate();
  async function create({ name }: { name: string }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const library = await request<components["schemas"]["KnowledgeBase"]>(
        "/knowledge-bases",
        "POST",
        { name: name.trim() },
      );
      close();
      notifyCreatedNode(library.id, "library");
      navigate(`/knowledge-bases/${library.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={visible}
      afterClose={onClose}
      transitionName="wiki-dialog"
      maskTransitionName="wiki-mask"
      title="新建知识库"
      okText="确认创建知识库"
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
      <p className="create-page-location">
        新知识库默认仅你可访问，之后可在权限设置中添加成员。
      </p>
      {error && <Alert type="error" message={error} />}
      <Form form={form} layout="vertical" onFinish={create}>
        <Form.Item
          label="知识库名称"
          name="name"
          rules={[
            {
              required: true,
              whitespace: true,
              max: 100,
              message: "请输入 1～100 个字符的知识库名称",
            },
          ]}
        >
          <Input
            autoFocus
            aria-label="新建知识库名称"
            placeholder="为团队的知识空间命名"
            disabled={busy}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
