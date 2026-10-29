/**
 * Le magasin de données — un flux global, un vol partagé, des rafales
 * regroupées, une cadence relue à chaque tour.
 */
import { describe, expect, test } from "bun:test";
import type { ConversationSummary } from "@herdr-remote/shared";
import { creeMagasinDonnees, type Lectures, type OuvreEvenements } from "../src/donnees.ts";
import type { Health, Overview } from "../src/api.ts";
import { CADENCE_SECOURS_VISIBLE_MS, CADENCE_VISIBLE_MS } from "../src/rafraichissement.ts";

const overview: Overview = {
  agents: [],
  herdrProtocol: 22,
  herdrVersion: "0.9.3",
  withoutSession: 0,
  workspaces: [],
};
const health: Health = { herdr: { reachable: true, socket: "/s" }, ok: true };
const conversation = (paneId: string): ConversationSummary => ({
  agent: "pi",
  name: null,
  paneId,
  paneRank: null,
  sessionState: "available",
  status: "idle",
  tabId: "t",
  tabPaneCount: 1,
  title: paneId,
  workspaceId: "w1",
});

const horloge = () => {
  const taches: Array<{ action: () => void; delai: number }> = [];
  return {
    planifie: (action: () => void, delai: number) => {
      const tache = { action, delai };
      taches.push(tache);
      return () => {
        const index = taches.indexOf(tache);
        if (index >= 0) taches.splice(index, 1);
      };
    },
    /** Exécute les tâches dont le délai est ≤ `jusqua`. */
    avance: (jusqua: number) => {
      for (const tache of taches.filter((t) => t.delai <= jusqua)) {
        taches.splice(taches.indexOf(tache), 1);
        tache.action();
      }
    },
    taches,
  };
};

const attend = () => new Promise((resolve) => setTimeout(resolve, 0));

const monte = (lectures: Partial<Lectures> = {}) => {
  const compteurs = { conversations: 0, flux: 0, health: 0, overview: 0 };
  let gestionnaires: Parameters<OuvreEvenements>[0] | null = null;
  const h = horloge();
  const magasin = creeMagasinDonnees({
    lectures: {
      conversations: async () => {
        compteurs.conversations += 1;
        return { conversations: [conversation("w1:p1")] };
      },
      health: async () => {
        compteurs.health += 1;
        return health;
      },
      kinds: async () => [],
      overview: async () => {
        compteurs.overview += 1;
        return overview;
      },
      ...lectures,
    },
    maintenant: () => 1_000,
    ouvreEvenements: (g) => {
      compteurs.flux += 1;
      gestionnaires = g;
      return () => undefined;
    },
    planifie: h.planifie,
    visible: () => true,
  });
  const emet = (genre: string, donnees: unknown = {}) => gestionnaires?.onEvent(genre, donnees);
  const statut = (s: "live" | "down") => gestionnaires?.onStatus(s);
  return { compteurs, emet, h, magasin, statut };
};

describe("un seul flux global", () => {
  test("démarrer deux fois n'ouvre qu'un flux", () => {
    const { compteurs, magasin } = monte();
    magasin.demarre();
    magasin.demarre();
    expect(compteurs.flux).toBe(1);
  });

  test("les abonnés reçoivent les événements, la liste aussi", async () => {
    const { emet, magasin } = monte();
    magasin.demarre();
    await attend();
    const recus: string[] = [];
    magasin.ecoute((evenement) => recus.push(evenement.genre));
    emet("session_changed", { paneId: "w1:p1" });
    expect(recus).toEqual(["session_changed"]);
  });
});

describe("rafales regroupées, vol partagé", () => {
  test("cinq événements rapprochés = une seule relecture", async () => {
    const { compteurs, emet, h, magasin } = monte();
    magasin.demarre();
    await attend();
    const avant = compteurs.conversations;
    for (let index = 0; index < 5; index += 1)
      emet("agent_status", { paneId: "w1:p1", to: "idle" });
    h.avance(150);
    await attend();
    expect(compteurs.conversations - avant).toBe(1);
    // Les trois lectures partent ensemble (pas en série).
    expect(compteurs.overview).toBe(compteurs.conversations);
  });
});

describe("issues indépendantes", () => {
  test("un health en échec ne jette ni la liste ni l'overview", async () => {
    const { magasin } = monte({
      health: async () => {
        throw new Error("herdr injoignable");
      },
    });
    magasin.demarre();
    await attend();
    await attend();
    const etat = magasin.etat();
    expect(etat.conversations?.map((c) => c.paneId)).toEqual(["w1:p1"]);
    expect(etat.overview).toEqual(overview);
    expect(etat.erreurs.health).toBe("herdr injoignable");
    expect(etat.dernierSucces).toBe(1_000);
  });

  test("une liste en échec garde la dernière valeur lue et dit la cause", async () => {
    let echoue = false;
    const { magasin } = monte({
      conversations: async () => {
        if (echoue) throw new Error("502");
        return { conversations: [conversation("w1:p1")] };
      },
    });
    magasin.demarre();
    await attend();
    echoue = true;
    await magasin.rafraichit();
    expect(magasin.etat().conversations?.map((c) => c.paneId)).toEqual(["w1:p1"]);
    expect(magasin.etat().erreurs.conversations).toBe("502");
  });
});

describe("cadence relue à chaque tour", () => {
  test("le passage au direct allonge le tour suivant, sans redémarrer la boucle", async () => {
    const { h, magasin, statut } = monte();
    magasin.demarre();
    await attend();
    expect(h.taches.at(-1)?.delai).toBe(CADENCE_VISIBLE_MS);
    statut("live");
    h.avance(CADENCE_VISIBLE_MS);
    await attend();
    expect(h.taches.at(-1)?.delai).toBe(CADENCE_SECOURS_VISIBLE_MS);
    expect(h.taches.filter((t) => t.delai >= CADENCE_VISIBLE_MS)).toHaveLength(1);
  });
});

describe("début de travail observé", () => {
  test("noté au passage à working, oublié ensuite", async () => {
    const { emet, magasin } = monte();
    magasin.demarre();
    emet("agent_status", { from: "idle", kind: "status", paneId: "w1:p1", to: "working" });
    expect(magasin.etat().debutsTravail.get("w1:p1")).toBe(1_000);
    emet("agent_status", { from: "working", kind: "status", paneId: "w1:p1", to: "done" });
    expect(magasin.etat().debutsTravail.has("w1:p1")).toBe(false);
  });
});
