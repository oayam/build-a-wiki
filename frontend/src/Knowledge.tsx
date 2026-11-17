import React from "react";
import Icon from "./Icon";
import {
  Alert,
  Button,
  Form,
  Input,
  Select,
  Table,
  Space,
  Popconfirm,
  Spin,
} from "antd";
import { Link, useParams } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
type K = components["schemas"]["KnowledgeBase"];
type P = components["schemas"]["Permissions"];
type E = components["schemas"]["Entry"];
type S = components["schemas"]["Subject"];
export function Libraries() {
  const [items, setItems] = React.useState<K[]>([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [cursor, setCursor] = React.useState<string | null>(null);
  async function load(next?: string) {
    const r = await request<components["schemas"]["KnowledgeList"]>(
      "/knowledge-bases" + (next ? "?cursor=" + next : ""),
    );
    setItems((old) => (next ? [...old, ...r.items] : r.items));
    setCursor(r.next_cursor ?? null);
  }
  React.useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">团队工作区</span>
        <h1>我的知识库</h1>
        <p>让知识有序，让协作更简单。创建、整理并分享团队的每一份经验。</p>
      </div>
      {error && <Alert type="error" message={error} />}
      <Form
        layout="inline"
        onFinish={async (v) => {
          setBusy(true);
          setError("");
          try {
            await request("/knowledge-bases", "POST", v);
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Form.Item name="name" rules={[{ required: true, max: 100 }]}>
          <Input aria-label="知识库名称" placeholder="知识库名称" />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={busy}>
          新建私有知识库
        </Button>
      </Form>
      <Table
        className="library-table"
        rowKey="id"
        dataSource={items}
        pagination={false}
        locale={{ emptyText: "还没有可访问的知识库" }}
        columns={[
          {
            title: "知识库",
            render: (_, k) => (
              <Link className="library-link" to={`/knowledge-bases/${k.id}`}>
                <span className="library-icon">
                  <Icon name="folder" />
                </span>
                {k.name}
              </Link>
            ),
          },
          {
            title: "我的权限",
            render: (_, k) => ["无权", "查看者", "编辑者", "管理员"][k.role],
          },
        ]}
      />
      {cursor && (
        <Button
          onClick={() => void load(cursor).catch((e) => setError(e.message))}
        >
          加载更多
        </Button>
      )}
    </>
  );
}
export function PermissionPanel({ page = false }: { page?: boolean }) {
  const { id } = useParams();
  const base = page ? `/pages/${id}` : `/knowledge-bases/${id}`;
  const [data, setData] = React.useState<P>();
  const [entries, setEntries] = React.useState<E[]>([]);
  const [subjects, setSubjects] = React.useState<S[]>([]);
  const [mode, setMode] = React.useState("inherit");
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [k, setK] = React.useState<K>();
  async function load() {
    const p = await request<P>(base + "/permissions");
    setData(p);
    setEntries(p.entries ?? []);
    setMode(p.acl_mode);
    if (p.role === 3) setSubjects(await request<S[]>(base + "/subjects"));
    else setSubjects([]);
    if (!page) setK(await request<K>(base));
  }
  React.useEffect(() => {
    setData(undefined);
    setError("");
    void load().catch((e) => setError(e.message));
  }, [base]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      await load();
      setSuccess("操作成功");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const names = new Map(subjects.map((s) => [s.id, s.name]));
  return (
    <>
      <h1>{page ? "页面权限" : (k?.name ?? "知识库权限")}</h1>
      {error && (
        <Alert
          type="error"
          message={error}
          action={<Button onClick={() => void act(load)}>重新加载</Button>}
        />
      )}
      {success && <Alert type="success" message={success} />}
      {!data && !error && <Spin />}
      {data && (
        <>
          <p>
            当前角色：{["无权", "查看者", "编辑者", "管理员"][data.role]} ·
            来源：{data.source}
          </p>
          {data.role === 3 && (
            <>
              {page && (
                <Select
                  aria-label="授权模式"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "inherit", label: "继承权限" },
                    { value: "independent", label: "独立授权（替换继承）" },
                  ]}
                />
              )}
              <Table
                rowKey={(e) => e.user_id ?? e.group_id!}
                dataSource={entries}
                pagination={false}
                columns={[
                  {
                    title: "授权对象",
                    render: (_, e) =>
                      (e.group_id ? "组：" : "用户：") +
                      (names.get(e.user_id ?? e.group_id!) ?? "未知对象"),
                  },
                  {
                    title: "角色",
                    render: (_, e) => (
                      <Select
                        aria-label={`角色-${names.get(e.user_id ?? e.group_id!)}`}
                        value={e.role}
                        onChange={(role) =>
                          setEntries(
                            entries.map((x) => (x === e ? { ...x, role } : x)),
                          )
                        }
                        options={[
                          { value: 1, label: "查看者" },
                          { value: 2, label: "编辑者" },
                          { value: 3, label: "管理员" },
                        ]}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    render: (_, e) => (
                      <Button
                        onClick={() =>
                          setEntries(entries.filter((x) => x !== e))
                        }
                      >
                        移除授权
                      </Button>
                    ),
                  },
                ]}
              />
              <Select
                aria-label="添加授权对象"
                placeholder="添加用户或组"
                style={{ width: 260 }}
                value={null}
                onChange={(value) => {
                  const subject = subjects.find((s) => s.id === value)!;
                  if (!entries.some((e) => (e.user_id ?? e.group_id) === value))
                    setEntries([
                      ...entries,
                      {
                        user_id: subject.kind === "user" ? value : null,
                        group_id: subject.kind === "group" ? value : null,
                        role: 1,
                      },
                    ]);
                }}
                options={subjects.map((s) => ({
                  value: s.id,
                  label: (s.kind === "group" ? "组：" : "用户：") + s.name,
                }))}
              />
              <Space style={{ margin: 16 }}>
                <Popconfirm
                  title="保存将立即改变成员访问权限，确认？"
                  onConfirm={() =>
                    act(() =>
                      request(base + "/permissions", "PUT", {
                        acl_version: data.acl_version,
                        acl_mode: page ? mode : "independent",
                        entries,
                      }),
                    )
                  }
                >
                  <Button type="primary" loading={busy}>
                    保存权限
                  </Button>
                </Popconfirm>
                <Button onClick={() => void act(load)}>重新加载权限</Button>
              </Space>
              {!page && (
                <>
                  <h2>知识库设置</h2>
                  <Form
                    layout="inline"
                    onFinish={(v) => void act(() => request(base, "PATCH", v))}
                  >
                    <Form.Item
                      name="name"
                      rules={[{ required: true, max: 100 }]}
                    >
                      <Input
                        aria-label="新的知识库名称"
                        placeholder="新的知识库名称"
                      />
                    </Form.Item>
                    <Button htmlType="submit" loading={busy}>
                      修改名称
                    </Button>
                  </Form>
                  <h2>转让所有权</h2>
                  <p>
                    仅所有者或系统管理员可执行。转让后原所有者仅保留显式授权。
                  </p>
                  <Form
                    layout="inline"
                    onFinish={(v) =>
                      void act(() =>
                        request(base + "/transfer-ownership", "POST", v),
                      )
                    }
                  >
                    <Form.Item name="owner_id" rules={[{ required: true }]}>
                      <Select
                        aria-label="新所有者"
                        style={{ width: 240 }}
                        options={subjects
                          .filter((s) => s.kind === "user")
                          .map((s) => ({ value: s.id, label: s.name }))}
                      />
                    </Form.Item>
                    <Button htmlType="submit" loading={busy}>
                      确认转让所有权
                    </Button>
                  </Form>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
