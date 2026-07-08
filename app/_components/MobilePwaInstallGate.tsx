"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isActualMobileDevice } from "@/app/_lib/device";
import styles from "./MobilePwaInstallGate.module.css";

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type NexusDesktopWindow = Window & {
  chrome?: {
    webview?: unknown;
  };
};

const PROTECTED_MOBILE_PATHS = ["/worktalk", "/nexus", "/approval"];

function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;

  const navigatorLike = window.navigator as NavigatorWithStandalone;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorLike.standalone === true
  );
}

function isNexusDesktopWebView() {
  if (typeof window === "undefined") return false;
  return Boolean((window as NexusDesktopWindow).chrome?.webview);
}

export function MobilePwaInstallGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [shouldShowInstallGuide, setShouldShowInstallGuide] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [checked, setChecked] = useState(false);

  const isProtectedPath = useMemo(
    () => PROTECTED_MOBILE_PATHS.some((path) => pathname.startsWith(path)),
    [pathname]
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const userAgent = window.navigator.userAgent || "";
      const ios = /iPad|iPhone|iPod/i.test(userAgent);
      const mobileBrowser =
        isProtectedPath &&
        isActualMobileDevice() &&
        !isStandaloneDisplay() &&
        !isNexusDesktopWebView();

      setIsIOS(ios);
      setShouldShowInstallGuide(mobileBrowser);
      setChecked(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isProtectedPath, pathname]);

  if (!checked || !shouldShowInstallGuide) {
    return <>{children}</>;
  }

  return (
    <main className={styles.page} aria-label="NEXUS 모바일 설치 안내">
      <section className={styles.card}>
        <div className={styles.brand}>NEXUS TALK</div>
        <h1>모바일은 홈 화면 앱으로 실행해 주세요</h1>
        <p className={styles.lead}>
          안정적인 알림과 앱 화면 사용을 위해 모바일 브라우저에서는 먼저
          NEXUS를 홈 화면에 설치한 뒤 실행하는 것을 권장합니다.
        </p>

        <div className={styles.steps}>
          {isIOS ? (
            <>
              <h2>iPhone 설치 방법</h2>
              <ol>
                <li>Safari에서 현재 NEXUS 주소를 엽니다.</li>
                <li>하단 공유 버튼을 누릅니다.</li>
                <li>“홈 화면에 추가”를 선택합니다.</li>
                <li>홈 화면의 NEXUS 아이콘으로 다시 실행합니다.</li>
              </ol>
            </>
          ) : (
            <>
              <h2>Android 설치 방법</h2>
              <ol>
                <li>Chrome에서 현재 NEXUS 주소를 엽니다.</li>
                <li>주소창 또는 메뉴의 “앱 설치”/“홈 화면에 추가”를 선택합니다.</li>
                <li>설치가 끝나면 홈 화면의 NEXUS 아이콘으로 실행합니다.</li>
              </ol>
            </>
          )}
        </div>

        <div className={styles.notice}>
          PC에서는 Windows 설치형 NEXUS.exe 사용을 권장합니다. 모바일은 홈 화면
          앱으로 실행하면 브라우저 주소창 없이 더 안정적으로 사용할 수 있습니다.
        </div>
      </section>
    </main>
  );
}
