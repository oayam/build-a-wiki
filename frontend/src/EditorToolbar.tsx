import React from "react";
import { Button, Input, Modal } from "antd";
import { useEditorState, type Editor } from "@tiptap/react";
import Icon from "./Icon";
export default function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold"),
      italic: e?.isActive("italic"),
      strike: e?.isActive("strike"),
      heading: e?.isActive("heading", { level: 2 }),
      bullet: e?.isActive("bulletList"),
      ordered: e?.isActive("orderedList"),
      taskList: e?.isActive("taskList"),
      quote: e?.isActive("blockquote"),
      code: e?.isActive("codeBlock"),
      link: e?.isActive("link"),
      undo: e?.can().undo(),
      redo: e?.can().redo(),
    }),
  });
  function tool(
    label: string,
    content: React.ReactNode,
    action: () => unknown,
    active?: boolean,
    disabled = false,
  ) {
    return (
      <Button
        type="text"
        aria-label={label}
        title={label}
        aria-pressed={active}
        className={active ? "tool-active" : ""}
        disabled={!editor || disabled}
        onClick={action}
      >
        {content}
      </Button>
    );
  }
  return (
    <>
      <div
        className="toolbar editor-toolbar"
        role="toolbar"
        aria-label="正文格式"
      >
        {tool(
          "标题",
          <span className="heading-tool">H₂</span>,
          () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          state?.heading,
        )}
        <span className="tool-divider" />
        {tool(
          "粗体",
          <b>B</b>,
          () => editor?.chain().focus().toggleBold().run(),
          state?.bold,
        )}
        {tool(
          "斜体",
          <i>I</i>,
          () => editor?.chain().focus().toggleItalic().run(),
          state?.italic,
        )}
        {tool(
          "删除线",
          <s>S</s>,
          () => editor?.chain().focus().toggleStrike().run(),
          state?.strike,
        )}
        {tool(
          "代码",
          <Icon name="code" />,
          () => editor?.chain().focus().toggleCodeBlock().run(),
          state?.code,
        )}
        <span className="tool-divider" />
        {tool(
          "链接",
          <Icon name="link" />,
          () => {
            setUrl(editor?.getAttributes("link").href ?? "");
            setError("");
            setLinkOpen(true);
          },
          state?.link,
        )}
        {tool("插入图片", <Icon name="image" />, () => {
          const input =
            document.querySelector<HTMLInputElement>('input[type="file"]');
          input?.closest("section")?.scrollIntoView({ block: "center" });
          input?.click();
        })}
        {tool("表格", <Icon name="table" />, () =>
          editor
            ?.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
        )}
        <span className="tool-divider" />
        {tool(
          "引用",
          <Icon name="quote" />,
          () => editor?.chain().focus().toggleBlockquote().run(),
          state?.quote,
        )}
        {tool(
          "列表",
          <Icon name="list" />,
          () => editor?.chain().focus().toggleBulletList().run(),
          state?.bullet,
        )}
        {tool(
          "有序列表",
          <span>1≡</span>,
          () => editor?.chain().focus().toggleOrderedList().run(),
          state?.ordered,
        )}
        {tool(
          "待办列表",
          <Icon name="checklist" />,
          () => editor?.chain().focus().toggleTaskList().run(),
          state?.taskList,
        )}
        {tool("分隔线", <span>―</span>, () =>
          editor?.chain().focus().setHorizontalRule().run(),
        )}
        <span className="toolbar-spacer" />
        {tool(
          "撤销",
          <Icon name="undo" />,
          () => editor?.chain().focus().undo().run(),
          undefined,
          !state?.undo,
        )}
        {tool(
          "重做",
          <Icon name="redo" />,
          () => editor?.chain().focus().redo().run(),
          undefined,
          !state?.redo,
        )}
      </div>
      <Modal
        transitionName="wiki-dialog"
        maskTransitionName="wiki-mask"
        title="编辑链接"
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        okText="应用链接"
        cancelText="取消"
        onOk={() => {
          const href = url.trim();
          if (href && !/^(https?:\/\/|mailto:)/i.test(href)) {
            setError("请输入 http、https 或 mailto 链接。");
            return;
          }
          if (href)
            editor
              ?.chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href })
              .run();
          else
            editor?.chain().focus().extendMarkRange("link").unsetLink().run();
          setLinkOpen(false);
        }}
      >
        <p>填写链接地址；清空地址可移除已有链接。</p>
        <Input
          aria-label="链接地址"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
        />
        {error && <p role="alert">{error}</p>}
      </Modal>
    </>
  );
}
