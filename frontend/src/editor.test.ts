import attachmentFixture from "../../fixtures/attachments-v1.json";
import { describe, it, expect } from "vitest";
import { fixture, roundTrip, plainText, schema } from "./editor";
describe("schema v1", () => {
  it("preserves attachment links and image dimensions", () => {
    expect(roundTrip(attachmentFixture)).toEqual(attachmentFixture);
  });
  it("preserves Chinese, code and table through repeated JSON serialization", () => {
    const canonical = roundTrip(fixture);
    expect(roundTrip(JSON.parse(JSON.stringify(canonical)))).toEqual(canonical);
    expect(plainText(canonical)).toBe(
      '中文知识库\n你好，世界 🌍\nfn main() { println!("中文"); }\n名称\n团队',
    );
  });
  it("rejects unknown nodes and invalid nesting", () => {
    expect(() => roundTrip({ type: "script" })).toThrow();
    expect(() =>
      roundTrip({ type: "doc", content: [{ type: "text", text: "bad" }] }),
    ).toThrow();
  });
  it("has only explicitly supported node types", () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(
      [
        "blockquote",
        "bulletList",
        "codeBlock",
        "doc",
        "hardBreak",
        "heading",
        "horizontalRule",
        "image",
        "listItem",
        "orderedList",
        "paragraph",
        "table",
        "tableCell",
        "tableHeader",
        "tableRow",
        "taskItem",
        "taskList",
        "text",
      ].sort(),
    );
  });
});
