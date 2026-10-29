/**
 * La connexion en un mot (P1, parité) et le journal dédoublonné des pannes.
 */
import { describe, expect, test } from "bun:test";
import { etatConnexion, LIBELLE_CONNEXION } from "../src/connexion.ts";
import { creeMagasinDonnees } from "../src/donnees.ts";
import { creeJournal } from "../src/journal.ts";

const base = {
  dernierSucces: 1_000,
  depuisOuverture: 60_000,
  direct: "live" as const,
  enLigne: true,
  erreur: null,
};

describe("connexion : Connexion ≠ Reconnexion ≠ Hors ligne", () => {
  test("flux vivant et liste lue : en direct", () => {
    expect(etatConnexion(base).phase).toBe("direct");
  });

  test("le flux ne s'est jamais ouvert : connexion (premier démarrage)", () => {
    expect(etatConnexion({ ...base, direct: "inconnu" }).phase).toBe("connexion");
  });

  test("le flux est tombé : reconnexion, pas « connexion »", () => {
    const etat = etatConnexion({ ...base, direct: "down" });
    expect(etat.phase).toBe("reconnexion");
    expect(LIBELLE_CONNEXION[etat.phase]).toBe("Reconnecting…");
    expect(LIBELLE_CONNEXION.connexion).toBe("Connecting…");
  });

  test("la liste ne se lit plus : hors ligne, avec la cause réelle", () => {
    const etat = etatConnexion({ ...base, erreur: "Load failed" });
    expect(etat).toEqual({ cause: "Load failed", dernierSucces: 1_000, phase: "hors-ligne" });
  });

  test("l'appareil n'a pas de réseau : hors ligne, même si le flux n'a rien dit", () => {
    expect(etatConnexion({ ...base, enLigne: false }).phase).toBe("hors-ligne");
  });

  test("au démarrage, un premier échec est une connexion en cours", () => {
    expect(
      etatConnexion({
        ...base,
        dernierSucces: null,
        depuisOuverture: 1_000,
        direct: "inconnu",
        erreur: "Load failed",
      }).phase,
    ).toBe("connexion");
  });
});

describe("journal des pannes : une fois par fenêtre", () => {
  test("la même panne ne part qu'une fois ; une autre part ; après la fenêtre, elle repart", () => {
    const envoyes: string[] = [];
    let maintenant = 0;
    const journal = creeJournal(
      (message) => envoyes.push(message),
      () => maintenant,
      1_000,
    );
    journal("lecture conversations en échec", { cause: "Load failed" });
    journal("lecture conversations en échec", { cause: "Load failed" });
    journal("lecture conversations en échec", { cause: "HTTP 502" });
    expect(envoyes).toHaveLength(2);
    maintenant = 1_000;
    journal("lecture conversations en échec", { cause: "Load failed" });
    expect(envoyes).toHaveLength(3);
  });
});

describe("une lecture ratée de la liste part au journal", () => {
  test("la cause réelle est journalisée, pour la ressource qui a échoué", async () => {
    const signales: Array<{ message: string; detail: unknown }> = [];
    const magasin = creeMagasinDonnees({
      lectures: {
        conversations: () => Promise.reject(new Error("Load failed")),
        health: async () => ({ herdr: { reachable: true, socket: "s" }, ok: true }),
        kinds: async () => [],
        overview: async () => ({ agents: [], workspaces: [] }),
      },
      maintenant: () => 0,
      ouvreEvenements: () => () => undefined,
      planifie: () => () => undefined,
      signale: (message, detail) => signales.push({ detail, message }),
      visible: () => true,
    });
    await magasin.rafraichit();
    expect(signales).toEqual([
      { detail: { cause: "Load failed" }, message: "failed to read conversations" },
    ]);
  });
});
