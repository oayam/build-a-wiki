// @vitest-environment jsdom
import { it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { extensions, fixture, roundTrip, plainText } from "./editor";
it("mounts the actual editor and restores Chinese/code/table JSON", () => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions,
    content: fixture,
  });
  const before = editor.getJSON();
  editor.commands.setContent(JSON.parse(JSON.stringify(before)));
  expect(editor.getJSON()).toEqual(roundTrip(before));
  expect(editor.view.dom.querySelector("table")).not.toBeNull();
  expect(editor.view.dom.querySelector("pre")?.textContent).toContain("中文");
  expect(plainText(editor.getJSON())).toContain("你好，世界 🌍");
  editor.destroy();
});
