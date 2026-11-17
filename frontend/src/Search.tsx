import React from "react";
import { Alert, Button, Input, Select, Space, Table } from "antd";
import { Link, useSearchParams } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
export default function Search() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [fields, setFields] = React.useState(params.get("fields") ?? "all");
  const [scope, setScope] = React.useState(params.get("scope") ?? "");
  const [relation, setRelation] = React.useState(
    params.get("relation") ?? "creator",
  );
  const [person, setPerson] = React.useState<string | undefined>(
    params.get("person_id") ?? undefined,
  );
  const [people, setPeople] = React.useState<components["schemas"]["Person"][]>(
    [],
  );
  const [items, setItems] = React.useState<
    components["schemas"]["SearchHit"][]
  >([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function load(next?: string) {
    setBusy(true);
    setError("");
    try {
      const p = new URLSearchParams(params);
      if (next) p.set("cursor", next);
      const r = await request<components["schemas"]["SearchResults"]>(
        "/search?" + p,
      );
      setItems((old) => (next ? [...old, ...r.items] : r.items));
      setCursor(r.next_cursor ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  React.useEffect(() => {
    setQ(params.get("q") ?? "");
    setFields(params.get("fields") ?? "all");
    setScope(params.get("scope") ?? "");
    setRelation(params.get("relation") ?? "creator");
    setPerson(params.get("person_id") ?? undefined);
    void load();
  }, [params]);
  async function findPeople(q: string) {
    try {
      setPeople(
        await request<components["schemas"]["Person"][]>(
          "/search/people?q=" + encodeURIComponent(q),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <h1>搜索</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams({ q, fields, relation });
          if (scope.trim()) p.set("scope", scope.trim());
          if (person) p.set("person_id", person);
          setParams(p);
        }}
      >
        <Space wrap>
          <Input
            aria-label="搜索关键词"
            placeholder="中文标题或正文"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            aria-label="搜索位置"
            value={fields}
            onChange={setFields}
            options={[
              { value: "all", label: "标题和正文" },
              { value: "title", label: "仅标题" },
              { value: "body", label: "仅正文" },
            ]}
          />
          <Input
            aria-label="搜索知识库ID"
            placeholder="知识库ID（可选）"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
          <Select
            aria-label="人员关系"
            value={relation}
            onChange={setRelation}
            options={[
              { value: "creator", label: "创建者" },
              { value: "last_editor", label: "最后编辑者" },
              { value: "contributor", label: "历史贡献者" },
              { value: "editor_access", label: "授权编辑者" },
            ]}
          />
          <Select
            aria-label="筛选人员"
            style={{ width: 180 }}
            allowClear
            showSearch
            filterOption={false}
            placeholder="输入姓名筛选"
            onSearch={(q) => void findPeople(q)}
            onFocus={() => void findPeople("")}
            value={person}
            onChange={setPerson}
            options={people.map((p) => ({
              value: p.id,
              label: p.display_name,
            }))}
          />
          <Button htmlType="submit" type="primary" loading={busy}>
            执行搜索
          </Button>
        </Space>
      </form>
      {error && <Alert type="error" message={error} />}
      <Table
        rowKey="id"
        pagination={false}
        dataSource={items}
        columns={[
          {
            title: "页面",
            render: (_, p) => <Link to={`/pages/${p.id}`}>{p.title}</Link>,
          },
          { title: "正文摘要", dataIndex: "snippet" },
        ]}
      />
      {cursor && (
        <Button loading={busy} onClick={() => void load(cursor)}>
          更多结果
        </Button>
      )}
    </>
  );
}
