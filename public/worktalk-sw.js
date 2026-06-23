const WORKTALK_URL = "/worktalk";
const WORKTALK_DEEP_LINK_MESSAGE = "WORKTALK_DEEP_LINK";
const WORKTALK_PUSH_DEBUG_MESSAGE = "WORKTALK_PUSH_DEBUG";
const WORKTALK_VIBRATION_PATTERN = [240, 120, 240];

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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    icon: "/nexus-icon-192.png",
    badge: "/nexus-icon-192.png",
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
        }).then(() => clients);
      })
      .then((clients) => {
        const hasVisibleClient = clients.some(
          (client) => client.visibilityState === "visible"
        );
        if (hasVisibleClient) {
          return broadcastPushDebug({
            scope: "vibration",
            event: "vibration skipped",
            reason: "visible client",
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
