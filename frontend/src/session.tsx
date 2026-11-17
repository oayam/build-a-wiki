import React from "react";
import Icon from "./Icon";
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
  if (
    method !== "GET" &&
    /^\/(knowledge-bases|pages)(\/|$)/.test(path) &&
    !/\/(draft|visit)/.test(path)
  )
    window.dispatchEvent(new Event("wiki-navigation-changed"));
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
      <main className="login-page">
        <div className="login-brand">
          <Icon name="book" /> Build-a-Wiki
        </div>
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
    <Space className="account">
      <span className="avatar" aria-hidden="true">
        {user.display_name.slice(0, 1).toUpperCase()}
      </span>
      <span className="account-name">{user.display_name}</span>
      <Button onClick={() => void logout().catch((e) => setError(e.message))}>
        退出
      </Button>
      {error && <span role="alert">{error}</span>}
    </Space>
  );
}

export function uploadFile(
  path: string,
  file: File,
  progress: (n: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1" + path);
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("上传中断，请重试"));
    xhr.timeout = 130000;
    xhr.ontimeout = () => reject(new Error("上传超时，请重试"));
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("上传响应无效"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.message ?? "上传失败"));
    };
    xhr.send(file);
  });
}
