"use client";

import InputPageClient from "@/app/InputPageClient";
import {
  NexusNavigation,
  nexusNavigationStyles,
} from "@/components/nexus/NexusNavigation";

export default function NexusWorklogPage() {
  return (
    <>
      <NexusNavigation active="document" />
      <main
        className={nexusNavigationStyles.content}
        style={{ minHeight: "100vh", background: "#f5f8f7" }}
      >
        <InputPageClient nexusMode />
      </main>
    </>
  );
}
