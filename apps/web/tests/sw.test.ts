/**
 * Le service worker (`public/sw.js`), exécuté tel quel dans un bac à sable :
 * un `self` simulé capture les gestionnaires, aucune vraie notification, aucun
 * vrai service push, aucun réseau.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const SOURCE = readFileSync(join(import.meta.dir, "..", "public", "sw.js"), "utf8");
const ORIGINE = "https://herdr.exemple.ts.net";

type Gestionnaire = (event: Record<string, unknown>) => void;

interface Fenetre {
  readonly url: string;
  focus: () => Promise<Fenetre>;
  navigate: (url: string) => Promise<Fenetre>;
  postMessage: (message: unknown, transfert: unknown[]) => void;
}

interface Envoi {
  readonly url: string;
  readonly methode: string;
  readonly entetes: Record<string, string>;
  readonly corps: unknown;
}

interface Bac {
  readonly declenche: (type: string, event: Record<string, unknown>) => Promise<void>;
  readonly journal: string[];
  readonly notifications: Array<{ titre: string; options: Record<string, unknown> }>;
  readonly envois: Envoi[];
}

const bac = (fenetres: Fenetre[], journal: string[] = []): Bac => {
  const gestionnaires = new Map<string, Gestionnaire>();
  const notifications: Array<{ titre: string; options: Record<string, unknown> }> = [];
  const envois: Envoi[] = [];
  const self = {
    addEventListener: (type: string, gestionnaire: Gestionnaire) => {
      gestionnaires.set(type, gestionnaire);
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => fenetres,
      openWindow: async (url: string) => {
        journal.push(`ouvre ${url}`);
        return null;
      },
    },
    location: { origin: ORIGINE },
    registration: {
      pushManager: {
        subscribe: async (options: { applicationServerKey: unknown; userVisibleOnly: boolean }) => {
          journal.push(`abonne userVisibleOnly=${String(options.userVisibleOnly)}`);
          return {
            endpoint: "https://push.example/nouvel",
            toJSON: () => ({
              endpoint: "https://push.example/nouvel",
              keys: { auth: "a", p256dh: "p" },
            }),
          };
        },
      },
      showNotification: async (titre: string, options: Record<string, unknown>) => {
        notifications.push({ options, titre });
      },
    },
    skipWaiting: () => undefined,
  };
  const faussesRequetes = async (url: string, init?: RequestInit): Promise<Response> => {
    const entetes = Object.fromEntries(new Headers(init?.headers).entries());
    envois.push({
      corps: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      entetes,
      methode: init?.method ?? "GET",
      url,
    });
    return new Response(url.endsWith("vapid-key") ? "AQID" : null, { status: 200 });
  };
  runInNewContext(SOURCE, {
    URL,
    atob,
    caches: {
      delete: async () => true,
      keys: async () => [],
      open: async (nom: string) => ({
        put: async (cle: string, reponse: Response) => {
          journal.push(
            `retient ${nom} ${cle} ${String(Reflect.get(await reponse.json(), "hash"))}`,
          );
        },
      }),
    },
    Response,
    console: { error: () => undefined },
    fetch: faussesRequetes,
    self,
  });
  const declenche = async (type: string, event: Record<string, unknown>): Promise<void> => {
    const gestionnaire = gestionnaires.get(type);
    if (gestionnaire === undefined) throw new Error(`aucun gestionnaire « ${type} »`);
    let attente: Promise<unknown> = Promise.resolve();
    gestionnaire({
      ...event,
      waitUntil: (promesse: Promise<unknown>) => {
        attente = promesse;
      },
    });
    await attente;
  };
  return { declenche, envois, journal, notifications };
};

const fenetre = (url: string, journal: string[], controlee = true): Fenetre => {
  const instance: Fenetre = {
    focus: async () => {
      journal.push("focus");
      return instance;
    },
    navigate: async (cible: string) => {
      if (!controlee) throw new TypeError("not controlled");
      journal.push(`navigue ${cible}`);
      return instance;
    },
    postMessage: (message: unknown, _transfert: unknown[]) => {
      journal.push(`message ${JSON.stringify(message)}`);
    },
    url,
  };
  return instance;
};

const pousse = (charge: unknown) => ({
  data: { json: () => charge, text: () => JSON.stringify(charge) },
});

describe("service worker — push", () => {
  test("une notification est TOUJOURS affichée, même app visible (iOS révoque les push silencieux)", async () => {
    const journal: string[] = [];
    const visible = { ...fenetre(`${ORIGINE}/`, journal), visibilityState: "visible" };
    const { declenche, notifications } = bac([visible], journal);
    await declenche(
      "push",
      pousse({
        body: "pixel · tab 1 has finished working.",
        tag: "done-w1:p1",
        title: "Agent finished",
        url: "/#/agent/w1%3Ap1",
      }),
    );
    expect(notifications).toEqual([
      {
        options: {
          body: "pixel · tab 1 has finished working.",
          data: { url: "/#/agent/w1%3Ap1" },
          tag: "done-w1:p1",
        },
        titre: "Agent finished",
      },
    ]);
  });
});

describe("service worker — clic sur une notification", () => {
  test("la fenêtre existante est focalisée D'ABORD, puis amenée sur l'agent", async () => {
    const journal: string[] = [];
    const { declenche } = bac([fenetre(`${ORIGINE}/`, journal)], journal);
    await declenche("notificationclick", {
      notification: { close: () => journal.push("ferme"), data: { url: "/#/agent/w1%3Ap1" } },
    });
    // La cible est retenue (sans retarder le focus : fenêtre d'activation).
    expect(journal).toContain(
      "retient herdr-navigation /__herdr/navigation-en-attente #/agent/w1%3Ap1",
    );
    expect(journal.filter((ligne) => !ligne.startsWith("retient"))).toEqual([
      "ferme",
      "focus",
      `navigue ${ORIGINE}/#/agent/w1%3Ap1`,
      `message ${JSON.stringify({ hash: "#/agent/w1%3Ap1", type: "herdr:navigate", url: `${ORIGINE}/#/agent/w1%3Ap1` })}`,
    ]);
  });

  test("chaque fenêtre de l'app reçoit le message, même quand `navigate` a « réussi » (iOS gelé)", async () => {
    const journal: string[] = [];
    const { declenche } = bac(
      [fenetre(`${ORIGINE}/`, journal), fenetre(`${ORIGINE}/#/agent/w2%3Ap1`, journal)],
      journal,
    );
    await declenche("notificationclick", {
      notification: { close: () => undefined, data: { url: "/#/agent/w1%3Ap1" } },
    });
    expect(journal.filter((ligne) => ligne.startsWith("message"))).toHaveLength(2);
  });

  test("une fenêtre non contrôlée reçoit l'adresse par message", async () => {
    const journal: string[] = [];
    const { declenche } = bac([fenetre(`${ORIGINE}/`, journal, false)], journal);
    await declenche("notificationclick", {
      notification: { close: () => undefined, data: { url: "/#/agent/w1%3Ap1" } },
    });
    expect(journal).toContain(
      "retient herdr-navigation /__herdr/navigation-en-attente #/agent/w1%3Ap1",
    );
    const sansReserve = journal.filter((ligne) => !ligne.startsWith("retient"));
    expect(sansReserve[0]).toBe("focus");
    expect(sansReserve[1]).toBe(
      `message ${JSON.stringify({ hash: "#/agent/w1%3Ap1", type: "herdr:navigate", url: `${ORIGINE}/#/agent/w1%3Ap1` })}`,
    );
  });

  test("sans fenêtre, une nouvelle s'ouvre directement sur l'agent", async () => {
    const journal: string[] = [];
    const { declenche } = bac([], journal);
    await declenche("notificationclick", {
      notification: { close: () => undefined, data: { url: "/#/agent/w1%3Ap1" } },
    });
    expect(journal[0]).toBe(`ouvre ${ORIGINE}/#/agent/w1%3Ap1`);
    expect(journal).toContain(
      "retient herdr-navigation /__herdr/navigation-en-attente #/agent/w1%3Ap1",
    );
  });
});

describe("service worker — abonnement renouvelé", () => {
  test("le nouvel abonnement est redonné au démon, l'ancien retiré", async () => {
    const journal: string[] = [];
    const { declenche, envois } = bac([], journal);
    await declenche("pushsubscriptionchange", {
      oldSubscription: {
        endpoint: "https://push.example/ancien",
        options: { applicationServerKey: new Uint8Array([1, 2, 3]) },
      },
    });
    expect(journal).toEqual(["abonne userVisibleOnly=true"]);
    expect(envois).toEqual([
      {
        corps: { endpoint: "https://push.example/nouvel", keys: { auth: "a", p256dh: "p" } },
        entetes: { "content-type": "application/json" },
        methode: "POST",
        url: "/api/notifications/subscriptions",
      },
      {
        corps: { unsubscribe: "https://push.example/ancien" },
        entetes: { "content-type": "application/json" },
        methode: "POST",
        url: "/api/notifications/subscriptions",
      },
    ]);
  });

  test("sans clé connue, la clé est relue sur le démon avant de se réabonner", async () => {
    const journal: string[] = [];
    const { declenche, envois } = bac([], journal);
    await declenche("pushsubscriptionchange", {});
    expect(envois[0]?.url).toBe("/api/notifications/vapid-key");
    expect(journal).toEqual(["abonne userVisibleOnly=true"]);
    expect(envois[1]?.url).toBe("/api/notifications/subscriptions");
    expect(envois).toHaveLength(2);
  });
});
