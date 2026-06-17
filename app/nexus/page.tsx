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
      <header>
        <div>
          <span>NEXUS DOCUMENTS</span>
          <h1>넥스 문서</h1>
          <p>문서를 선택하면 작성부터 결재방 생성까지 이어집니다.</p>
        </div>
        <button
          className={styles.backButton}
          onClick={() => {
            restoreDocumentWindowPlacement();
            router.push("/worktalk");
          }}
        >
          메신저로 돌아가기
        </button>
      </header>
      <section className={styles.grid}>
        <article className={styles.card}>
          <div className={styles.icon}>LOG</div>
          <div className={styles.cardTitle}>
            <strong>업무일지</strong>
          </div>
          <p>전일·금일 업무를 작성하고 소속 부서 채팅방에 PDF로 공유합니다.</p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={isMobile}
              onClick={() => openDocumentWriter("/nexus/worklog")}
            >
              업무일지 작성
            </button>
          </div>
          {isMobile && (
            <span className={styles.mobileWriteNotice}>
              결재문서 작성은 PC에서만 가능합니다.
            </span>
          )}
        </article>
        {NEXUS_DOCUMENTS.map((document) => (
          <article key={document.key} className={styles.card}>
            <div className={styles.icon}>{document.icon}</div>
            <div className={styles.cardTitle}>
              <strong>{document.title}</strong>
              {!document.submissionReady && (
                <span className={styles.policyBadge}>
                  {document.key === "work_order" ? "발행 정책 준비 중" : "양식 사용 가능"}
                </span>
              )}
            </div>
            <p>{document.description}</p>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={isMobile}
                onClick={() => openDocumentWriter(`/approval?nexus=${document.key}`)}
              >
                문서 작성
              </button>
            </div>
            {isMobile && (
              <span className={styles.mobileWriteNotice}>
                결재문서 작성은 PC에서만 가능합니다.
              </span>
            )}
            {!document.submissionReady && (
              <span className={styles.policyNote}>
                {document.key === "work_order"
                  ? "참조자와 공유 정책 확정 후 발행 기능이 열립니다."
                  : "결재 정책 확정 후 상신 기능이 열립니다."}
              </span>
            )}
          </article>
        ))}
      </section>
      </main>
    </>
  );
}
