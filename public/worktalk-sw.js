const WORKTALK_URL = "/worktalk";
const WORKTALK_DEEP_LINK_MESSAGE = "WORKTALK_DEEP_LINK";

function toNullableString(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function logNotificationClick(step, payload = {}) {
  console.log("[WorkTalk SW notificationclick]", step, payload);
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

  const { targetUrl, roomId, messageId } = buildWorkTalkTarget(payload);
  const title = payload.title || "NEXUS";
  const options = {
    body: payload.body || "새 알림이 도착했습니다.",
    icon: "/nexus-icon-192.png",
    badge: "/nexus-icon-192.png",
    tag: payload.tag || `worktalk-${Date.now()}`,
    renotify: true,
    vibrate: [180, 80, 180],
    data: {
      targetUrl,
      url: targetUrl,
      roomId,
      room: roomId,
      messageId,
      message: messageId,
    },
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const hasVisibleClient = clients.some(
          (client) => client.visibilityState === "visible"
        );
        if (hasVisibleClient) return;
        return self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notificationData = event.notification.data || {};
  const { targetUrl, roomId, messageId } = buildWorkTalkTarget(
    notificationData
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
              });
            }

            const activeUrl = new URL(activeClient.url);
            const isWorkTalk =
              activeUrl.origin === self.location.origin &&
              activeUrl.pathname.startsWith("/worktalk");

            if (!isWorkTalk && "navigate" in activeClient) {
              logNotificationClick("navigate called", {
                from: activeClient.url,
                to: targetUrl,
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
