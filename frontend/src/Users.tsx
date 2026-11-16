// TODO(SEC-001): 恢复12字符校验及提示，见 docs/TODO.md。
import React from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Select,
  Table,
  Space,
  Popconfirm,
} from "antd";
import { request } from "./session";
import type { components } from "./api.generated";
type User = components["schemas"]["User"];
type Group = components["schemas"]["Group"];
export default function Users() {
  const [users, setUsers] = React.useState<User[]>([]);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [group, setGroup] = React.useState<string>();
  const [members, setMembers] = React.useState<User[]>([]);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function refresh() {
    setUsers(await request<User[]>("/admin/users"));
    setGroups(await request<Group[]>("/admin/groups"));
  }
  React.useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  React.useEffect(() => {
    if (group)
      void request<User[]>(`/admin/groups/${group}/members`)
        .then(setMembers)
        .catch((e) => setError(e.message));
  }, [group]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      await refresh();
      if (group)
        setMembers(await request<User[]>(`/admin/groups/${group}/members`));
      setSuccess("操作成功");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>账号与用户组</h1>
      {error && <Alert type="error" message={error} />}
      {success && <Alert type="success" message={success} />}
      <h2>创建账号</h2>
      <Form
        layout="inline"
        onFinish={(v) => void act(() => request("/admin/users", "POST", v))}
      >
        <Form.Item name="username" rules={[{ required: true }]}>
          <Input aria-label="新账号用户名" placeholder="用户名" />
        </Form.Item>
        <Form.Item name="display_name" rules={[{ required: true }]}>
          <Input aria-label="显示名称" placeholder="显示名称" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
          <Input.Password
            aria-label="初始密码"
            placeholder="至少8字符（临时）的初始密码"
          />
        </Form.Item>
        <Button htmlType="submit" loading={busy}>
          创建账号
        </Button>
      </Form>
      <Table
        rowKey="id"
        dataSource={users}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "用户名", dataIndex: "username" },
          { title: "显示名称", dataIndex: "display_name" },
          {
            title: "角色",
            render: (_, u) => (u.is_system_admin ? "系统管理员" : "普通成员"),
          },
          { title: "状态", render: (_, u) => (u.active ? "启用" : "停用") },
          {
            title: "操作",
            render: (_, u) => (
              <Space>
                <Popconfirm
                  title={
                    u.active ? "停用将使所有会话失效，确认？" : "启用该账号？"
                  }
                  onConfirm={() =>
                    act(() =>
                      request(`/admin/users/${u.id}`, "PATCH", {
                        ...u,
                        active: !u.active,
                      }),
                    )
                  }
                >
                  <Button disabled={busy}>{u.active ? "停用" : "启用"}</Button>
                </Popconfirm>
                <Popconfirm
                  title="更改系统管理员角色并撤销会话？"
                  onConfirm={() =>
                    act(() =>
                      request(`/admin/users/${u.id}`, "PATCH", {
                        ...u,
                        is_system_admin: !u.is_system_admin,
                      }),
                    )
                  }
                >
                  <Button disabled={busy}>
                    {u.is_system_admin ? "降为成员" : "设为管理员"}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <h2>重置密码</h2>
      <Form
        layout="inline"
        onFinish={(v) =>
          void act(() =>
            request(`/admin/users/${v.id}/reset-password`, "POST", {
              password: v.password,
            }),
          )
        }
      >
        <Form.Item name="id" rules={[{ required: true }]}>
          <Select
            aria-label="重置密码账号"
            style={{ width: 180 }}
            options={users.map((u) => ({ value: u.id, label: u.username }))}
          />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, min: 8 }]}>
          <Input.Password
            aria-label="新密码"
            placeholder="新密码（至少8字符（临时））"
          />
        </Form.Item>
        <Button htmlType="submit" loading={busy}>
          重置并撤销旧会话
        </Button>
      </Form>
      <h2>用户组</h2>
      <Form
        layout="inline"
        onFinish={(v) => void act(() => request("/admin/groups", "POST", v))}
      >
        <Form.Item name="name" rules={[{ required: true }]}>
          <Input aria-label="用户组名称" placeholder="用户组名称" />
        </Form.Item>
        <Button htmlType="submit" loading={busy}>
          创建用户组
        </Button>
      </Form>
      <Select
        aria-label="选择用户组"
        placeholder="选择用户组"
        style={{ width: 240, margin: "20px 0" }}
        value={group}
        onChange={setGroup}
        options={groups.map((g) => ({ value: g.id, label: g.name }))}
      />
      {group && (
        <>
          <Form
            layout="inline"
            onFinish={(v) =>
              void act(() =>
                request(`/admin/groups/${group}/members/${v.user}`, "PUT", {}),
              )
            }
          >
            <Form.Item name="user" rules={[{ required: true }]}>
              <Select
                aria-label="添加组成员"
                style={{ width: 200 }}
                options={users
                  .filter((u) => u.active)
                  .map((u) => ({ value: u.id, label: u.username }))}
              />
            </Form.Item>
            <Button htmlType="submit" loading={busy}>
              添加成员
            </Button>
          </Form>
          <Table
            rowKey="id"
            dataSource={members}
            columns={[
              { title: "成员", dataIndex: "username" },
              {
                title: "操作",
                render: (_, u) => (
                  <Popconfirm
                    title="移除成员将立即撤销其组权限，确认？"
                    onConfirm={() =>
                      act(() =>
                        request(
                          `/admin/groups/${group}/members/${u.id}`,
                          "DELETE",
                        ),
                      )
                    }
                  >
                    <Button>移除成员</Button>
                  </Popconfirm>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
