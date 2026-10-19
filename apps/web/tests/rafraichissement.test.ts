/**
 * C23 — le client de données partagé (T059).
 *
 * ⚠️ **Les trois défauts, chacun avec sa mesure :**
 *
 * 1. `Promise.all` tout-ou-rien : un `health` en échec jetait une liste
 *    pourtant lue. Le test fait échouer le health et exige que l'overview et
 *    les conversations **survivent**.
 * 2. Aucun vol unique : huit signaux simultanés lançaient huit lectures. Le
 *    test les lance ensemble et exige **une** lecture par endpoint.
 * 3. Aucune génération : une réponse lente écrasait une plus récente. Le test
 *    ordonne deux vols et exige que l'ancien soit ignoré.
 */
import { describe, expect, test } from "bun:test";
import {
  auMoinsUneReussie,
  cadence,
  creeClient,
  doitAppliquer,
  CADENCE_CACHEE_MS,
  CADENCE_SECOURS_CACHEE_MS,
  CADENCE_SECOURS_VISIBLE_MS,
  CADENCE_VISIBLE_MS,
  EVENEMENTS_RAFRAICHISSANTS,
  creeRegroupement,
  type Lectures,
  type Resultat,
} from "../src/rafraichissement.ts";

/** Un résultat synthétique, pour la règle de génération. */
const resultatDe = (
  generation: number,
): Resultat<Record<string, never>, Record<string, never>, { conversations: [] }> => ({
  conversations: { ok: true, valeur: { conversations: [] } },
  generation,
  health: { ok: true, valeur: {} },
  overview: { ok: true, valeur: {} },
});

const lecturesFixes = (): Lectures & { compteurs: Record<string, number> } => {
  const compteurs = { conversations: 0, health: 0, overview: 0 };
  return {
    compteurs,
    conversations: async () => {
      compteurs.conversations += 1;
      return { conversations: [] };
    },
    health: async () => {
      compteurs.health += 1;
      return { herdr: { reachable: true, socket: "s" }, ok: true };
    },
    overview: async () => {
      compteurs.overview += 1;
      return { agents: [], workspaces: [] };
    },
  };
};

describe("C23 — huit signaux, UN vol", () => {
  test("huit appels simultanés ne lancent qu'une lecture par endpoint", async () => {
    const lectures = lecturesFixes();
    const client = creeClient(lectures);
    const appels = Array.from({ length: 8 }, () => client.lit());
    // Un seul vol réel : le compteur du client, et ceux des lectures.
    expect(client.vols()).toBe(1);
    await Promise.all(appels);
    expect(lectures.compteurs).toEqual({ conversations: 1, health: 1, overview: 1 });
    // Une fois le vol terminé, un nouveau signal relance — c'est voulu : le
    // vol unique ne fige pas le client.
    await client.lit();
    expect(client.vols()).toBe(2);
  });

  test("les huit appelants reçoivent le MÊME résultat", async () => {
    const client = creeClient(lecturesFixes());
    const [a, b, c] = await Promise.all([client.lit(), client.lit(), client.lit()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("C23 — un échec ne détruit pas les réussites", () => {
  test("health en panne : overview et conversations restent lisibles", async () => {
    const client = creeClient({
      conversations: async () => ({ conversations: [] }),
      health: async () => {
        throw new Error("Herdr injoignable");
      },
      overview: async () => ({ agents: [], workspaces: [] }),
    });
    const resultat = await client.lit();
    expect(resultat.health.ok).toBe(false);
    expect(resultat.health.ok ? "" : resultat.health.cause).toContain("Herdr injoignable");
    // ⚠️ C'est le cœur de C23 : les deux autres ne sont PAS jetées.
    expect(resultat.overview.ok).toBe(true);
    expect(resultat.conversations.ok).toBe(true);
    expect(auMoinsUneReussie(resultat)).toBe(true);
  });

  test("les trois en panne : au moins une réussie = faux", async () => {
    const client = creeClient({
      conversations: () => Promise.reject(new Error("a")),
      health: () => Promise.reject(new Error("b")),
      overview: () => Promise.reject(new Error("c")),
    });
    const resultat = await client.lit();
    expect(auMoinsUneReussie(resultat)).toBe(false);
  });
});

describe("C23 — une réponse tardive n'écrase pas une plus récente", () => {
  test("la règle : seul un résultat PLUS RÉCENT s'applique", () => {
    // L'ancien (gén. 7) arrive après le récent (gén. 8) : ignoré.
    expect(doitAppliquer(resultatDe(7), 8)).toBe(false);
    // Le récent s'applique ; un identique ne se réapplique pas.
    expect(doitAppliquer(resultatDe(9), 8)).toBe(true);
    expect(doitAppliquer(resultatDe(8), 8)).toBe(false);
  });

  test("chaque vol porte une génération STRICTEMENT croissante", async () => {
    const client = creeClient(lecturesFixes());
    const premier = await client.lit();
    const second = await client.lit();
    expect(second.generation).toBeGreaterThan(premier.generation);
    // Le consommateur peut donc ordonner sans horloge : le numéro suffit.
    expect(doitAppliquer(premier, second.generation)).toBe(false);
  });
});

describe("C26 — deux cadences, et un retour immédiat", () => {
  test("visible = 4 s, caché = 60 s", () => {
    expect(cadence(true)).toBe(CADENCE_VISIBLE_MS);
    expect(cadence(false)).toBe(CADENCE_CACHEE_MS);
    // ⚠️ Quand le flux parle, le minuteur n'est plus la source de fraîcheur :
    // il devient un filet, et sa cadence s'espace (30 s / 120 s).
    expect(cadence(true, true)).toBe(CADENCE_SECOURS_VISIBLE_MS);
    expect(cadence(false, true)).toBe(CADENCE_SECOURS_CACHEE_MS);
    expect(cadence(true, true)).toBeGreaterThan(CADENCE_VISIBLE_MS);
    // Un flux muet ramène la cadence serrée : un écran figé serait pire.
    expect(cadence(true, false)).toBe(CADENCE_VISIBLE_MS);
    // La cadence cachée est PLUS LENTE : un onglet sans personne devant lui
    // ne consomme pas la batterie pour un écran que personne ne regarde.
    expect(CADENCE_CACHEE_MS).toBeGreaterThan(CADENCE_VISIBLE_MS);
  });
});

/** Un planificateur qui n'exécute rien : les actions sont déclenchées à la main. */
const planificateur = (): {
  readonly programmees: Array<() => void>;
  readonly planifier: (action: () => void, delai: number) => number;
  readonly annuler: (jeton: number) => void;
  readonly annules: number[];
} => {
  const programmees: Array<() => void> = [];
  const annules: number[] = [];
  return {
    // `clearTimeout` annule VRAIMENT l'action : le faux doit faire pareil,
    // sinon le test prouverait seulement que l'annulation est appelée.
    annuler: (jeton: number) => {
      annules.push(jeton);
      programmees[jeton - 1] = () => {};
    },
    annules,
    planifier: (action: () => void) => {
      programmees.push(action);
      return programmees.length;
    },
    programmees,
  };
};

describe("le regroupement des rafales", () => {
  test("cinq événements rapprochés ne font QU'UNE lecture", () => {
    // ⚠️ Le client « un vol à la fois » fond deux appels simultanés, pas deux
    // appels consécutifs : une rafale de cinq événements lançait cinq vols à la
    // queue leu leu. Le regroupement est donc en amont du client.
    const horloge = planificateur();
    let lectures = 0;
    const regroupement = creeRegroupement(
      () => {
        lectures += 1;
      },
      150,
      horloge.planifier,
      horloge.annuler,
    );
    for (let indice = 0; indice < 5; indice += 1) regroupement.signale();
    expect(horloge.programmees).toHaveLength(1);
    expect(lectures).toBe(0);
    horloge.programmees[0]?.();
    expect(lectures).toBe(1);
    expect(regroupement.lectures()).toBe(1);
  });

  test("un événement APRÈS le lot en ouvre un nouveau", () => {
    const horloge = planificateur();
    let lectures = 0;
    const regroupement = creeRegroupement(
      () => {
        lectures += 1;
      },
      150,
      horloge.planifier,
      horloge.annuler,
    );
    regroupement.signale();
    horloge.programmees[0]?.();
    regroupement.signale();
    expect(horloge.programmees).toHaveLength(2);
    horloge.programmees[1]?.();
    expect(lectures).toBe(2);
  });

  test("annuler empêche la lecture en attente", () => {
    const horloge = planificateur();
    let lectures = 0;
    const regroupement = creeRegroupement(
      () => {
        lectures += 1;
      },
      150,
      horloge.planifier,
      horloge.annuler,
    );
    regroupement.signale();
    regroupement.annule();
    expect(horloge.annules).toHaveLength(1);
    horloge.programmees[0]?.();
    expect(lectures).toBe(0);
  });

  test("la liste des événements est celle du serveur", () => {
    // Les cinq noms publiés par `EvenementSse` (hors `ready`/`resync`, qui ont
    // leurs chemins propres). Un nom oublié = un écran qui ne bouge pas.
    expect([...EVENEMENTS_RAFRAICHISSANTS].toSorted()).toEqual([
      "agent-launched",
      "agent_status",
      "prompt",
      "prompt-suppressed",
      "session_changed",
    ]);
  });
});
