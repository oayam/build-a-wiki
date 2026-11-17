import React from "react";
import { Alert, Button, Input, Space, Table } from "antd";
import { request } from "./session";
import type { components } from "./api.generated";
export default function Operations() {
  const [status, setStatus] =
    React.useState<components["schemas"]["SystemStatus"]>();
  const [events, setEvents] = React.useState<
    components["schemas"]["AuditRow"][]
  >([]);
  const [action, setAction] = React.useState("");
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  async function load(next?: string) {
    try {
      setStatus(
        await request<components["schemas"]["SystemStatus"]>(
          "/admin/system-status",
        ),
      );
      const p = new URLSearchParams();
      if (action) p.set("action", action);
      if (next) p.set("cursor", next);
      const r = await request<components["schemas"]["AuditList"]>(
        "/admin/audit-events?" + p,
      );
      setEvents((old) => (next ? [...old, ...r.items] : r.items));
      setCursor(r.next_cursor ?? null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  React.useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <h1>审计与系统状态</h1>
      {error && <Alert type="error" message={error} />}
      <Button onClick={() => void load()}>刷新状态</Button>
      {status && (
        <>
          <p>
            维护模式：{status.maintenance ? "开启" : "关闭"}；待处理任务：
            {status.pending_jobs}；待重试：{status.failed_jobs}
            ；附件盘可用空间：
            {status.disk_available_bytes === null
              ? "未知"
              : Math.floor((status.disk_available_bytes ?? 0) / 1024 / 1024) +
                " MiB"}
          </p>
          {status.disk_warning && (
            <Alert
              type="warning"
              message="附件磁盘空间不足1GiB或无法读取，请检查存储。"
            />
          )}
          <Table
            rowKey="id"
            pagination={false}
            dataSource={status.jobs}
            columns={[
              { title: "任务", dataIndex: "kind" },
              { title: "重试次数", dataIndex: "attempts" },
              { title: "下一次执行", dataIndex: "available_at" },
              { title: "错误", dataIndex: "last_error" },
              {
                title: "操作",
                render: (_, j) => (
                  <Button
                    onClick={() =>
                      void request(`/admin/jobs/${j.id}/retry`, "POST")
                        .then(() => load())
                        .catch((e) => setError(e.message))
                    }
                  >
                    立即重试
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      <h2>审计日志</h2>
      <Space>
        <Input
          aria-label="审计动作"
          placeholder="动作名称，如 pages.delete"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Button onClick={() => void load()}>筛选日志</Button>
      </Space>
      <Table
        rowKey="id"
        pagination={false}
        dataSource={events}
        columns={[
          { title: "时间", dataIndex: "created_at" },
          { title: "动作", dataIndex: "action" },
          { title: "操作者ID", dataIndex: "actor_id" },
          { title: "资源ID", dataIndex: "resource_id" },
        ]}
      />
      {cursor && <Button onClick={() => void load(cursor)}>更多日志</Button>}
    </>
  );
}
