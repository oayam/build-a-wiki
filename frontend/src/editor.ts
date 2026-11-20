import sharedFixture from "../../fixtures/body-v1.json";
import { getSchema, InputRule, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import { TaskList } from "@tiptap/extension-list";
import { MarkdownTaskItem } from "./taskItem";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";

const MarkdownHeading = Heading.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(
      (rule) =>
        new InputRule({
          ...rule,
          handler: (context) => {
            const block = context.state.doc.resolve(context.range.from).parent;
            if (block.type === this.type) return null;
            return rule.handler(context);
          },
        }),
    );
  },
});

export const extensions = [
  StarterKit.configure({
    heading: false,
    trailingNode: false,
    link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
  }),
  MarkdownHeading,
  TaskList,
  MarkdownTaskItem,
  TableKit,
  Image,
];
export const schemaVersion = 1;
export const schema = getSchema(extensions);
export const fixture: JSONContent = sharedFixture.body;
export function roundTrip(body: JSONContent) {
  const node = schema.nodeFromJSON(body);
  node.check();
  return node.toJSON();
}
export function plainText(body: JSONContent) {
  const node = schema.nodeFromJSON(body);
  node.check();
  return node.textBetween(0, node.content.size, "\n", (leaf) =>
    leaf.type.name === "hardBreak" ? "\n" : "",
  );
}
