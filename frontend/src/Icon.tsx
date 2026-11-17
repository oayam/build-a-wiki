import type { CSSProperties } from "react";
const paths = {
  book: "M12 5C9 2 5 2 2 3v16c4-1 7 0 10 2m0-16c3-3 7-3 10-2v16c-4-1-7 0-10 2V5Z",
  folder: "M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3V6Z",
  file: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  chevron: "m9 5 7 7-7 7",
  collapse: "m14 6-6 6 6 6M20 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-4a4 4 0 0 1 0 8",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6",
  move: "M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-6h4l1 3 3 1 3 1v4l-2 2v3l-2 3h-3l-2 2-3-2H6l-2-3v-3l-2-2V7l3-1 3-1 2-3Z",
  history: "M3 10a9 9 0 1 1 0 5M3 3v7h7m2-4v6l4 2",
  activity: "M2 12h5l3-9 4 18 3-9h5",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  link: "m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  table: "M3 3h18v18H3V3Zm0 6h18M9 3v18M3 15h18",
  list: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
  quote: "M4 6h6v8H4v-4l3-4m-3 8v4h4m6-12h6v8h-6v-4l3-4m-3 8v4h4",
  undo: "M3 4v6h6M3 10a8 8 0 1 1 1 9",
  redo: "M21 4v6h-6m6 0a8 8 0 1 0-1 9",
  image: "M3 3h18v18H3V3Zm0 14 6-6 4 4 3-3 5 5M15 7h.01",
} as const;
export type IconName = keyof typeof paths;
export default function Icon({
  name,
  className,
  style,
}: {
  name: IconName;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
