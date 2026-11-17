import type React from "react";

const PRIMARY_BUTTON = 0;

// Preserve modified clicks for opening links in another tab or window.
export function isPlainTreeClick(event: React.MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === PRIMARY_BUTTON &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function toggleTreeNode(open: string[], id: string) {
  return open.includes(id)
    ? open.filter((value) => value !== id)
    : [...open, id];
}

export function expandTreeNode(open: string[], id: string) {
  return open.includes(id) ? open : [...open, id];
}
