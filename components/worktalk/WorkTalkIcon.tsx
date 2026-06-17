import type { SVGProps } from "react";

export type WorkTalkIconName =
  | "chat"
  | "people"
  | "document"
  | "bell"
  | "settings"
  | "search"
  | "plus"
  | "back"
  | "send"
  | "attach"
  | "mute"
  | "more"
  | "close"
  | "team"
  | "idea"
  | "group"
  | "person"
  | "pin"
  | "logout";

const paths: Record<WorkTalkIconName, string> = {
  chat: "M4 5.5h16v10H9l-5 4v-14Zm5 4h6m-6 3h4",
  people:
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6 9a6 6 0 0 0-12 0m13-9a3 3 0 1 0 0-6m4 14a5 5 0 0 0-4-4.9",
  document: "M6 3h9l3 3v15H6V3Zm9 0v4h4M9 11h6m-6 4h6",
  bell: "M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2Zm-8 5h4",
  settings:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5 2-1-2-3-2.2.3-1.5-1.5.3-2.2-3-2-1 2-2.2.6-1.5-1.5-.3L8 2 6 5l.3 2.2-1.5 1.5L2.6 8.4 1 12l2 1-.3 2.2 1.5 1.5-.3 2.2 3 2 1.5-1.5 2.2.3 1 2.3 3-2 .3-2.2 1.5-1.5 2.2.3L22 13l-2-1Z",
  search: "m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  plus: "M12 5v14M5 12h14",
  back: "m15 18-6-6 6-6",
  send: "m4 4 16 8-16 8 3-8-3-8Zm3 8h13",
  attach: "m9 12 5.5-5.5a3 3 0 0 1 4.2 4.2L11 18.4a5 5 0 0 1-7-7l7.4-7.4",
  mute: "M11 5 6 9H3v6h3l5 4V5Zm5 4 5 5m0-5-5 5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  close: "m6 6 12 12M18 6 6 18",
  team: "M4 20v-8h16v8M8 12V7h8v5M7 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  idea: "M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14c-.8.7-1.5 1.5-1.5 2.5h-4c0-1-.7-1.8-1.5-2Z",
  group: "M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0m-2 0a5 5 0 0 1 10 0",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0",
  pin: "m9 4 6 0-1 5 3 3H7l3-3-1-5Zm3 8v8",
  logout: "M10 5H5v14h5m4-4 4-3-4-3m4 3H9",
};

export function WorkTalkIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: WorkTalkIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
