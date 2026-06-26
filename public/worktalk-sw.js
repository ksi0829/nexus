const WORKTALK_URL = "/worktalk";
const WORKTALK_DEEP_LINK_MESSAGE = "WORKTALK_DEEP_LINK";
const WORKTALK_PUSH_DEBUG_MESSAGE = "WORKTALK_PUSH_DEBUG";
const WORKTALK_CLIENT_STATE_MESSAGE = "WORKTALK_CLIENT_STATE";
const WORKTALK_CLIENT_STATE_REQUEST_MESSAGE = "WORKTALK_CLIENT_STATE_REQUEST";
const WORKTALK_VIBRATION_PATTERN = [240, 120, 240];
const WORKTALK_ACTIVE_CLIENT_TTL_MS = 8_000;
const worktalkClientStates = new Map();
const pendingClientStateRequests = new Map();

function toNullableString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function logNotificationClick(step, payload = {}) {
  console.log("[WorkTalk SW notificationclick]", step, payload);
}

async function broadcastPushDebug(payload = {}) {
  try {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    clients.forEach((client) => {
      try {
        client.postMessage({
          type: WORKTALK_PUSH_DEBUG_MESSAGE,
          ...payload,
        });
      } catch {
        // Debug delivery is best-effort only.
      }
    });
  } catch {
    // Debug delivery is best-effort only.
  }
}

function buildWorkTalkTarget(data = {}) {
  const roomId = toNullableString(data.roomId ?? data.room ?? data.room_id);
  const messageId = toNullableString(
    data.messageId ?? data.message ?? data.message_id
  );
  const fallbackPath = roomId
    ? `/worktalk?roomId=${encodeURIComponent(roomId)}${
        messageId ? `&messageId=${encodeURIComponent(messageId)}` : ""
      }`
    : WORKTALK_URL;
  const targetUrl = new URL(
    data.targetUrl || data.url || fallbackPath,
    self.location.origin
  ).href;

  return { targetUrl, roomId, messageId };
}

function appendPushDebugToTargetUrl(targetUrl, debug = {}, roomId = null) {
  try {
    const url = new URL(targetUrl, self.location.origin);
    if (debug.event) url.searchParams.set("swPushDebug", debug.event);
    if (debug.vibrationRequested === true) {
      url.searchParams.set("swVibration", "triggered");
    } else if (debug.vibrationRequested === false) {
      url.searchParams.set("swVibration", "skipped");
    }
    if (debug.reason) url.searchParams.set("swReason", debug.reason);
    if (debug.timestamp) url.searchParams.set("swTimestamp", debug.timestamp);
    if (roomId) url.searchParams.set("swRoom", roomId);
    return url.href;
  } catch {
    return targetUrl;
  }
}

function isActiveRoomClientVisible(roomId) {
  if (!roomId) return false;
  const now = Date.now();
  const targetRoomId = String(roomId);

  for (const [clientId, state] of worktalkClientStates.entries()) {
    if (!state || now - state.updatedAt > WORKTALK_ACTIVE_CLIENT_TTL_MS) {
      worktalkClientStates.delete(clientId);
      continue;
    }

    if (
      state.visible === true &&
      state.activeSection === "chat" &&
      state.conversationOpen === true &&
      String(state.activeRoomId || "") === targetRoomId
    ) {
      return true;
    }
  }

  return false;
}

function finishClientStateRequest(requestId) {
  const pending = pendingClientStateRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingClientStateRequests.delete(requestId);
  pending.resolve();
}

function requestClientStateRefresh(clients, roomId) {
  const windowClients = Array.isArray(clients) ? clients : [];
  if (windowClients.length === 0) return Promise.resolve();

  const requestId = `state-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingClientStateRequests.delete(requestId);
      resolve();
    }, 350);

    pendingClientStateRequests.set(requestId, {
      resolve,
      timeoutId,
      roomId: toNullableString(roomId),
    });

    windowClients.forEach((client) => {
      try {
        client.postMessage({
          type: WORKTALK_CLIENT_STATE_REQUEST_MESSAGE,
          requestId,
          roomId,
        });
      } catch {
        // State refresh is best-effort; stale state fallback still applies.
      }
    });
  });
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== WORKTALK_CLIENT_STATE_MESSAGE) return;

  const clientId = event.source?.id || data.clientId || "unknown";
  worktalkClientStates.set(clientId, {
    activeRoomId: toNullableString(data.activeRoomId),
    activeSection: toNullableString(data.activeSection),
    conversationOpen: data.conversationOpen === true,
    visible: data.visible === true,
    focused: data.focused === true,
    updatedAt: Date.now(),
  });

  if (data.requestId && pendingClientStateRequests.has(data.requestId)) {
    const pending = pendingClientStateRequests.get(data.requestId);
    if (pending?.roomId && isActiveRoomClientVisible(pending.roomId)) {
      finishClientStateRequest(data.requestId);
    }
  }
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "NEXUS",
      body: event.data ? event.data.text() : "새 알림이 도착했습니다.",
    };
  }

  let { targetUrl, roomId, messageId } = buildWorkTalkTarget(payload);
  const title = payload.title || "NEXUS";
  const receivedAt = new Date().toISOString();
  const swDebug = {
    event: "push received",
    reason: "service worker push",
    notificationShown: false,
    vibrationRequested: false,
    vibrationPattern: WORKTALK_VIBRATION_PATTERN,
    timestamp: receivedAt,
  };
  const options = {
    body: payload.body || "새 알림이 도착했습니다.",
    icon: "/notification-icon.png?v=6",
    badge: "/notification-badge.png?v=6",
    tag: payload.tag || `worktalk-${Date.now()}`,
    renotify: true,
    silent: false,
    vibrate: WORKTALK_VIBRATION_PATTERN,
    data: {
      targetUrl,
      url: targetUrl,
      roomId,
      room: roomId,
      messageId,
      message: messageId,
      swDebug,
    },
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        return broadcastPushDebug({
          scope: "notification",
          event: "push received",
          reason: "service worker push",
          roomId,
          messageId,
        })
          .then(() => requestClientStateRefresh(clients, roomId))
          .then(() => clients);
      })
      .then(() => {
        const hasActiveRoomClient = isActiveRoomClientVisible(roomId);
        if (hasActiveRoomClient) {
          return broadcastPushDebug({
            scope: "vibration",
            event: "vibration skipped",
            reason: "active room visible client",
            roomId,
            messageId,
          });
        }
        options.data.swDebug = {
          ...swDebug,
          event: "notification shown",
          reason: "background push notification",
          notificationShown: true,
          vibrationRequested: true,
          timestamp: new Date().toISOString(),
        };
        targetUrl = appendPushDebugToTargetUrl(
          targetUrl,
          options.data.swDebug,
          roomId
        );
        options.data.targetUrl = targetUrl;
        options.data.url = targetUrl;
        return self.registration
          .showNotification(title, options)
          .then(() =>
            broadcastPushDebug({
              scope: "vibration",
              event: "vibration triggered",
              reason: "background push notification",
              roomId,
              messageId,
            })
          );
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const builtTarget = buildWorkTalkTarget(
    notificationData
  );
  const roomId = builtTarget.roomId;
  const messageId = builtTarget.messageId;
  const clickDebug = {
    ...(notificationData.swDebug || {}),
    event: "notification clicked",
    reason: notificationData.swDebug?.reason || "notification click",
    vibrationRequested: notificationData.swDebug?.vibrationRequested,
    timestamp: new Date().toISOString(),
  };
  const targetUrl = appendPushDebugToTargetUrl(
    builtTarget.targetUrl,
    clickDebug,
    roomId
  );

  event.waitUntil(
    (async () => {
      logNotificationClick("notification data", notificationData);
      logNotificationClick("targetUrl", { targetUrl, roomId, messageId });

      try {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const appClients = clients.filter((client) => {
          try {
            return new URL(client.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });

        logNotificationClick("matched clients count", {
          total: clients.length,
          sameOrigin: appClients.length,
        });

        for (const client of appClients) {
          logNotificationClick("client url", { url: client.url });
          try {
            let activeClient = client;

            if ("focus" in activeClient) {
              logNotificationClick("focus called", { url: activeClient.url });
              activeClient = await activeClient.focus();
              logNotificationClick("focus result", {
                url: activeClient.url,
                visibilityState: activeClient.visibilityState,
                focused: activeClient.focused,
              });
              if (
                activeClient.visibilityState &&
                activeClient.visibilityState !== "visible"
              ) {
                logNotificationClick("openWindow called", {
                  targetUrl,
                  fallback: "focus did not foreground",
                  visibilityState: activeClient.visibilityState,
                });
                await self.clients.openWindow(targetUrl);
                return;
              }
            }

            if ("postMessage" in activeClient) {
              activeClient.postMessage({
                type: WORKTALK_DEEP_LINK_MESSAGE,
                targetUrl,
                url: targetUrl,
                roomId,
                room: roomId,
                messageId,
                message: messageId,
                swDebug: clickDebug,
              });
            }

            const activeUrl = new URL(activeClient.url);
            const isWorkTalk =
              activeUrl.origin === self.location.origin &&
              activeUrl.pathname.startsWith("/worktalk");

            if (
              "navigate" in activeClient &&
              (!isWorkTalk || activeClient.url !== targetUrl)
            ) {
              logNotificationClick("navigate called", {
                from: activeClient.url,
                to: targetUrl,
                isWorkTalk,
              });
              const navigatedClient = await activeClient.navigate(targetUrl);
              if (navigatedClient && "focus" in navigatedClient) {
                logNotificationClick("focus called", {
                  url: navigatedClient.url,
                  afterNavigate: true,
                });
                await navigatedClient.focus();
              }
            }

            return;
          } catch (error) {
            logNotificationClick("error", {
              branch: "existing client",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        logNotificationClick("openWindow called", { targetUrl });
        await self.clients.openWindow(targetUrl);
      } catch (error) {
        logNotificationClick("error", {
          branch: "open window fallback",
          message: error instanceof Error ? error.message : String(error),
        });
        logNotificationClick("openWindow called", { targetUrl, fallback: true });
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});
