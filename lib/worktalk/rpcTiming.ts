"use client";

export const WORKTALK_RPC_TIMING_EVENT = "worktalk:rpc-fetch-timing";

export type WorkTalkRpcTimingPhase =
  | "fetch_start"
  | "http_request_sent"
  | "first_byte_received"
  | "http_response_complete"
  | "fetch_error";

export type WorkTalkRpcTimingContext = {
  messageKey: string;
  roomId: number;
  bodyPreview: string;
};

export type WorkTalkRpcTimingDetail = WorkTalkRpcTimingContext & {
  rpcName: string;
  phase: WorkTalkRpcTimingPhase;
  timestamp: string;
  perf: number;
  status?: number;
  ok?: boolean;
  durationMs?: number | null;
  error?: string;
};

let activeContext: WorkTalkRpcTimingContext | null = null;

export function getWorkTalkRpcTimingContext() {
  return activeContext;
}

export function setWorkTalkRpcTimingContext(context: WorkTalkRpcTimingContext) {
  activeContext = context;
}

export function clearWorkTalkRpcTimingContext(messageKey: string) {
  if (activeContext?.messageKey === messageKey) {
    activeContext = null;
  }
}

export function createWorkTalkRpcTimingStamp() {
  const now = new Date();
  return {
    perf: performance.now(),
    timestamp: now.toLocaleTimeString("ko-KR", { hour12: false }),
  };
}

export function emitWorkTalkRpcTiming(
  detail: Omit<WorkTalkRpcTimingDetail, keyof WorkTalkRpcTimingContext> &
    Partial<WorkTalkRpcTimingContext>
) {
  if (typeof window === "undefined") return;
  const context = activeContext;
  const messageKey = detail.messageKey || context?.messageKey;
  const roomId = detail.roomId ?? context?.roomId;
  const bodyPreview = detail.bodyPreview || context?.bodyPreview;
  if (!messageKey || roomId == null || !bodyPreview) return;

  window.dispatchEvent(
    new CustomEvent<WorkTalkRpcTimingDetail>(WORKTALK_RPC_TIMING_EVENT, {
      detail: {
        messageKey,
        roomId,
        bodyPreview,
        rpcName: detail.rpcName,
        phase: detail.phase,
        timestamp: detail.timestamp,
        perf: detail.perf,
        status: detail.status,
        ok: detail.ok,
        durationMs: detail.durationMs,
        error: detail.error,
      },
    })
  );
}
