import sharedFixture from "../../fixtures/body-v1.json";
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
