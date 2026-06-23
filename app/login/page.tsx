"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import styles from "./page.module.css";

const supabase = createSupabaseBrowser();
const COMPANY_EMAIL_DOMAIN =
  "@zetacorporation.com";

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

async function recordLoginActivity(profile: {
  id: string;
  name?: string | null;
  team?: string | null;
  role?: string | null;
}) {
  await supabase
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
    })
    .then(() => undefined);
}

export default function LoginPage() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");

  const [rememberId, setRememberId] = useState(true);

  const [loading, setLoading] =
    useState(false);

  useEffect(() => {
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
      const { data, error } =
        await supabase.auth.signInWithPassword({
          email: toLoginEmail(loginId),
          password,
        });

      if (error || !data.user) {
        alert(error?.message ? `로그인 실패: ${error.message}` : "로그인 실패");
        setLoading(false);
        return;
      }

      const { data: profile } =
        await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single();

      if (!profile) {
        alert("프로필 정보가 없습니다.");
        setLoading(false);
        return;
      }

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

      await recordLoginActivity(profile);

      const nextPath = new URLSearchParams(window.location.search).get("next");
      router.push(nextPath?.startsWith("/") ? nextPath : "/worktalk");
    } catch (err) {
      console.error(err);
      alert("로그인 중 오류 발생");
    }

    setLoading(false);
  }

  return (
    <main className={styles.page}>
      <section className={styles.shell}>
        <div className={styles.formPanel}>
          <Image
            src="/nexus-talk-icon-512.png?v=5"
            alt="NEXUS TALK"
            width={180}
            height={180}
            className={styles.mobileLogo}
            priority
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
