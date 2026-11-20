import React from "react";
import { request } from "./session";
import type { components } from "./api.generated";
type Draft = components["schemas"]["Draft"];
type State = components["schemas"]["DraftState"];
function preferredDraft(localKey: string, state: State): Draft | null {
  try {
    const value = sessionStorage.getItem(localKey);
    if (value) return JSON.parse(value) as Draft;
  } catch {
    /* Use the server copy when local storage is unavailable. */
  }
  return state.draft ?? null;
}

export function useDraft(
  page: string,
  enabled: boolean,
  editing: boolean,
  dirty: boolean,
  snapshot: Draft,
  localKey: string,
  leaseId: string | undefined,
) {
  const [candidate, setCandidate] = React.useState<Draft | null>(null);
  const [ready, setReady] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [paused, setPaused] = React.useState(false);
  const version = React.useRef(0);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const generation = React.useRef(0);
  React.useEffect(() => {
    if (!enabled) return;
    let active = true;
    void request<State>(`/pages/${page}/draft`)
      .then((r) => {
        if (!active) return;
        version.current = r.draft_version;
        setCandidate(preferredDraft(localKey, r));
        setReady(true);
      })
      .catch((e) => {
        if (active) {
          setStatus("草稿读取失败：" + e.message);
          setPaused(true);
        }
      });
    return () => {
      active = false;
    };
  }, [page, enabled, localKey]);
  const serialized = JSON.stringify(snapshot);
  React.useEffect(() => {
    generation.current++;
    const gen = generation.current;
    if (!enabled || !ready || !editing || !dirty || candidate || paused) return;
    setStatus("等待自动保存个人草稿…");
    const timer = setTimeout(() => {
      if (gen !== generation.current) return;
      setStatus("正在保存个人草稿…");
      queue.current = queue.current
        .then(async () => {
          if (gen !== generation.current) return;
          const r = await request<State>(
            `/pages/${page}/draft`,
            "PUT",
            {
              ...JSON.parse(serialized),
              draft_version: version.current,
              lease_id: leaseId,
            },
            AbortSignal.timeout(30000),
          );
          version.current = r.draft_version;
          if (gen === generation.current) setStatus("个人草稿已同步");
        })
        .catch((e) => {
          setStatus("草稿未同步：" + e.message);
          setPaused(true);
        });
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    serialized,
    page,
    enabled,
    ready,
    editing,
    dirty,
    candidate,
    paused,
    leaseId,
  ]);
  async function discard() {
    setPaused(true);
    generation.current++;
    await queue.current;
    const r = await request<State>(
      `/pages/${page}/draft?draft_version=${version.current}`,
      "DELETE",
      undefined,
      AbortSignal.timeout(15000),
    );
    version.current = r.draft_version;
    setCandidate(null);
    sessionStorage.removeItem(localKey);
    setStatus("个人草稿已清除");
    setPaused(false);
  }
  return {
    ready,
    candidate,
    status,
    discard,
    restore: () => {
      setCandidate(null);
    },
    retry: () => {
      setPaused(false);
      setStatus("等待重试");
    },
    reload: async (preferLocal = false) => {
      await queue.current;
      const r = await request<State>(
        `/pages/${page}/draft`,
        "GET",
        undefined,
        AbortSignal.timeout(15000),
      );
      version.current = r.draft_version;
      const candidate = preferLocal
        ? preferredDraft(localKey, r)
        : (r.draft ?? null);
      setCandidate(candidate);
      setReady(true);
      setPaused(false);
      return candidate;
    },
  };
}
