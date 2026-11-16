import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
export const extensions = [
  StarterKit.configure({
    trailingNode: false,
    link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
  }),
  TableKit,
  Image,
];
export const schemaVersion = 1;
export const schema = getSchema(extensions);
export const fixture: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "中文知识库" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "你好，世界 🌍" }] },
    {
      type: "codeBlock",
      attrs: { language: "rust" },
      content: [{ type: "text", text: 'fn main() { println!("中文"); }' }],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "名称" }],
                },
              ],
            },
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "团队" }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
export function roundTrip(body: JSONContent) {
  const node = schema.nodeFromJSON(body);
  node.check();
  return node.toJSON();
}
export function plainText(body: JSONContent) {
  const node = schema.nodeFromJSON(body);
  node.check();
  return node.textBetween(0, node.content.size, "\n");
}
