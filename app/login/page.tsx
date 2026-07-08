"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import styles from "./page.module.css";

const supabase = createSupabaseBrowser();
const COMPANY_EMAIL_DOMAIN =
  "@zetacorporation.com";

type NexusDesktopWindow = Window & {
  chrome?: {
    webview?: {
      postMessage: (message: string) => void;
    };
  };
};

type LoginErrorDetail = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  stack?: unknown;
  status?: unknown;
};

function toLoginEmail(id: string) {
  const trimmed = id.trim();

  if (trimmed.includes("@")) {
    return trimmed;
  }

  return `${trimmed}${COMPANY_EMAIL_DOMAIN}`;
}

function toDisplayId(id: string) {
  const trimmed = id.trim();

  if (trimmed.endsWith(COMPANY_EMAIL_DOMAIN)) {
    return trimmed.slice(
      0,
      -COMPANY_EMAIL_DOMAIN.length
    );
  }

  return trimmed;
}

function getLoginErrorDetail(error: unknown) {
  const detail = (error || {}) as LoginErrorDetail;
  return {
    code: detail.code ?? null,
    message:
      typeof detail.message === "string" && detail.message.trim()
        ? detail.message
        : String(error || "알 수 없는 오류"),
    name: detail.name ?? null,
    rawKeys:
      error && typeof error === "object" ? Object.keys(error) : [],
    stack: detail.stack ?? null,
    status: detail.status ?? null,
  };
}

function getLoginErrorMessage(error: unknown) {
  const detail = getLoginErrorDetail(error);
  return detail.message || "알 수 없는 오류";
}

function logLoginStep(step: string, payload: Record<string, unknown> = {}) {
  console.info(`[NEXUS login] ${step}`, {
    at: new Date().toISOString(),
    ...payload,
  });
}

async function recordLoginActivity(profile: {
  id: string;
  name?: string | null;
  team?: string | null;
  role?: string | null;
}) {
  try {
    logLoginStep("ACTIVITY LOG START", { userId: profile.id });
    const { error } = await supabase
      .from("user_activity_logs")
      .insert({
        user_id: profile.id,
        user_name: profile.name || "",
        team: profile.team || "",
        role: profile.role || "",
        event_type: "login",
        path: "/login",
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : "",
      });

    if (error) {
      console.warn("[NEXUS login] ACTIVITY LOG FAILED", getLoginErrorDetail(error));
      return;
    }

    logLoginStep("ACTIVITY LOG DONE", { userId: profile.id });
  } catch (error) {
    console.warn("[NEXUS login] ACTIVITY LOG FAILED", getLoginErrorDetail(error));
  }
}

export default function LoginPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");

  const [rememberId, setRememberId] = useState(true);

  const [loading, setLoading] =
    useState(false);

  useEffect(() => {
    (window as NexusDesktopWindow).chrome?.webview?.postMessage(
      JSON.stringify({ type: "auth-state", authenticated: false })
    );

    const saved = localStorage.getItem("savedEmail");
    if (!saved) return;

    const timeoutId = window.setTimeout(() => {
      setLoginId(toDisplayId(saved));
      setRememberId(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  async function handleLogin(
    e: React.FormEvent
  ) {
    e.preventDefault();

    setLoading(true);

    try {
      const loginEmail = toLoginEmail(loginId);
      logLoginStep("LOGIN START", { email: loginEmail });

      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: loginEmail,
          password,
        });

      if (error || !data.user) {
        if (error) {
          console.error("[NEXUS login] AUTH FAILED", getLoginErrorDetail(error));
        }
        alert(`로그인 실패: ${error ? getLoginErrorMessage(error) : "사용자 정보를 확인할 수 없습니다."}`);
        setLoading(false);
        return;
      }

      logLoginStep("AUTH SUCCESS", {
        email: data.user.email,
        userId: data.user.id,
      });

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        if (sessionError) {
          console.error("[NEXUS login] SESSION FAILED", getLoginErrorDetail(sessionError));
        }
        alert(
          `로그인 실패: ${
            sessionError
              ? getLoginErrorMessage(sessionError)
              : "로그인 세션을 확인할 수 없습니다. 다시 시도해 주세요."
          }`
        );
        setLoading(false);
        return;
      }

      logLoginStep("SESSION READY", {
        expiresAt: session.expires_at ?? null,
        userId: session.user.id,
      });

      logLoginStep("PROFILE FETCH START", { userId: data.user.id });
      const { data: profile, error: profileError } =
        await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single();

      if (profileError || !profile) {
        if (profileError) {
          console.error("[NEXUS login] PROFILE FETCH FAILED", getLoginErrorDetail(profileError));
        }
        alert(
          `로그인 실패: ${
            profileError
              ? getLoginErrorMessage(profileError)
              : "프로필 정보가 없습니다."
          }`
        );
        setLoading(false);
        return;
      }

      logLoginStep("PROFILE FETCH DONE", {
        role: profile.role || null,
        team: profile.team || null,
        userId: profile.id,
      });

      localStorage.setItem(
        "role",
        profile.role || ""
      );

      localStorage.setItem(
        "team",
        profile.team || ""
      );

      localStorage.setItem(
        "name",
        profile.name || ""
      );

      if (rememberId) {
        localStorage.setItem(
          "savedEmail",
          toLoginEmail(loginId)
        );
      } else {
        localStorage.removeItem(
          "savedEmail"
        );
      }

      void recordLoginActivity(profile);

      (window as NexusDesktopWindow).chrome?.webview?.postMessage(
        JSON.stringify({ type: "auth-state", authenticated: true })
      );

      const nextPath = new URLSearchParams(window.location.search).get("next");
      const targetPath = nextPath?.startsWith("/") ? nextPath : "/worktalk";
      logLoginStep("ROUTER PUSH START", { targetPath });
      router.replace(targetPath);
      logLoginStep("LOGIN COMPLETE", { targetPath });
    } catch (err) {
      console.error("[NEXUS login] LOGIN FAILED", getLoginErrorDetail(err));
      alert(`로그인 중 오류 발생: ${getLoginErrorMessage(err)}`);
    }

    setLoading(false);
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.formPanel}>
          <img
            src="/nexus-talk-icon-192.png?v=6"
            alt="NEXUS TALK"
            width={180}
            height={180}
            className={styles.mobileLogo}
          />
          <span className={styles.eyebrow}>WELCOME TO NEXUS</span>
          <h1 className={styles.title}>업무를 시작하세요</h1>
          <p className={styles.subTitle}>제타 임직원 계정으로 로그인합니다.</p>
          <form onSubmit={handleLogin} className={styles.form}>
            <label className={styles.field}>
              <span>아이디</span>
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="아이디 입력"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </label>
            <label className={styles.field}>
              <span>비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
              />
            </label>
            <label className={styles.remember}>
              <input
                type="checkbox"
                checked={rememberId}
                onChange={(e) => setRememberId(e.target.checked)}
              />
              아이디 저장
            </label>
            <button type="submit" disabled={loading} className={styles.submit}>
              {loading ? "연결 중..." : "NEXUS 시작하기"}
            </button>
          </form>
          <div className={styles.footer}>NEXUS TALK · CONNECT EVERYTHING</div>
        </div>
      </section>
    </main>
  );
}
