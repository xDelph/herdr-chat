import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import webpush from "web-push";
import type { PushSubscription } from "web-push";
import { dejaDit, etiquetteDePane } from "@herdr-remote/shared";
import { estNumerique } from "../conversations/Summary.ts";

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
  readonly agentFinished: (
    agent: IdentiteNotification | undefined,
    tag?: string,
    status?: string | null,
  ) => Promise<void>;
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
  /*
    ⚠️ **Un agent qui n'est plus là n'a pas « fini ».** Son processus s'est
    terminé — mesuré : un vrai agent a rendu la main sans un mot, sans rapport de
    plantage, et Claude Code avait supprimé son propre fichier d'état, donc une
    sortie **propre**. Annoncer « has finished working » ferait croire à une
    réussite, et c'est faux : son travail a pu être interrompu.

    ⚠️ Et la cause n'est **pas** inventée : Herdr rend `pane.exited` avec son seul
    type, **sans code de sortie ni raison** (vérifié au schéma). On dit donc
    qu'il n'est plus là, jamais pourquoi.
  */
  const disparu = statut === "gone";
  const connu = titre.length > 0;
  const corps = (phrase: string, generique: string): string =>
    connu ? `${titre} ${phrase}` : generique;
  return {
    body: attend
      ? corps("is waiting for your answer.", "An agent is waiting for your answer.")
      : disparu
        ? corps("is no longer running.", "An agent is no longer running.")
        : corps("has finished working.", "Your agent has finished working."),
    // Trois étiquettes distinctes : une question en attente ne doit pas être
    // remplacée en silence par un « finished » plus tardif pour le même pane, et
    // une sortie ne doit pas effacer une question restée sans réponse.
    tag:
      paneId === undefined
        ? "herdr-agent"
        : `${attend ? "waiting" : disparu ? "gone" : "done"}-${paneId}`,
    title: attend ? "Agent needs you" : disparu ? "Agent stopped" : "Agent finished",
    url: paneId === undefined ? "/" : `/#/agent/${encodeURIComponent(paneId)}`,
  };
};

/**
 * Ce qu'il faut savoir d'un agent pour le **nommer** hors de l'écran.
 *
 * Sous-ensemble structurel d'`AgentView` : on ne demande que ce qui sert, et le
 * type se vérifie à la compilation au point d'appel.
 */
export interface IdentiteNotification {
  readonly agent: string | null;
  readonly name: string | null;
  readonly paneRank: number | null;
  readonly tabLabel: string | null;
  readonly tabNumber: number | null;
  readonly tabPaneCount: number;
  readonly title: string | null;
  readonly workspaceLabel: string | null;
}

/** Non vide après nettoyage, ou rien. */
const nonVide = (valeur: string | null | undefined): string | null => {
  const propre = valeur?.trim();
  return propre === undefined || propre.length === 0 ? null : propre;
};

/** `true` si `aiguille` est déjà dit par `foin`, sans tenir à la casse. */
/**
 * Nom de l'onglet : son libellé quand il dit quelque chose, son numéro sinon.
 *
 * ⚠️ **Mesuré sur Herdr 0.9.3, le 15/10 : `tabLabel` est `null` sur 3 des 7
 * agents, et `tabNumber` est renseigné sur les 7.** Un nom qui ne reposerait que
 * sur le libellé serait donc vide une fois sur deux.
 *
 * ⚠️ Le libellé est aussi **écarté quand il répète le projet** : Herdr donne
 * `atcrea` comme libellé d'onglet dans le projet `atcrea`, et la notification
 * disait « π - atcrea · atcrea ». On retombe alors sur le numéro, qui distingue.
 */
const nomDOnglet = (agent: IdentiteNotification, projet: string | null): string | null => {
  const label = nonVide(agent.tabLabel);
  if (label !== null && !estNumerique(label) && (projet === null || !dejaDit(projet, label)))
    return label;
  if (agent.tabNumber !== null) return `tab ${String(agent.tabNumber)}`;
  // Dernier recours : un libellé numérique reste plus exact que rien.
  return label;
};

/**
 * Comment nommer un agent dans une **notification**.
 *
 * ⚠️ **Une notification doit dire QUI, et elle n'a aucun contexte.** L'écran,
 * lui, a le projet autour : la liste est groupée, la conversation est ouverte.
 * Une notification arrive sur l'écran verrouillé, parfois des heures plus tard,
 * et un libellé qui suffit à l'écran n'y suffit pas.
 *
 * ⚠️ **Le défaut mesuré : un projet peut contenir plusieurs onglets du même
 * type.** `wA` (projet `pixel`) porte deux agents `pi` ; la notification ne
 * donnait que le titre du pane, identique pour les deux. Impossible de savoir
 * lequel avait fini — donc impossible d'aller voir le bon. C'est le seul cas où
 * la notification échoue complètement ; c'est aussi le plus fréquent dès qu'on
 * travaille sérieusement.
 *
 * Le nom se compose de ce qui existe, dans cet ordre : le projet, l'onglet, le
 * type d'agent. Ce qui manque est omis, rien n'est inventé — et si tout manque,
 * la chaîne est vide et le payload reprend sa phrase générique. Le titre du pane
 * passe avant le libellé du projet parce que c'est ce que l'utilisateur a sous
 * les yeux dans Herdr.
 */
export const nomDeNotification = (agent: IdentiteNotification | undefined): string => {
  if (agent === undefined) return "";
  const projet = nonVide(agent.title) ?? nonVide(agent.workspaceLabel);
  const parties: string[] = projet === null ? [] : [projet];
  const onglet = nomDOnglet(agent, projet);
  if (onglet !== null) parties.push(onglet);
  /*
    ⚠️ **La place du pane, et elle vient de la meme fonction que l'ecran.** Sans
    elle, deux agents d'un meme onglet produisaient deux notifications au texte
    IDENTIQUE — deux bannieres justes, indiscernables. La fonction est partagee
    (`nommage.ts`) : la notification ne peut donc pas dire autre chose que la
    ligne de la liste.
  */
  const pane = etiquetteDePane(agent);
  if (pane !== undefined) parties.push(pane);
  const kind = nonVide(agent.agent);
  if (kind !== null) parties.push(kind);
  return parties.join(" · ");
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
    agentFinished: (agent, tag, status) =>
      withKeys(async (store, keys) => {
        webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

        const payload = JSON.stringify(
          payloadDeNotification(nomDeNotification(agent), tag, status),
        );
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
