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
  CADENCE_VISIBLE_MS,
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
    // La cadence cachée est PLUS LENTE : un onglet sans personne devant lui
    // ne consomme pas la batterie pour un écran que personne ne regarde.
    expect(CADENCE_CACHEE_MS).toBeGreaterThan(CADENCE_VISIBLE_MS);
  });
});
