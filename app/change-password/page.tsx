"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/app/_components/BrandLogo";
import { createBrowserClient } from "@supabase/ssr";

type Profile = {
  id: string;
  name: string | null;
  team: string | null;
  role: string | null;
  must_change_password: boolean | null;
};

function isExecutive(team?: string | null) {
  const t = team ?? "";
  return t.includes("경영진") || t.includes("회장") || t.includes("대표이사") || t.includes("고문");
}

export default function ChangePasswordPage() {
  const router = useRouter();

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setMsg(null);

    if (!password || !passwordConfirm) {
      setMsg({ type: "err", text: "새 비밀번호와 확인 비밀번호를 입력하세요." });
      return;
    }

    if (password !== passwordConfirm) {
      setMsg({ type: "err", text: "비밀번호가 서로 일치하지 않습니다." });
      return;
    }

    if (password.length < 6) {
      setMsg({ type: "err", text: "비밀번호는 최소 6자 이상이어야 합니다." });
      return;
    }

    try {
      setLoading(true);

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr || !user) {
        setMsg({
          type: "err",
          text: "로그인 정보를 확인할 수 없습니다. 다시 로그인하세요.",
        });
        setLoading(false);
        return;
      }

      const { error: pwErr } = await supabase.auth.updateUser({
        password,
      });

      if (pwErr) {
        setMsg({ type: "err", text: `비밀번호 변경 실패\n${pwErr.message}` });
        setLoading(false);
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id,name,team,role,must_change_password")
        .eq("id", user.id)
        .maybeSingle();

      if (profileErr) {
        setMsg({
          type: "err",
          text: `비밀번호는 변경됐지만 profiles 조회에 실패했습니다.\n${profileErr.message}`,
        });
        setLoading(false);
        return;
      }

      const { data: updatedProfile, error: updateErr } = await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", user.id)
        .select("id, must_change_password")
        .maybeSingle();

      if (updateErr) {
        setMsg({
          type: "err",
          text: `비밀번호는 변경됐지만 must_change_password 해제에 실패했습니다.\n${updateErr.message}`,
        });
        setLoading(false);
        return;
      }

      if (!updatedProfile) {
        setMsg({
          type: "err",
          text: "비밀번호는 변경됐지만 profiles 업데이트 결과가 없습니다. RLS 정책을 확인하세요.",
        });
        setLoading(false);
        return;
      }

      if (updatedProfile.must_change_password !== false) {
        setMsg({
          type: "err",
          text: "비밀번호는 변경됐지만 must_change_password 값이 false로 반영되지 않았습니다.",
        });
        setLoading(false);
        return;
      }

      setMsg({ type: "ok", text: "비밀번호가 변경되었습니다. 이동 중입니다..." });

      const p = (profile ?? null) as Profile | null;

      setTimeout(() => {
        router.replace("/worktalk");
      }, 700);
      } catch (e: unknown) {
      console.error(e);
      setMsg({
        type: "err",
        text:
          e instanceof Error
            ? e.message
            : "비밀번호 변경 중 오류가 발생했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }

  const currentName =
    typeof window !== "undefined" ? localStorage.getItem("name") || "" : "";
  const currentTeam =
    typeof window !== "undefined" ? localStorage.getItem("team") || "" : "";
  const currentRole =
    typeof window !== "undefined" ? localStorage.getItem("role") || "" : "";

  return (
    <main style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.topBar}>
          <BrandLogo
            subtitle="계정관리"
            subtitleTag="h1"
          />
          <button
            type="button"
            style={styles.btnMini}
            onClick={() => router.replace("/worktalk")}
            disabled={loading}
          >
            메인
          </button>
        </div>

        <div style={styles.profileGrid}>
          <div style={styles.profileBox}>
            <span style={styles.profileLabel}>이름</span>
            <strong>{currentName || "-"}</strong>
          </div>
          <div style={styles.profileBox}>
            <span style={styles.profileLabel}>부서</span>
            <strong>{currentTeam || "-"}</strong>
          </div>
          <div style={styles.profileBox}>
            <span style={styles.profileLabel}>권한</span>
            <strong>{currentRole || "-"}</strong>
          </div>
        </div>

        <h2 style={styles.sectionTitle}>비밀번호 변경</h2>

        <div style={styles.field}>
          <label style={styles.label}>새 비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            autoComplete="new-password"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>새 비밀번호 확인</label>
          <input
            type="password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            style={styles.input}
            autoComplete="new-password"
          />
        </div>

        {msg && (
          <div style={msg.type === "err" ? styles.errBox : styles.okBox}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.text}</pre>
          </div>
        )}

        <div style={styles.actions}>
          <button
            type="button"
            style={styles.btnGhost}
            onClick={() => router.replace("/worktalk")}
            disabled={loading}
          >
            취소
          </button>
          <button type="submit" style={styles.btnPrimary} disabled={loading}>
            {loading ? "변경 중..." : "변경하기"}
          </button>
        </div>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8fafc",
    padding: "24px",
    fontFamily:
      "Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "420px",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "18px",
    padding: "24px",
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "18px",
  },
  logo: {
    color: "#0f172a",
    fontSize: "24px",
    fontWeight: 800,
    lineHeight: 1,
  },
  btnMini: {
    height: "32px",
    padding: "0 11px",
    borderRadius: "9px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  title: {
    margin: 0,
    fontSize: "22px",
    fontWeight: 800,
    color: "#0f172a",
  },
  profileGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "8px",
    margin: "16px 0 20px",
  },
  profileBox: {
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    background: "#f8fafc",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minWidth: 0,
  },
  profileLabel: {
    color: "#64748b",
    fontSize: "11px",
    fontWeight: 800,
  },
  sectionTitle: {
    margin: "0 0 14px",
    fontSize: "16px",
    color: "#111827",
  },
  field: {
    display: "grid",
    gap: "8px",
    marginBottom: "14px",
  },
  label: {
    fontSize: "14px",
    fontWeight: 700,
    color: "#334155",
  },
  input: {
    width: "100%",
    height: "44px",
    borderRadius: "12px",
    border: "1px solid #cbd5e1",
    padding: "0 14px",
    fontSize: "15px",
    fontWeight: 500,
    boxSizing: "border-box",
    outline: "none",
  },
  actions: {
    marginTop: "16px",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
  },
  btnGhost: {
    height: "44px",
    borderRadius: "12px",
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    fontSize: "15px",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnPrimary: {
    height: "44px",
    borderRadius: "12px",
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: 800,
    cursor: "pointer",
  },
  okBox: {
    marginTop: "8px",
    borderRadius: "12px",
    border: "1px solid #bbf7d0",
    background: "#f0fdf4",
    color: "#166534",
    padding: "12px 14px",
    fontSize: "13px",
    fontWeight: 700,
  },
  errBox: {
    marginTop: "8px",
    borderRadius: "12px",
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
    padding: "12px 14px",
    fontSize: "13px",
    fontWeight: 700,
  },
};
