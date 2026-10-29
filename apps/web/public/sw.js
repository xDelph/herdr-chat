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

const TITRE_PAR_DEFAUT = "Herdr Chat";
const CORPS_PAR_DEFAUT = "Un agent a du nouveau.";
const TAG_PAR_DEFAUT = "herdr-agent";

/** Une erreur du worker ne doit jamais être muette : console ET journal du démon. */
const signale = async (message, cause) => {
  const detail = { message: cause instanceof Error ? cause.message : String(cause) };
  console.error(`[sw] ${message}`, cause);
  try {
    await fetch("/api/log", {
      body: JSON.stringify({ detail, level: "error", message: `service worker: ${message}` }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    // Signaler une erreur ne doit jamais en produire une : la console l'a déjà.
  }
};

/** Le message poussé par le démon : `{title, body, tag, url}` — ou du texte brut. */
const lisMessage = (event) => {
  if (!event.data) return {};
  try {
    const valeur = event.data.json();
    return valeur !== null && typeof valeur === "object" ? valeur : {};
  } catch {
    return { body: event.data.text() };
  }
};

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

/*
  ⚠️ **TOUJOURS une notification visible, même si l'app est à l'écran.**
  L'ancienne version se taisait quand une fenêtre était visible. Mais un push
  reçu sans `showNotification` est un « push silencieux », et l'abonnement est
  pris avec `userVisibleOnly: true` : Safari/iOS **révoque l'abonnement** après
  quelques push silencieux — les notifications s'arrêtent alors pour de bon,
  sans un mot. Le `tag` (waiting-/done-/gone-<pane>) remplace la notification
  précédente du même pane : pas d'empilement.
*/
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const message = lisMessage(event);
      try {
        await self.registration.showNotification(
          typeof message.title === "string" ? message.title : TITRE_PAR_DEFAUT,
          {
            body: typeof message.body === "string" ? message.body : CORPS_PAR_DEFAUT,
            data: { url: typeof message.url === "string" ? message.url : "/" },
            tag: typeof message.tag === "string" ? message.tag : TAG_PAR_DEFAUT,
          },
        );
      } catch (cause) {
        await signale("notification non affichée", cause);
      }
    })(),
  );
});

/*
  ⚠️ **Le focus d'abord.** `focus()` n'est permis que pendant la courte fenêtre
  d'activation ouverte par le clic : attendre une navigation avant de focaliser
  la consomme, et la fenêtre reste derrière (iOS, Chrome). On focalise, PUIS on
  amène l'app sur l'agent : `navigate` (une navigation de fragment, l'app suit
  `hashchange`), sinon un message `herdr:navigate` à la fenêtre. Sans fenêtre,
  on en ouvre une directement sur l'agent.
*/
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const cible = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
      const existante = fenetres.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (existante === undefined) {
        await self.clients.openWindow(cible.href);
        return;
      }
      let fenetre = existante;
      try {
        fenetre = (await existante.focus()) ?? existante;
      } catch (cause) {
        await signale("fenêtre non focalisée", cause);
      }
      if (fenetre.url === cible.href) return;
      try {
        if (typeof fenetre.navigate !== "function") throw new Error("navigate indisponible");
        await fenetre.navigate(cible.href);
      } catch {
        // Une fenêtre non contrôlée ne se navigue pas : on lui dit où aller.
        // (`Client.postMessage(message, transfer)` n'a pas de `targetOrigin` :
        // la liste de transfert est vide.)
        fenetre.postMessage({ hash: cible.hash, type: "herdr:navigate", url: cible.href }, []);
      }
    })(),
  );
});

/** La clé publique VAPID du démon, décodée (base64url → octets). */
const cleDuServeur = async () => {
  const reponse = await fetch("/api/notifications/vapid-key", { cache: "no-store" });
  if (!reponse.ok) {
    throw new Error(`clé VAPID indisponible (${String(reponse.status)})`);
  }
  const encodee = (await reponse.text()).trim();
  const completee = `${encodee}${"=".repeat((4 - (encodee.length % 4)) % 4)}`;
  const binaire = atob(completee.replace(/-/g, "+").replace(/_/g, "/"));
  const octets = new Uint8Array(binaire.length);
  for (let rang = 0; rang < binaire.length; rang += 1) octets[rang] = binaire.charCodeAt(rang);
  return octets;
};

/** Un POST JSON vers les abonnements du démon — même origine, Content-Type JSON. */
const posteAbonnement = async (corps) => {
  const reponse = await fetch("/api/notifications/subscriptions", {
    body: JSON.stringify(corps),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!reponse.ok) {
    throw new Error(
      `abonnement refusé par le démon (${String(reponse.status)}) : ${await reponse.text()}`,
    );
  }
};

/*
  ⚠️ **Un abonnement renouvelé par le navigateur doit être redonné au démon.**
  Le service push peut faire expirer ou tourner un abonnement : sans ce
  gestionnaire, le démon garde l'ancien endpoint (bientôt 410, élagué) et le
  téléphone ne reçoit plus rien jusqu'à ce que l'utilisateur rouvre les
  réglages. On se réabonne avec la même clé, on enregistre le nouveau, et on
  retire l'ancien du démon.
*/
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const ancienne = event.oldSubscription ?? null;
        let nouvelle = event.newSubscription ?? null;
        if (nouvelle === null) {
          const cle = ancienne?.options?.applicationServerKey ?? (await cleDuServeur());
          nouvelle = await self.registration.pushManager.subscribe({
            applicationServerKey: cle,
            userVisibleOnly: true,
          });
        }
        await posteAbonnement(nouvelle.toJSON());
        if (ancienne !== null && ancienne.endpoint !== nouvelle.endpoint) {
          await posteAbonnement({ unsubscribe: ancienne.endpoint });
        }
      } catch (cause) {
        await signale("réabonnement push impossible", cause);
      }
    })(),
  );
});
