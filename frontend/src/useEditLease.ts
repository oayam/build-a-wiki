import React from "react";
import { request } from "./session";

// The token identifies one editing window. Never reuse it for a later edit.
export function useEditLease(page: string) {
  const path = `/pages/${page}/edit-lease`;
  const token = React.useRef<string | undefined>(undefined);
  const deadline = React.useRef(0);
  const [active, setActive] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const generation = React.useRef(0);
  const pause = React.useCallback((reason: string) => {
    generation.current++;
    deadline.current = 0;
    setActive(false);
    setNotice(reason);
  }, []);
  const release = React.useCallback(() => {
    const lease_id = token.current;
    token.current = undefined;
    deadline.current = 0;
    setActive(false);
    setNotice("");
    if (lease_id) void request(path, "DELETE", { lease_id }).catch(() => {});
  }, [path]);

  const confirm = React.useCallback(
    async (renew: boolean) => {
      const lease_id = token.current ?? crypto.randomUUID();
      token.current = lease_id;
      const start = Date.now();
      const attempt = ++generation.current;
      try {
        const seconds = await request<number>(
          path,
          "PUT",
          { lease_id, renew },
          AbortSignal.timeout(15000),
        );
        if (token.current !== lease_id) {
          void request(path, "DELETE", { lease_id }).catch(() => {});
          return false;
        }
        if (attempt !== generation.current) return false;
        deadline.current = start + seconds * 1000;
        if (Date.now() >= deadline.current || !navigator.onLine)
          throw new Error("网络连接中断，请重新获取编辑权");
        setActive(true);
        setNotice("");
        return true;
      } catch (e) {
        if (token.current === lease_id && attempt === generation.current) {
          deadline.current = 0;
          setActive(false);
          setNotice((e as Error).message);
        }
        return false;
      }
    },
    [path],
  );

  React.useEffect(() => {
    const offline = () => {
      if (!token.current) return;
      pause("网络连接中断，已暂停编辑。重连后可继续处理本地草稿。");
    };
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [release, pause]);

  React.useEffect(() => {
    if (!active) return;
    let pending = false;
    const check = () => {
      if (Date.now() >= deadline.current) {
        pause("编辑权等待续期，请重新获取编辑权");
      } else if (!pending && deadline.current - Date.now() < 60_000) {
        pending = true;
        void confirm(true).finally(() => {
          pending = false;
        });
      }
    };
    const interval = window.setInterval(check, 1000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [active, confirm, pause]);

  return {
    token,
    active,
    notice,
    pause,
    acquire: () => confirm(false),
    release,
  };
}
