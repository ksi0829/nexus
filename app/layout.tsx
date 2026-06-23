import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "NEXUS TALK",
    template: "NEXUS TALK | %s",
  },
  description: "NEXUS TALK messenger, documents, approvals, and worklog platform.",
  icons: {
    icon: [
      { url: "/favicon-16x16.png?v=5", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png?v=5", sizes: "32x32", type: "image/png" },
      { url: "/icon.png?v=5", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=5",
    apple: "/apple-icon.png?v=5",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NEXUS TALK",
  },
};

export const viewport = {
  themeColor: "#FFD400",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
