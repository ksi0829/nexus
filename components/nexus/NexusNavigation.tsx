"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { WorkTalkIcon } from "@/components/worktalk/WorkTalkIcon";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { restoreDocumentWindowPlacement } from "@/app/_lib/windowPlacement";
import styles from "./NexusNavigation.module.css";

type NexusNavigationProps = {
  active: "chat" | "people" | "document" | "notifications";
};

export function NexusNavigation({ active }: NexusNavigationProps) {
  const router = useRouter();

  const navigate = (path: string) => {
    if (path.startsWith("/worktalk")) {
      restoreDocumentWindowPlacement();
    }
    router.push(path);
  };

  const logout = async () => {
    await createSupabaseBrowser().auth.signOut();
    localStorage.removeItem("role");
    localStorage.removeItem("team");
    localStorage.removeItem("name");
    router.replace("/login");
  };

  return (
    <aside className={styles.rail} aria-label="NEXUS 메뉴">
      <button
        type="button"
        className={styles.brand}
        onClick={() => navigate("/worktalk?section=people")}
        aria-label="NEXUS 홈"
        title="NEXUS 홈"
      >
        <Image src="/nexus-talk-icon-192.png?v=5" alt="" width={42} height={42} priority />
      </button>
      <nav className={styles.nav}>
        <button
          type="button"
          className={active === "people" ? styles.active : ""}
          onClick={() => navigate("/worktalk?section=people")}
          title="직원·조직"
        >
          <WorkTalkIcon name="people" />
        </button>
        <button
          type="button"
          className={active === "chat" ? styles.active : ""}
          onClick={() => navigate("/worktalk?section=chat")}
          title="채팅"
        >
          <WorkTalkIcon name="chat" />
        </button>
        <button
          type="button"
          className={active === "document" ? styles.active : ""}
          onClick={() => navigate("/nexus")}
          title="NEXUS 문서"
        >
          <WorkTalkIcon name="document" />
        </button>
        <button
          type="button"
          className={active === "notifications" ? styles.active : ""}
          onClick={() => navigate("/worktalk?section=notifications")}
          title="알림"
        >
          <WorkTalkIcon name="bell" />
        </button>
      </nav>
      <div className={styles.footer}>
        <button type="button" title="로그아웃" onClick={() => void logout()}>
          <WorkTalkIcon name="logout" />
        </button>
        <span title="내 계정">
          <WorkTalkIcon name="person" />
        </span>
      </div>
    </aside>
  );
}

export { styles as nexusNavigationStyles };
