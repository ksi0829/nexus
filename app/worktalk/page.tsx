import type { Metadata } from "next";
import { WorkTalkApp } from "@/components/worktalk/WorkTalkApp";

export const metadata: Metadata = {
  title: "WorkTalk",
  description: "ZETA 사내 업무 메신저",
};

export default function WorkTalkPage() {
  return <WorkTalkApp />;
}
