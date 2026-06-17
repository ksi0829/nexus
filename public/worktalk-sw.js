const WORKTALK_URL = "/worktalk";

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

  const title = payload.title || "NEXUS";
  const options = {
    body: payload.body || "새 알림이 도착했습니다.",
    icon: "/nexus-icon-192.png",
    badge: "/nexus-icon-192.png",
    tag: payload.tag || `worktalk-${Date.now()}`,
    renotify: true,
    data: {
      url: payload.url || WORKTALK_URL,
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
  const targetUrl = new URL(
    event.notification.data?.url || WORKTALK_URL,
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if ("navigate" in client) {
            await client.navigate(targetUrl);
          }
          if ("focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
