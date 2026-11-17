import React from "react";
import { Alert, Button, Progress, Space } from "antd";
import type { Editor } from "@tiptap/react";
import { request, uploadFile } from "./session";
import type { components } from "./api.generated";
type Attachment = components["schemas"]["Attachment"];
export default function Attachments({
  page,
  editor,
  editing,
  canEdit,
}: {
  page: string;
  editor: Editor | null;
  editing: boolean;
  canEdit: boolean;
}) {
  const [items, setItems] = React.useState<Attachment[]>([]);
  const [file, setFile] = React.useState<File>();
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const attempt = React.useRef<{ file: File; key: string } | undefined>(
    undefined,
  );
  async function load() {
    setItems(await request<Attachment[]>(`/pages/${page}/attachments`));
  }
  React.useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [page]);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      if (attempt.current?.file !== file)
        attempt.current = { file, key: crypto.randomUUID() };
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const sha = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await uploadFile(
        `/pages/${page}/attachments?` +
          new URLSearchParams({
            request_id: attempt.current.key,
            name: file.name,
            sha256: sha,
          }),
        file,
        setProgress,
      );
      await load();
      setFile(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>附件</h2>
      {error && <Alert type="error" message={error} />}
      {canEdit && (
        <Space>
          <input
            aria-label="选择附件"
            type="file"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0])}
          />
          <Button disabled={!file} loading={busy} onClick={() => void upload()}>
            上传附件（失败可重试）
          </Button>
        </Space>
      )}
      {busy && <Progress percent={progress} />}
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            <a
              href={`/api/v1/attachments/${a.id}/download`}
              target="_blank"
              rel="noreferrer"
            >
              {a.original_name}
            </a>
            （{a.size} 字节）
            {editing && (
              <Button
                onClick={() => {
                  const url = `/api/v1/attachments/${a.id}/download`;
                  if (a.mime_type.startsWith("image/"))
                    editor
                      ?.chain()
                      .focus()
                      .setImage({ src: url, alt: a.original_name })
                      .run();
                  else
                    editor
                      ?.chain()
                      .focus()
                      .insertContent({
                        type: "text",
                        text: a.original_name,
                        marks: [
                          {
                            type: "link",
                            attrs: { href: url },
                          },
                        ],
                      })
                      .run();
                }}
              >
                插入正文
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!items.length && <p>暂无附件</p>}
    </section>
  );
}
