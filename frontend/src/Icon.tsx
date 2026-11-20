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
  pin: "M8 3h8l-1 7 3 3v2H6v-2l3-3-1-7Zm4 12v6",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2",
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-4a4 4 0 0 1 0 8",
  shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6",
  move: "M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  settings:
    "M8.250 5.505 L9.581 2.297 L14.419 2.297 L15.750 5.505 L19.193 5.053 L21.613 9.244 L19.500 12.000 L21.613 14.756 L19.193 18.947 L15.750 18.495 L14.419 21.703 L9.581 21.703 L8.250 18.495 L4.807 18.947 L2.387 14.756 L4.500 12.000 L2.387 9.244 L4.807 5.053 L8.250 5.505 Z M15.5 12a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0Z",
  history: "M3 10a9 9 0 1 1 0 5M3 3v7h7m2-4v6l4 2",
  activity: "M2 12h5l3-9 4 18 3-9h5",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18",
  link: "m10 13 4-4m-6 7-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
  table: "M3 3h18v18H3V3Zm0 6h18M9 3v18M3 15h18",
  list: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
  checklist: "m3 6 2 2 4-5M12 6h9M3 14h5v5H3zM12 17h9",
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
