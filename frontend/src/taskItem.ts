import { InputRule, wrappingInputRule } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";

const marker = /^(?:- )?\[([ xX])\] $/;

export const MarkdownTaskItem = TaskItem.extend({
  addInputRules() {
    return [
      new InputRule({
        find: marker,
        handler: ({ state, range, match, commands }) => {
          const { tr } = state;
          const { $from } = tr.selection;
          const item = $from.node(-1);
          const inBullet =
            item.type.name === "listItem" &&
            $from.node(-2).type.name === "bulletList";
          if ((!inBullet && item.type !== this.type) || $from.index(-1) !== 0)
            return null;
          tr.delete(range.from, range.to);
          const start = tr.selection.$from;
          const checked = match[1].toLowerCase() === "x";
          if (item.type === this.type) {
            tr.setNodeAttribute(start.before(-1), "checked", checked);
            return;
          }
          // "- " already made a bullet. Isolate this row so its siblings stay bullets.
          const index = start.index(-2);
          if (index + 1 < start.node(-2).childCount) tr.split(start.after(-1));
          if (index > 0) tr.split(start.before(-1));
          const cursor = tr.selection.$from;
          const task = this.type.create({ checked }, cursor.node(-1).content);
          const list = state.schema.nodes.taskList.create(null, task);
          tr.replaceWith(cursor.before(-2), cursor.after(-2), list);
          commands.setTextSelection(cursor.pos);
        },
      }),
      wrappingInputRule({
        find: marker,
        type: this.type,
        getAttributes: (match) => ({ checked: match[1].toLowerCase() === "x" }),
      }),
    ];
  },
}).configure({
  nested: true,
  a11y: { checkboxLabel: (node) => node.textContent || "待办项" },
});
