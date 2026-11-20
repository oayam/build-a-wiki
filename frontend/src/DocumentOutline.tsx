import React from "react";
import { type Editor, useEditorState } from "@tiptap/react";
import OutlineTooltip from "./OutlineTooltip";
import { WorkspaceTopInset } from "./WorkspaceTopbar";

export default function DocumentOutline({
  editor,
  pinnedHeight,
}: {
  editor: Editor | null;
  pinnedHeight: number;
}) {
  const doc = useEditorState({
    editor,
    selector: ({ editor }) => editor?.state.doc,
    equalityFn: Object.is,
  });
  const headings = React.useMemo(() => {
    const entries: { pos: number; level: number; title: string }[] = [];
    doc?.descendants((node, pos) => {
      if (node.type.name === "heading") {
        const title = node.textBetween(0, node.content.size, "", " ").trim();
        if (title) entries.push({ pos, level: node.attrs.level, title });
      }
      return !node.isTextblock;
    });
    return entries;
  }, [doc]);
  const rail = React.useRef<HTMLElement>(null);
  const [visible, setVisible] = React.useState<Set<number>>(() => new Set());
  const refreshAfterJump = React.useRef<(() => void) | null>(null);
  const [hint, setHint] = React.useState<{
    pos: number;
    anchor: HTMLButtonElement;
  } | null>(null);
  const hintId = React.useId();
  const hintTitle = hint
    ? headings.find(({ pos }) => pos === hint.pos)?.title
    : undefined;
  const coveredTop = React.useContext(WorkspaceTopInset) + pinnedHeight;

  React.useLayoutEffect(() => {
    if (!editor || !headings.length || !rail.current) return;
    const positions = new Map<Element, number>();
    for (const { pos } of headings) {
      const node = editor.view.nodeDOM(pos);
      if (node instanceof Element) positions.set(node, pos);
    }
    const inView = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pos = positions.get(entry.target)!;
          if (entry.intersectionRatio > 0) inView.add(pos);
          else inView.delete(pos);
        }
        setVisible(new Set(inView));
      },
      { rootMargin: `-${coveredTop}px 0px 0px`, threshold: [0, 0.00001] },
    );
    for (const node of positions.keys()) observer.observe(node);
    refreshAfterJump.current = () => {
      // Discard pre-jump observations and paint the new range in the click frame.
      observer.takeRecords();
      inView.clear();
      const { clientWidth, clientHeight } = document.documentElement;
      for (const [node, pos] of positions) {
        const box = node.getBoundingClientRect();
        if (
          box.bottom > coveredTop &&
          box.top < clientHeight &&
          box.right > 0 &&
          box.left < clientWidth
        )
          inView.add(pos);
      }
      setVisible(new Set(inView));
    };
    return () => {
      observer.takeRecords();
      observer.disconnect();
      refreshAfterJump.current = null;
    };
  }, [editor, headings, coveredTop]);

  function jumpToHeading(pos: number) {
    setHint(null);
    const heading = editor?.view.nodeDOM(pos);
    const layout = rail.current?.parentElement;
    if (!editor || !(heading instanceof HTMLElement) || !layout) return;
    // Only add the missing scroll space when a heading is near the end.
    const remaining =
      editor.view.dom.getBoundingClientRect().bottom -
      heading.getBoundingClientRect().top;
    layout.style.setProperty(
      "--outline-content-after-target",
      `${remaining}px`,
    );
    heading.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: "instant",
    });
    refreshAfterJump.current?.();
  }

  if (!headings.length) return null;
  return (
    <nav
      ref={rail}
      className="document-outline"
      aria-label="章节目录"
      onPointerLeave={() => setHint(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHint(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setHint(null);
      }}
    >
      {headings.map(({ pos, level, title }) => (
        <button
          key={pos}
          type="button"
          aria-label={`${level} 级标题：${title}`}
          aria-describedby={hint?.pos === pos ? hintId : undefined}
          data-visible={visible.has(pos) || undefined}
          aria-description={visible.has(pos) ? "标题在当前视口内" : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch")
              setHint({ pos, anchor: event.currentTarget });
          }}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible"))
              setHint({ pos, anchor: event.currentTarget });
          }}
          onClick={() => jumpToHeading(pos)}
        >
          <span
            aria-hidden="true"
            style={{ width: `${36 - 4 * (level - 1)}px` }}
          />
        </button>
      ))}
      <OutlineTooltip id={hintId} anchor={hint?.anchor} title={hintTitle} />
    </nav>
  );
}
