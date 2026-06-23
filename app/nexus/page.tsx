"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isActualMobileDevice } from "@/app/_lib/device";
import { NEXUS_DOCUMENTS } from "@/app/_lib/nexusDocuments";
import {
  maximizeDocumentWindow,
  restoreDocumentWindowPlacement,
} from "@/app/_lib/windowPlacement";
import {
  NexusNavigation,
  nexusNavigationStyles,
} from "@/components/nexus/NexusNavigation";
import styles from "./page.module.css";

export default function NexusPage() {
  const router = useRouter();
  const [isMobile] = useState(() => isActualMobileDevice());

  function openDocumentWriter(path: string) {
    if (isMobile) return;
    maximizeDocumentWindow({ saveCurrent: true });
    router.push(path);
  }

  return (
    <>
      <NexusNavigation active="document" />
      <main className={`${styles.page} ${nexusNavigationStyles.content}`}>
        <section className={styles.panel} aria-label="문서 메뉴">
          <header className={styles.header}>
            <div>
              <span>ZETA</span>
              <h1>문서</h1>
              <p>업무일지와 결재 문서를 작성하고 필요한 채팅방에 공유합니다.</p>
            </div>
            <button
              className={styles.backButton}
              onClick={() => {
                restoreDocumentWindowPlacement();
                router.push("/worktalk?section=chat");
              }}
            >
              채팅
            </button>
          </header>
          <section className={styles.list}>
            <article className={styles.documentItem}>
              <div className={styles.icon}>LOG</div>
              <div className={styles.itemBody}>
                <strong>업무일지</strong>
                <p>전일·금일 업무를 작성하고 소속 부서 채팅방에 PDF로 공유합니다.</p>
                {isMobile && (
                  <span className={styles.mobileWriteNotice}>
                    문서 작성은 PC에서만 가능합니다.
                  </span>
                )}
              </div>
              <button
                className={styles.actionButton}
                type="button"
                disabled={isMobile}
                onClick={() => openDocumentWriter("/nexus/worklog")}
              >
                작성
              </button>
            </article>
            {NEXUS_DOCUMENTS.map((document) => (
              <article key={document.key} className={styles.documentItem}>
                <div className={styles.icon}>{document.icon}</div>
                <div className={styles.itemBody}>
                  <div className={styles.titleRow}>
                    <strong>{document.title}</strong>
                    {!document.submissionReady && (
                      <span className={styles.policyBadge}>
                        {document.key === "work_order" ? "준비 중" : "양식"}
                      </span>
                    )}
                  </div>
                  <p>{document.description}</p>
                  {isMobile && (
                    <span className={styles.mobileWriteNotice}>
                      문서 작성은 PC에서만 가능합니다.
                    </span>
                  )}
                  {!document.submissionReady && (
                    <span className={styles.policyNote}>
                      {document.key === "work_order"
                        ? "참조자와 공유 정책 확정 후 발행 기능이 열립니다."
                        : "결재 정책 확정 후 상신 기능이 열립니다."}
                    </span>
                  )}
                </div>
                <button
                  className={styles.actionButton}
                  type="button"
                  disabled={isMobile}
                  onClick={() => openDocumentWriter(`/approval?nexus=${document.key}`)}
                >
                  작성
                </button>
              </article>
            ))}
          </section>
        </section>
      </main>
    </>
  );
}
