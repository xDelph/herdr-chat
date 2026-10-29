/*
  Service worker de Herdr Chat — **notifications push uniquement**.

  ⚠️ Il ne met RIEN en cache et n'intercepte aucune requête (pas de `fetch`) :
  l'app ne fait que parler au démon, et sa fraîcheur vient du serveur
  (`index.html` en no-cache, fichiers hachés en immutable). Une version périmée
  ne peut donc pas être servie par ce worker.

  ⚠️ Il ne se désinscrit JAMAIS : la désinscription détruit l'abonnement push,
  et l'utilisateur cesserait de recevoir les notifications sans le savoir. Il
  garde l'URL `/sw.js` de l'ancien worker Workbox : le navigateur le traite
  comme une mise à jour du même enregistrement, et l'abonnement est conservé.
*/

self.addEventListener("install", () => {
  // Remplace l'ancien worker sans attendre la fermeture des onglets : il n'y a
  // aucun cache à garder cohérent, donc rien à protéger.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Les caches Workbox de l'ancien worker ne servent plus à rien.
      const noms = await caches.keys();
      await Promise.all(
        noms.filter((nom) => nom.startsWith("workbox-")).map((nom) => caches.delete(nom)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      // L'app est à l'écran : elle montre déjà l'état, pas de doublon.
      if (fenetres.some((client) => client.visibilityState === "visible")) return;

      let message = {};
      try {
        message = event.data ? event.data.json() : {};
      } catch {
        message = { body: event.data ? event.data.text() : "" };
      }
      const titre = typeof message.title === "string" ? message.title : "Herdr Chat";
      await self.registration.showNotification(titre, {
        body: typeof message.body === "string" ? message.body : "Un agent a du nouveau.",
        data: { url: typeof message.url === "string" ? message.url : "/" },
        tag: typeof message.tag === "string" ? message.tag : "herdr-agent",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cible = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      const existante = fenetres.find((client) => client.url.startsWith(self.location.origin));
      if (existante !== undefined && "focus" in existante) {
        await existante.navigate(cible);
        return existante.focus();
      }
      return self.clients.openWindow(cible);
    })(),
  );
});
