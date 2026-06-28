"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type PushStatus =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "available"
  | "subscribed"
  | "error";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type NavigatorWithInstalledApps = Navigator & {
  getInstalledRelatedApps?: () => Promise<Array<{ id?: string; platform?: string }>>;
};

const INSTALL_MARKER_KEY = "nexusTalkInstalled";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function getPushErrorMessage(error: unknown) {
  const errorRecord =
    error && typeof error === "object"
      ? (error as {
          message?: unknown;
          code?: unknown;
          details?: unknown;
          hint?: unknown;
        })
      : null;
  const parts = [
    error instanceof Error ? error.message : errorRecord?.message,
    errorRecord?.code,
    errorRecord?.details,
    errorRecord?.hint,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    )
    .filter((value, index, values) => values.indexOf(value) === index);
  const message = parts.length > 0 ? parts.join(" · ") : String(error);
  if (message.toLocaleLowerCase().includes("push service error")) {
    return "브라우저의 푸시 서비스 연결이 꺼져 있습니다. Brave에서는 설정 > 개인정보 보호 및 보안의 '푸시 메시징에 Google 서비스 사용'을 켠 뒤 브라우저를 다시 실행하거나 Chrome/Edge에서 시도해주세요.";
  }
  return message;
}

async function saveSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("푸시 구독 정보를 만들 수 없습니다.");
  }

  const supabase = createSupabaseBrowser();
  const { error } = await supabase.rpc("worktalk_save_push_subscription", {
    subscription_endpoint: json.endpoint,
    subscription_p256dh: json.keys.p256dh,
    subscription_auth: json.keys.auth,
    subscription_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export function useWorkTalkPush(enabled: boolean) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [hasInstalledApp, setHasInstalledApp] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

  const register = useCallback(async () => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setStatus("unsupported");
      return null;
    }
    if (!publicKey) {
      setStatus("unconfigured");
      return null;
    }

    const registration = await navigator.serviceWorker.register(
      "/worktalk-sw.js",
      {
        scope: "/",
        updateViaCache: "none",
      }
    );
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await saveSubscription(subscription);
    }
    setStatus(
      subscription
        ? "subscribed"
        : Notification.permission === "denied"
          ? "denied"
          : "available"
    );
    return registration;
  }, [publicKey]);

  useEffect(() => {
    if (!enabled) return;

    const timeoutId = window.setTimeout(() => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator &&
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
      const installedMarker =
        window.localStorage.getItem(INSTALL_MARKER_KEY) === "true";
      setIsIOS(ios);
      setIsStandalone(standalone);
      setHasInstalledApp(standalone || installedMarker);
      if (standalone) {
        window.localStorage.setItem(INSTALL_MARKER_KEY, "true");
      }
      const installedAppsGetter = (navigator as NavigatorWithInstalledApps)
        .getInstalledRelatedApps;
      if (typeof installedAppsGetter === "function") {
        void installedAppsGetter.call(navigator).then((apps) => {
          if (apps.length > 0) {
            window.localStorage.setItem(INSTALL_MARKER_KEY, "true");
            setHasInstalledApp(true);
          }
        });
      }
      void register().catch((error) => {
        setErrorMessage(getPushErrorMessage(error));
        setStatus("error");
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [enabled, register]);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setHasInstalledApp(false);
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setHasInstalledApp(true);
      window.localStorage.setItem(INSTALL_MARKER_KEY, "true");
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const subscribe = useCallback(async () => {
    setErrorMessage("");
    try {
      const registration = await register();
      if (!registration) return false;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return false;
      }

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      await saveSubscription(subscription);

      setStatus("subscribed");
      return true;
    } catch (error) {
      setErrorMessage(getPushErrorMessage(error));
      setStatus("error");
      return false;
    }
  }, [publicKey, register]);

  const unsubscribe = useCallback(async () => {
    setErrorMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const supabase = createSupabaseBrowser();
        const { error } = await supabase.rpc(
          "worktalk_remove_push_subscription",
          {
            subscription_endpoint: subscription.endpoint,
          }
        );
        if (error) throw error;
        await subscription.unsubscribe();
      }
      setStatus("available");
      return true;
    } catch (error) {
      setErrorMessage(getPushErrorMessage(error));
      setStatus("error");
      return false;
    }
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
      return true;
    }
    return false;
  }, [installPrompt]);

  return {
    status,
    errorMessage,
    isIOS,
    isStandalone,
    hasInstalledApp,
    canInstall: Boolean(installPrompt),
    install,
    subscribe,
    unsubscribe,
  };
}
