self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      if (windows.some((client) => client.visibilityState === "visible")) return;

      let message = {};
      try {
        message = event.data ? event.data.json() : {};
      } catch {
        message = { body: event.data ? event.data.text() : "" };
      }

      const title = typeof message.title === "string" ? message.title : "Herdr Remote";
      const options = {
        body: typeof message.body === "string" ? message.body : "An agent has an update.",
        data: { url: typeof message.url === "string" ? message.url : "/" },
        tag: typeof message.tag === "string" ? message.tag : "herdr-agent-finished",
      };
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing && "focus" in existing) {
        await existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
