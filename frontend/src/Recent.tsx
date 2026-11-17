import React from "react";
import { Alert } from "antd";
import { Link } from "react-router-dom";
import { request } from "./session";
import type { components } from "./api.generated";
export default function Recent() {
  const [items, setItems] = React.useState<components["schemas"]["PageLink"][]>(
    [],
  );
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    void request<components["schemas"]["PageLink"][]>("/recent-visits")
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="recent-panel">
      <h2>最近访问</h2>
      {error && <Alert type="error" message={error} />}
      <ul className="recent-list">
        {items.map((p) => (
          <li key={p.id}>
            <Link to={`/pages/${p.id}`}>{p.title}</Link>
          </li>
        ))}
      </ul>
      {!items.length && !error && <p>暂无可见的访问记录</p>}
      <Link to="/shared">查看独立共享页面</Link>
    </section>
  );
}
