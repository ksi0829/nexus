import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXUS TALK",
    short_name: "NEXUS TALK",
    description: "NEXUS TALK messenger, documents, approvals, and worklog platform.",
    start_url: "/worktalk?standalone=1",
    scope: "/",
    display: "standalone",
    background_color: "#FFD400",
    theme_color: "#FFD400",
    orientation: "portrait",
    lang: "ko",
    icons: [
      {
        src: "/nexus-talk-icon-192.png?v=5",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/nexus-talk-icon-512.png?v=5",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/maskable-icon.png?v=5",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
