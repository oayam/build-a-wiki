import React from "react";
import Icon from "./Icon";
import { Alert, Button, Input, Space, Table } from "antd";
import { request } from "./session";
import type { components } from "./api.generated";
const STATUS_TEXT = {
  SUMMARY: "系统运行概览",
  MAINTENANCE: "维护模式",
  MAINTENANCE_ON: "已开启",
  MAINTENANCE_OFF: "已关闭",
  PENDING: "待处理任务",
  RETRY: "待重试任务",
  STORAGE: "附件可用空间",
  TASK_UNIT: "项",
  UNKNOWN: "暂不可用",
  DISK_WARNING: "附件磁盘空间不足 1 GiB 或无法读取，请检查存储。",
} as const;
const STATUS_ICONS = {
  MAINTENANCE: "settings",
  PENDING: "history",
  RETRY: "undo",
  STORAGE: "folder",
} as const;
const BYTES_PER_MIB = 1024 ** 2;
const BYTES_PER_GIB = 1024 ** 3;
const STORAGE_UNITS = { MIB: "MiB", GIB: "GiB" } as const;
const STORAGE_FORMAT = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 1,
});
const COUNT_FORMAT = new Intl.NumberFormat("zh-CN");
const EMPTY_COUNT = 0;
function storageValue(bytes: number | null | undefined) {
  if (bytes == null) return { value: STATUS_TEXT.UNKNOWN, unit: "" };
  const gib = bytes >= BYTES_PER_GIB;
  return {
    value: STORAGE_FORMAT.format(bytes / (gib ? BYTES_PER_GIB : BYTES_PER_MIB)),
    unit: gib ? STORAGE_UNITS.GIB : STORAGE_UNITS.MIB,
  };
}
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
  const storage = storageValue(status?.disk_available_bytes);
  return (
    <>
      <h1>审计与系统状态</h1>
      {error && <Alert type="error" message={error} />}
      <Button onClick={() => void load()}>刷新状态</Button>
      {status && (
        <>
          <section
            aria-label={STATUS_TEXT.SUMMARY}
            className="system-status-summary"
          >
            <dl className="system-status-grid">
              <div
                className={`system-status-card ${status.maintenance ? "is-warning" : "is-normal"}`}
              >
                <dt>
                  <span className="system-status-icon">
                    <Icon name={STATUS_ICONS.MAINTENANCE} />
                  </span>
                  {STATUS_TEXT.MAINTENANCE}
                </dt>
                <dd>
                  <span className="system-status-badge">
                    <span aria-hidden="true" className="system-status-dot" />
                    {status.maintenance
                      ? STATUS_TEXT.MAINTENANCE_ON
                      : STATUS_TEXT.MAINTENANCE_OFF}
                  </span>
                </dd>
              </div>
              <div className="system-status-card">
                <dt>
                  <span className="system-status-icon">
                    <Icon name={STATUS_ICONS.PENDING} />
                  </span>
                  {STATUS_TEXT.PENDING}
                </dt>
                <dd>
                  {COUNT_FORMAT.format(status.pending_jobs)}
                  <span className="system-status-unit">
                    {STATUS_TEXT.TASK_UNIT}
                  </span>
                </dd>
              </div>
              <div
                className={`system-status-card ${status.failed_jobs > EMPTY_COUNT ? "is-warning" : ""}`}
              >
                <dt>
                  <span className="system-status-icon">
                    <Icon name={STATUS_ICONS.RETRY} />
                  </span>
                  {STATUS_TEXT.RETRY}
                </dt>
                <dd>
                  {COUNT_FORMAT.format(status.failed_jobs)}
                  <span className="system-status-unit">
                    {STATUS_TEXT.TASK_UNIT}
                  </span>
                </dd>
              </div>
              <div
                className={`system-status-card ${status.disk_warning ? "is-warning" : ""}`}
              >
                <dt>
                  <span className="system-status-icon">
                    <Icon name={STATUS_ICONS.STORAGE} />
                  </span>
                  {STATUS_TEXT.STORAGE}
                </dt>
                <dd>
                  {storage.value}
                  <span className="system-status-unit">{storage.unit}</span>
                </dd>
              </div>
            </dl>
          </section>
          {status.disk_warning && (
            <Alert type="warning" message={STATUS_TEXT.DISK_WARNING} />
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
