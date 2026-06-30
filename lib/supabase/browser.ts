import { createBrowserClient } from "@supabase/ssr";
import {
  createWorkTalkRpcTimingStamp,
  emitWorkTalkRpcTiming,
  getWorkTalkRpcTimingContext,
} from "@/lib/worktalk/rpcTiming";

function serializeSessionCookie(
  name: string,
  value: string,
  options?: { path?: string; sameSite?: string | boolean; maxAge?: number; expires?: Date }
) {
  const path = options?.path || "/";
  const sameSite =
    typeof options?.sameSite === "string" ? options.sameSite : "lax";
  const parts = [`${name}=${value}`, `Path=${path}`, `SameSite=${sameSite}`];

  if (options?.maxAge === 0) {
    parts.push("Max-Age=0");
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }

  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: createInstrumentedFetch(),
      },
      cookies: {
        getAll() {
          if (typeof document === "undefined" || !document.cookie) {
            return [];
          }

          return document.cookie.split("; ").map((cookie) => {
            const separatorIndex = cookie.indexOf("=");
            const name =
              separatorIndex >= 0 ? cookie.slice(0, separatorIndex) : cookie;
            const value =
              separatorIndex >= 0 ? cookie.slice(separatorIndex + 1) : "";

            return { name, value };
          });
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const sessionOptions = { ...options };

            if (sessionOptions.maxAge !== 0) {
              delete sessionOptions.maxAge;
              delete sessionOptions.expires;
            }

            document.cookie = serializeSessionCookie(
              name,
              value,
              sessionOptions
            );
          });
        },
      },
    }
  );
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isWorkTalkSendMessageRpc(url: string) {
  return url.includes("/rest/v1/rpc/worktalk_send_message");
}

function createInstrumentedFetch(): typeof fetch {
  return async (input, init) => {
    const url = getRequestUrl(input);
    if (typeof window === "undefined" || !isWorkTalkSendMessageRpc(url)) {
      return fetch(input, init);
    }

    const context = getWorkTalkRpcTimingContext();
    if (!context) {
      return fetch(input, init);
    }

    const fetchStart = createWorkTalkRpcTimingStamp();
    emitWorkTalkRpcTiming({
      ...context,
      rpcName: "worktalk_send_message",
      phase: "fetch_start",
      timestamp: fetchStart.timestamp,
      perf: fetchStart.perf,
    });

    emitWorkTalkRpcTiming({
      ...context,
      rpcName: "worktalk_send_message",
      phase: "http_request_sent",
      timestamp: fetchStart.timestamp,
      perf: fetchStart.perf,
      durationMs: 0,
    });

    try {
      const response = await fetch(input, init);
      const firstByte = createWorkTalkRpcTimingStamp();
      emitWorkTalkRpcTiming({
        ...context,
        rpcName: "worktalk_send_message",
        phase: "first_byte_received",
        timestamp: firstByte.timestamp,
        perf: firstByte.perf,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(firstByte.perf - fetchStart.perf),
      });

      void response
        .clone()
        .text()
        .then(() => {
          const complete = createWorkTalkRpcTimingStamp();
          emitWorkTalkRpcTiming({
            ...context,
            rpcName: "worktalk_send_message",
            phase: "http_response_complete",
            timestamp: complete.timestamp,
            perf: complete.perf,
            status: response.status,
            ok: response.ok,
            durationMs: Math.round(complete.perf - fetchStart.perf),
          });
        })
        .catch((error) => {
          const failed = createWorkTalkRpcTimingStamp();
          emitWorkTalkRpcTiming({
            ...context,
            rpcName: "worktalk_send_message",
            phase: "fetch_error",
            timestamp: failed.timestamp,
            perf: failed.perf,
            status: response.status,
            ok: response.ok,
            durationMs: Math.round(failed.perf - fetchStart.perf),
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return response;
    } catch (error) {
      const failed = createWorkTalkRpcTimingStamp();
      emitWorkTalkRpcTiming({
        ...context,
        rpcName: "worktalk_send_message",
        phase: "fetch_error",
        timestamp: failed.timestamp,
        perf: failed.perf,
        durationMs: Math.round(failed.perf - fetchStart.perf),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
