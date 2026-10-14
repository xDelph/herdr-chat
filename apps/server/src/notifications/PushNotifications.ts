import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import webpush from "web-push";
import type { PushSubscription } from "web-push";

interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

interface PushStore {
  readonly subscriptions: ReadonlyArray<PushSubscription>;
  readonly vapidKeys?: VapidKeys;
}

export interface PushNotificationsApi {
  readonly publicKey: () => Promise<string>;
  readonly subscribe: (subscription: PushSubscription) => Promise<void>;
  readonly unsubscribe: (endpoint: string) => Promise<void>;
  /**
   * Signale qu'un agent n'est plus « en train de travailler ».
   *
   * ⚠️ **`status` n'est pas décoratif.** Le déclencheur est le passage de
   * `working` à autre chose, et cet « autre chose » peut être `blocked` — c'est
   * le cas où l'agent **attend une réponse**, donc le plus urgent de tous. Une
   * version précédente annonçait « Agent finished » dans les deux cas : le
   * téléphone disait « c'est terminé » alors que l'agent était bloqué sur une
   * question, et personne n'ouvrait l'app. C'est l'inverse du service rendu.
   */
  readonly agentFinished: (title: string, tag?: string, status?: string | null) => Promise<void>;
}

const emptyStore = (): PushStore => ({ subscriptions: [] });
const makeGate = (): { readonly promise: Promise<void>; readonly open: () => void } => {
  let resolveGate: ((value: void | PromiseLike<void>) => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return { open: () => resolveGate?.(), promise };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPushSubscription = (value: unknown): value is PushSubscription => {
  if (!isRecord(value) || typeof value.endpoint !== "string") return false;
  const keys = value.keys;
  return isRecord(keys) && typeof keys.p256dh === "string" && typeof keys.auth === "string";
};

const isVapidKeys = (value: unknown): value is VapidKeys =>
  isRecord(value) && typeof value.publicKey === "string" && typeof value.privateKey === "string";

/**
 * Contenu d'une notification.
 *
 * ⚠️ **`blocked` n'est pas `done`.** Les deux arrivent ici — l'événement est
 * « l'agent a arrêté de travailler » — mais l'un attend un humain et l'autre
 * non. Annoncer la même chose pour les deux rend la notification inutile
 * précisément quand elle compte le plus.
 *
 * ⚠️ **`url` mène à l'agent, pas à l'accueil.** Une notification qui ouvre
 * l'application sur la liste oblige à retrouver soi-même l'agent concerné, au
 * moment où l'on ne sait plus lequel c'était. Le service worker sait déjà
 * naviguer une fenêtre existante vers cette adresse (`push-sw.js`) : il
 * suffisait de lui donner la bonne.
 *
 * ⚠️ Le fragment est **encodé** : un `paneId` contient `:` (`wB:p16`), et une
 * adresse non encodée serait relue de travers au retour.
 */
export const payloadDeNotification = (
  titre: string,
  paneId: string | undefined,
  statut: string | null | undefined,
): {
  readonly body: string;
  readonly tag: string;
  readonly title: string;
  readonly url: string;
} => {
  const attend = statut === "blocked";
  const connu = titre.length > 0;
  return {
    body: attend
      ? connu
        ? `${titre} is waiting for your answer.`
        : "An agent is waiting for your answer."
      : connu
        ? `${titre} has finished working.`
        : "Your agent has finished working.",
    // Deux étiquettes distinctes : une question en attente ne doit pas être
    // remplacée en silence par un « finished » plus tardif pour le même pane.
    tag: paneId === undefined ? "herdr-agent" : `${attend ? "waiting" : "done"}-${paneId}`,
    title: attend ? "Agent needs you" : "Agent finished",
    url: paneId === undefined ? "/" : `/#/agent/${encodeURIComponent(paneId)}`,
  };
};

/** Persistent Web Push subscriptions and VAPID keys for this Herdr instance. */
export const makePushNotifications = (
  storePath: string,
  env: NodeJS.ProcessEnv = process.env,
): PushNotificationsApi => {
  const subject =
    env["HERDR_REMOTE_VAPID_SUBJECT"] ??
    env["HERDR_REMOTE_PUBLIC_ORIGINS"]
      ?.split(",")
      .map((origin) => origin.trim())
      .find((origin) => origin.startsWith("https://")) ??
    "mailto:herdr-remote@example.com";
  let queue: Promise<void> = Promise.resolve();
  const serialize = async <A>(operation: () => Promise<A>): Promise<A> => {
    const previous = queue;
    const gate = makeGate();
    queue = gate.promise;
    await previous;
    try {
      return await operation();
    } finally {
      gate.open();
    }
  };

  const readStore = async (): Promise<PushStore> => {
    try {
      const raw: unknown = JSON.parse(await readFile(storePath, "utf8"));
      if (!isRecord(raw)) throw new Error("push store is not an object");
      const rawSubscriptions = raw.subscriptions;
      if (!Array.isArray(rawSubscriptions)) throw new Error("push subscriptions are invalid");
      const subscriptions: PushSubscription[] = [];
      for (const value of rawSubscriptions) {
        if (!isPushSubscription(value)) throw new Error("push subscription is invalid");
        subscriptions.push(value);
      }
      const rawVapidKeys = raw.vapidKeys;
      if (rawVapidKeys !== undefined && !isVapidKeys(rawVapidKeys)) {
        throw new Error("push VAPID keys are invalid");
      }
      return {
        subscriptions,
        ...(rawVapidKeys === undefined ? {} : { vapidKeys: rawVapidKeys }),
      };
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return emptyStore();
      throw new Error(`Cannot read Web Push store at ${storePath}: ${String(cause)}`, {
        cause,
      });
    }
  };

  const writeStore = async (store: PushStore): Promise<void> => {
    await mkdir(dirname(storePath), { recursive: true, mode: 0o700 });
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  };

  const ensureKeys = async (store: PushStore): Promise<{ store: PushStore; keys: VapidKeys }> => {
    const publicKey = env["HERDR_REMOTE_VAPID_PUBLIC_KEY"];
    const privateKey = env["HERDR_REMOTE_VAPID_PRIVATE_KEY"];
    if (publicKey !== undefined && privateKey !== undefined) {
      return { keys: { publicKey, privateKey }, store };
    }
    if ((publicKey === undefined) !== (privateKey === undefined)) {
      throw new Error(
        "Both HERDR_REMOTE_VAPID_PUBLIC_KEY and HERDR_REMOTE_VAPID_PRIVATE_KEY are required",
      );
    }
    if (store.vapidKeys !== undefined) return { keys: store.vapidKeys, store };
    const generated = webpush.generateVAPIDKeys();
    const keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    const updated = { ...store, vapidKeys: keys };
    await writeStore(updated);
    return { keys, store: updated };
  };

  const withKeys = async <A>(
    operation: (store: PushStore, keys: VapidKeys) => Promise<A>,
  ): Promise<A> =>
    serialize(async () => {
      const store = await readStore();
      const { keys, store: ready } = await ensureKeys(store);
      return operation(ready, keys);
    });

  return {
    publicKey: () => withKeys(async (_store, keys) => keys.publicKey),
    subscribe: (subscription) =>
      withKeys(async (store) => {
        const subscriptions = store.subscriptions.filter(
          (item) => item.endpoint !== subscription.endpoint,
        );
        await writeStore({ ...store, subscriptions: [...subscriptions, subscription] });
      }),
    unsubscribe: (endpoint) =>
      withKeys(async (store) => {
        await writeStore({
          ...store,
          subscriptions: store.subscriptions.filter((item) => item.endpoint !== endpoint),
        });
      }),
    agentFinished: (title, tag, status) =>
      withKeys(async (store, keys) => {
        webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

        const payload = JSON.stringify(payloadDeNotification(title, tag, status));
        const expired = new Set<string>();
        const results = await Promise.allSettled(
          store.subscriptions.map(async (subscription) => {
            try {
              await webpush.sendNotification(subscription, payload, { TTL: 60 });
            } catch (cause) {
              const rawStatusCode =
                typeof cause === "object" && cause !== null && "statusCode" in cause
                  ? cause.statusCode
                  : undefined;
              const statusCode = typeof rawStatusCode === "number" ? rawStatusCode : undefined;
              if (statusCode === 404 || statusCode === 410) expired.add(subscription.endpoint);
              else {
                const responseBody =
                  typeof cause === "object" && cause !== null && "body" in cause
                    ? cause.body
                    : undefined;
                console.error(
                  `[push] delivery failed (HTTP ${String(statusCode ?? "unknown")}): ${String(responseBody ?? cause)}`,
                );
              }
            }
          }),
        );
        void results;
        if (expired.size > 0) {
          await writeStore({
            ...store,
            subscriptions: store.subscriptions.filter((item) => !expired.has(item.endpoint)),
          });
        }
      }),
  };
};
