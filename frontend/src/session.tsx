import React from "react";
import { Alert, Button, Input, Form, Spin, Space } from "antd";
import type { components } from "./api.generated";
type Actor = components["schemas"]["Actor"];
let csrf = "";
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "网络请求失败" }));
    if (response.status === 401)
      window.dispatchEvent(new Event("wiki-session-expired"));
    throw new Error(error.message ?? "请求失败");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
const Session = React.createContext<{
  user: Actor;
  logout: () => Promise<void>;
} | null>(null);
export function useSession() {
  return React.useContext(Session)!;
}
export function SessionGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<Actor | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    const expired = () => {
      csrf = "";
      setUser(null);
      setError("会话已过期，请重新登录；当前导航位置已保留。");
    };
    window.addEventListener("wiki-session-expired", expired);
    request<Actor>("/me")
      .then((u) => {
        if (mounted) {
          csrf = u.csrf_token;
          setUser(u);
          setError("");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      window.removeEventListener("wiki-session-expired", expired);
    };
  }, []);
  async function login(v: { username: string; password: string }) {
    setBusy(true);
    setError("");
    try {
      const u = await request<Actor>("/auth/login", "POST", v);
      csrf = u.csrf_token;
      setUser(u);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main>
        <Spin /> 正在恢复会话…
      </main>
    );
  if (!user)
    return (
      <main style={{ maxWidth: 460, margin: "10vh auto" }}>
        <h1>登录团队知识库</h1>
        <p>使用管理员为你创建的账号。</p>
        {error && <Alert type="error" message={error} />}
        <Form layout="vertical" onFinish={login}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            登录
          </Button>
        </Form>
      </main>
    );
  return (
    <Session.Provider
      value={{
        user,
        logout: async () => {
          await request("/auth/logout", "POST", {});
          csrf = "";
          setUser(null);
        },
      }}
    >
      {children}
    </Session.Provider>
  );
}
export function Account() {
  const { user, logout } = useSession();
  const [error, setError] = React.useState("");
  return (
    <Space>
      {user.display_name}
      <Button onClick={() => void logout().catch((e) => setError(e.message))}>
        退出
      </Button>
      {error && <span role="alert">{error}</span>}
    </Space>
  );
}
