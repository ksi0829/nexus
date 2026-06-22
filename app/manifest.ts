import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXUS",
    short_name: "NEXUS",
    description: "ZETA NEXUS messenger, documents, approvals, and worklog platform.",
    start_url: "/worktalk?standalone=1",
    scope: "/",
    display: "standalone",
    background_color: "#f3f8f6",
    theme_color: "#0d493e",
    orientation: "portrait",
    lang: "ko",
    icons: [
      {
        src: "/nexus-icon-v2-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/nexus-icon-v2-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
