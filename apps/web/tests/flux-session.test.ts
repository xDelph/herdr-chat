/**
 * Le suivi en direct d'une conversation (STREAMING.md §4) — avec des doubles.
 *
 * Ce qui est vérifié, et pourquoi :
 *
 * - la page de queue s'affiche, puis le flux s'ouvre **depuis son curseur** ;
 * - `entries` fusionne par identifiant (une ligne réécrite remplace l'ancienne) ;
 * - `reset` remplace la vue, `gone` ferme sans reconnecter et montre la cause ;
 * - un flux qui répond 404 (`CLOSED` avant `open`) bascule sur le **repli**, qui
 *   relit par curseur sur les signaux du flux global — le comportement contre
 *   les démons d'aujourd'hui ;
 * - une lecture partie avant un `reset` est **rejetée** à son retour ;
 * - après `ferme()`, plus rien ne s'applique.
 */
import { describe, expect, test } from "bun:test";
import type { SessionEntry, SessionResponse } from "@herdr-remote/shared";
import {
  creeSuiviSession,
  FERME,
  FILET_REPLI_MS,
  type LitSession,
  RETOUR_FLUX_MS,
  SILENCE_MAX_MS,
  type SourceDEvenements,
  urlDuFlux,
  VEILLE_MS,
  type VerdictSonde,
} from "../src/flux-session.ts";

const entree = (id: string, texte = id): SessionEntry => ({
  id,
  raw: JSON.stringify({ message: { content: texte, role: "assistant" }, type: "message" }),
  type: "message",
});

const demande = (id: string): SessionEntry => ({
  id,
  raw: JSON.stringify({ message: { content: "fais-le", role: "user" }, type: "message" }),
  type: "message",
});

const page = (changement: Partial<SessionResponse>): SessionResponse => ({
  cause: "vide",
  cursor: "c1",
  entries: [],
  hasMore: false,
  incremental: false,
  reset: false,
  sessionPath: "/s.jsonl",
  ...changement,
});

/** Un `EventSource` factice, piloté par le test. */
class FauxFlux implements SourceDEvenements {
  readyState = 0;
  ferme = false;
  readonly ecouteurs = new Map<string, Array<(evenement: { data?: unknown }) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, ecouteur: (evenement: { data?: unknown }) => void): void {
    this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), ecouteur]);
  }
  close(): void {
    this.ferme = true;
    this.readyState = FERME;
  }
  emet(type: string, data?: unknown): void {
    if (type === "open") this.readyState = 1;
    for (const ecouteur of this.ecouteurs.get(type) ?? []) {
      ecouteur({
        data: typeof data === "string" || data === undefined ? data : JSON.stringify(data),
      });
    }
  }
}

const planificateur = () => {
  const taches: Array<{ action: () => void; delai: number }> = [];
  return {
    avance: (jusqua: number) => {
      for (const tache of taches.filter((t) => t.delai <= jusqua)) {
        taches.splice(taches.indexOf(tache), 1);
        tache.action();
      }
    },
    planifie: (action: () => void, delai: number) => {
      const tache = { action, delai };
      taches.push(tache);
      return () => {
        const index = taches.indexOf(tache);
        if (index >= 0) taches.splice(index, 1);
      };
    },
    taches,
  };
};

const attend = () => new Promise((resolve) => setTimeout(resolve, 0));

const monte = (options: {
  readonly lit: LitSession;
  readonly flux?: boolean;
  readonly indisponible?: (cause: string) => void;
  readonly sonde?: (url: string) => Promise<VerdictSonde>;
  readonly maintenant?: () => number;
}) => {
  const flux: FauxFlux[] = [];
  const horloge = planificateur();
  const suivi = creeSuiviSession({
    aUneSession: true,
    contientDemande: (entries) => entries.some((e) => e.raw.includes('"role":"user"')),
    fluxIndisponible: options.indisponible,
    lit: options.lit,
    maintenant: options.maintenant,
    sonde: options.sonde,
    ouvreFlux:
      options.flux === false
        ? null
        : (url) => {
            const nouveau = new FauxFlux(url);
            flux.push(nouveau);
            return nouveau;
          },
    paneId: "w1:p1",
    planifie: horloge.planifie,
  });
  return { flux, horloge, suivi };
};

describe("ouverture : queue puis flux", () => {
  test("la page de queue s'affiche et le flux reprend depuis son curseur", async () => {
    const appels: unknown[] = [];
    const { flux, suivi } = monte({
      lit: async (_pane, options) => {
        appels.push(options);
        return page({ cursor: "apres-queue", entries: [demande("u1"), entree("a1")] });
      },
    });
    suivi.demarre();
    await attend();

    expect(appels).toEqual([{ tail: 256 * 1024 }]);
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1", "a1"]);
    expect(flux[0]?.url).toBe(urlDuFlux("w1:p1", "apres-queue"));
    expect(flux[0]?.url).toBe("/api/agents/w1%3Ap1/stream?cursor=apres-queue");
  });

  test("`entries` fusionne par identifiant et retient le curseur", async () => {
    const { flux, suivi } = monte({
      lit: async () => page({ entries: [demande("u1"), entree("a1", "début")] }),
    });
    suivi.demarre();
    await attend();
    const source = flux[0];
    source?.emet("open");
    source?.emet("entries", {
      caughtUp: true,
      cursor: "c2",
      entries: [entree("a1", "début et fin"), entree("a2")],
    });

    expect(suivi.vue().transport).toBe("flux");
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1", "a1", "a2"]);
    expect(suivi.vue().entries[1]?.raw).toContain("début et fin");
  });

  test("un événement reçu vaut ouverture (mandataire qui retient les en-têtes)", async () => {
    const { flux, suivi } = monte({ lit: async () => page({ entries: [demande("u1")] }) });
    suivi.demarre();
    await attend();
    expect(suivi.vue().transport).toBe("aucun");
    flux[0]?.emet("entries", { caughtUp: true, cursor: "c2", entries: [entree("a1")] });
    expect(suivi.vue().transport).toBe("flux");
    // Une erreur ensuite n'est plus un échec d'ouverture : pas de repli.
    flux[0]?.emet("error");
    flux[0]?.emet("error");
    flux[0]?.emet("error");
    expect(suivi.vue().transport).toBe("flux");
  });

  test("rejouer le même événement ne duplique rien", async () => {
    const { flux, suivi } = monte({ lit: async () => page({ entries: [demande("u1")] }) });
    suivi.demarre();
    await attend();
    const charge = { caughtUp: true, cursor: "c2", entries: [entree("a1")] };
    flux[0]?.emet("entries", charge);
    flux[0]?.emet("entries", charge);
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1", "a1"]);
  });

  test("`reset` remplace toute la vue", async () => {
    const { flux, suivi } = monte({
      lit: async () => page({ entries: [demande("u1"), entree("a1")] }),
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet(
      "reset",
      page({ cursor: "neuf", entries: [demande("n1")], previousCursor: "avant-neuf" }),
    );
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["n1"]);
    expect(suivi.vue().precedent).toBe("avant-neuf");
  });

  test("`gone` ferme le flux, montre la cause et ne reconnecte pas", async () => {
    const { flux, horloge, suivi } = monte({ lit: async () => page({ entries: [demande("u1")] }) });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    flux[0]?.emet("gone", { reason: "le pane n'a plus de session lisible" });

    expect(flux[0]?.ferme).toBe(true);
    expect(suivi.vue().fin).toBe("le pane n'a plus de session lisible");
    expect(suivi.vue().transport).toBe("aucun");
    horloge.avance(Number.POSITIVE_INFINITY);
    expect(flux).toHaveLength(1);
    // Le fil reste lisible.
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1"]);
  });

  test("un événement illisible est dit, et la session est relue par HTTP", async () => {
    const lectures: unknown[] = [];
    const { flux, suivi } = monte({
      lit: async (_p, options) => {
        lectures.push(options);
        return page({ cursor: "c9", entries: [demande("u1")], incremental: lectures.length > 1 });
      },
    });
    suivi.demarre();
    await attend();
    const avertissements: Array<string | null> = [];
    suivi.souscrire(() => avertissements.push(suivi.vue().avertissement));
    flux[0]?.emet("entries", "{pas du json");
    await attend();
    expect(avertissements.some((texte) => texte?.includes("illisible") === true)).toBe(true);
    // La relecture qui suit est partie, depuis le dernier curseur sûr.
    expect(lectures).toEqual([{ tail: 256 * 1024 }, { cursor: "c9" }]);
  });
});

describe("repli : le démon ne sert pas encore le flux", () => {
  test("un 404 (CLOSED avant open) bascule sur la relecture par curseur", async () => {
    const lectures: unknown[] = [];
    const causes: string[] = [];
    const { flux, horloge, suivi } = monte({
      indisponible: (cause) => causes.push(cause),
      // La sonde prouve que la ROUTE manque : là seulement, on le déclare.
      sonde: async () => ({ detail: "route inconnue", nature: "route-absente" }),
      lit: async (_p, options) => {
        lectures.push(options);
        return lectures.length === 1
          ? page({ cursor: "c1", entries: [demande("u1")] })
          : page({ cursor: `c${String(lectures.length)}`, entries: [], incremental: true });
      },
    });
    suivi.demarre();
    await attend();
    const source = flux[0];
    if (source === undefined) throw new Error("flux attendu");
    source.readyState = FERME;
    source.emet("error");
    await attend();

    expect(suivi.vue().transport).toBe("repli");
    expect(causes).toHaveLength(1);
    // Le repli rattrape tout de suite depuis le curseur de la queue.
    expect(lectures[1]).toEqual({ cursor: "c1" });

    // Un `session_changed` global déclenche une relecture regroupée.
    suivi.signale();
    suivi.signale();
    horloge.avance(200);
    await attend();
    expect(lectures).toHaveLength(3);
    expect(lectures[2]).toEqual({ cursor: "c2" });

    // Le filet relit même sans signal.
    horloge.avance(FILET_REPLI_MS);
    await attend();
    expect(lectures).toHaveLength(4);
  });

  test("un pane refusé (404 `no_source`) reste LOCAL : le direct des autres ne tombe pas", async () => {
    /*
      ⚠️ Le défaut (P1) : un pane inconnu ou mort passait le DÉMON entier en
      « flux indisponible » cinq minutes — toutes les conversations perdaient
      le direct, et l'en-tête affirmait que le démon ne servait pas le flux.
    */
    const causes: string[] = [];
    const { flux, suivi } = monte({
      indisponible: (cause) => causes.push(cause),
      lit: async () => page({ entries: [demande("u1")] }),
      sonde: async () => ({ detail: "aucune source pour ce pane", nature: "pane" }),
    });
    suivi.demarre();
    await attend();
    const source = flux[0];
    if (source === undefined) throw new Error("flux attendu");
    source.readyState = FERME;
    source.emet("error");
    await attend();
    await attend();
    expect(suivi.vue().transport).toBe("repli");
    expect(causes).toHaveLength(0);
    expect(suivi.vue().causeRepli).toContain("aucune source pour ce pane");
  });

  test("sans sonde, rien n'est déclaré au reste de l'application", async () => {
    const causes: string[] = [];
    const { flux, suivi } = monte({
      indisponible: (cause) => causes.push(cause),
      lit: async () => page({ entries: [demande("u1")] }),
    });
    suivi.demarre();
    await attend();
    const source = flux[0];
    if (source === undefined) throw new Error("flux attendu");
    source.readyState = FERME;
    source.emet("error");
    await attend();
    expect(suivi.vue().transport).toBe("repli");
    expect(causes).toHaveLength(0);
  });

  test("un échec passager retente le flux plus tard", async () => {
    const { flux, horloge, suivi } = monte({
      lit: async () => page({ entries: [demande("u1")] }),
      sonde: async () => ({ detail: null, nature: "passager" }),
    });
    suivi.demarre();
    await attend();
    const source = flux[0];
    if (source === undefined) throw new Error("flux attendu");
    source.readyState = FERME;
    source.emet("error");
    await attend();
    await attend();
    expect(flux).toHaveLength(1);
    horloge.avance(RETOUR_FLUX_MS);
    expect(flux).toHaveLength(2);
    flux[1]?.emet("open");
    expect(suivi.vue().transport).toBe("flux");
  });

  test("trois erreurs sans ouverture suffisent aussi", async () => {
    const { flux, suivi } = monte({ lit: async () => page({ entries: [demande("u1")] }) });
    suivi.demarre();
    await attend();
    flux[0]?.emet("error");
    flux[0]?.emet("error");
    expect(suivi.vue().transport).toBe("aucun");
    flux[0]?.emet("error");
    expect(suivi.vue().transport).toBe("repli");
    expect(flux[0]?.ferme).toBe(true);
  });

  test("en direct, un signal global ne relit rien (le flux porte le contenu)", async () => {
    let lectures = 0;
    const { flux, horloge, suivi } = monte({
      lit: async () => {
        lectures += 1;
        return page({ entries: [demande("u1")] });
      },
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    suivi.signale();
    horloge.avance(Number.POSITIVE_INFINITY);
    await attend();
    expect(lectures).toBe(1);
  });

  test("sans flux connu, le repli est immédiat", async () => {
    const { flux, suivi } = monte({
      flux: false,
      lit: async () => page({ entries: [demande("u1")] }),
    });
    suivi.demarre();
    await attend();
    expect(flux).toHaveLength(0);
    expect(suivi.vue().transport).toBe("repli");
  });
});

describe("un flux muet n'est pas un flux vivant", () => {
  test("au retour au premier plan, un flux qui n'est plus ouvert est recréé", async () => {
    let lectures = 0;
    const { flux, suivi } = monte({
      lit: async () => {
        lectures += 1;
        return page({ cursor: `c${String(lectures)}`, entries: [demande("u1")] });
      },
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    // iOS a suspendu la page : le flux est fermé sans erreur visible.
    if (flux[0] !== undefined) flux[0].readyState = FERME;
    suivi.reveille();
    await attend();
    expect(lectures).toBe(2);
    expect(flux).toHaveLength(2);
    expect(flux[0]?.ferme).toBe(true);
  });

  test("au retour, un flux toujours ouvert est gardé — mais on rattrape par HTTP", async () => {
    let lectures = 0;
    const { flux, suivi } = monte({
      lit: async () => {
        lectures += 1;
        return page({ entries: [demande("u1")] });
      },
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    suivi.reveille();
    await attend();
    expect(lectures).toBe(2);
    expect(flux).toHaveLength(1);
  });

  test("après 45 s de silence, une lecture témoin qui apporte du neuf recrée le flux", async () => {
    let maintenant = 0;
    let lectures = 0;
    const { flux, horloge, suivi } = monte({
      lit: async (_p, options) => {
        lectures += 1;
        return "cursor" in options && options.cursor !== undefined
          ? page({ cursor: "c9", entries: [entree("manque")], incremental: true })
          : page({ cursor: "c1", entries: [demande("u1")] });
      },
      maintenant: () => maintenant,
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    // Silence plus court que le seuil : la veille ne lit rien.
    maintenant = SILENCE_MAX_MS - 1;
    horloge.avance(VEILLE_MS);
    await attend();
    expect(lectures).toBe(1);
    // Au-delà : la lecture témoin rapporte une ligne que le flux a manquée.
    maintenant = SILENCE_MAX_MS + 1;
    horloge.avance(VEILLE_MS);
    await attend();
    expect(lectures).toBe(2);
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1", "manque"]);
    expect(flux).toHaveLength(2);
    expect(flux[1]?.url).toBe(urlDuFlux("w1:p1", "c9"));
  });

  test("un silence sans manque ne fait pas reconnecter (conversation au repos)", async () => {
    let maintenant = 0;
    const { flux, horloge, suivi } = monte({
      lit: async (_p, options) =>
        "cursor" in options && options.cursor !== undefined
          ? page({ cursor: "c1", entries: [], incremental: true })
          : page({ cursor: "c1", entries: [demande("u1")] }),
      maintenant: () => maintenant,
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    maintenant = SILENCE_MAX_MS + 1;
    horloge.avance(VEILLE_MS);
    await attend();
    expect(flux).toHaveLength(1);
  });
});

describe("un flux tombé est recréé, avec un délai croissant, depuis le dernier curseur", () => {
  /*
    ⚠️ Mesuré : après une coupure réseau de 4 s, aucun flux ne se rouvrait en
    60 s — seul le filet de relecture reprenait.
  */
  test("CLOSED après avoir vécu : recréé à 1 s, puis 2 s, avec ?cursor= du dernier appliqué", async () => {
    const { flux, horloge, suivi } = monte({
      lit: async () => page({ cursor: "c1", entries: [demande("u1")] }),
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    flux[0]?.emet("entries", { caughtUp: true, cursor: "c7", entries: [entree("a1")] });
    if (flux[0] !== undefined) flux[0].readyState = FERME;
    flux[0]?.emet("error");
    expect(flux).toHaveLength(1);
    horloge.avance(1_000);
    expect(flux).toHaveLength(2);
    expect(flux[1]?.url).toBe(urlDuFlux("w1:p1", "c7"));
    expect(flux[0]?.ferme).toBe(true);
    // Le réseau est toujours coupé : la nouvelle échoue avant d'ouvrir — on
    // reprend (2 s), on ne bascule pas en repli.
    flux[1]?.emet("error");
    expect(suivi.vue().transport).toBe("flux");
    horloge.avance(1_000);
    expect(flux).toHaveLength(2);
    horloge.avance(2_000);
    expect(flux).toHaveLength(3);
    // Elle s'ouvre : le délai repart du début.
    flux[2]?.emet("open");
    flux[2]?.emet("error");
    horloge.avance(1_000);
    expect(flux).toHaveLength(4);
  });

  test("le navigateur reprend seul avant l'échéance : pas de recréation", async () => {
    const { flux, horloge, suivi } = monte({
      lit: async () => page({ entries: [demande("u1")] }),
    });
    suivi.demarre();
    await attend();
    flux[0]?.emet("open");
    flux[0]?.emet("error");
    flux[0]?.emet("open");
    horloge.avance(10_000);
    expect(flux).toHaveLength(1);
  });
});

describe("résultats périmés", () => {
  test("une lecture partie avant un `reset` est rejetée à son retour", async () => {
    let libere: ((valeur: SessionResponse) => void) | undefined;
    let n = 0;
    const { flux, suivi } = monte({
      lit: (_p, _options) => {
        n += 1;
        if (n === 1) return Promise.resolve(page({ entries: [demande("u1")] }));
        return new Promise<SessionResponse>((resolve) => {
          libere = resolve;
        });
      },
    });
    suivi.demarre();
    await attend();
    // Un événement illisible lance une relecture HTTP… qui traîne.
    flux[0]?.emet("entries", "illisible");
    // Pendant ce temps, le flux remplace la vue.
    flux[0]?.emet("reset", page({ cursor: "neuf", entries: [demande("n1")] }));
    libere?.(page({ entries: [entree("ancien")], incremental: true }));
    await attend();
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["n1"]);
  });

  test("après ferme(), plus rien ne s'applique", async () => {
    let libere: ((valeur: SessionResponse) => void) | undefined;
    const { flux, suivi } = monte({
      lit: () =>
        new Promise<SessionResponse>((resolve) => {
          libere = resolve;
        }),
    });
    suivi.demarre();
    suivi.ferme();
    libere?.(page({ entries: [demande("u1")] }));
    await attend();
    expect(suivi.vue().entries).toEqual([]);
    expect(flux).toHaveLength(0);
  });

  test("une session absente n'est jamais demandée", async () => {
    let lectures = 0;
    const suivi = creeSuiviSession({
      aUneSession: false,
      contientDemande: () => true,
      lit: async () => {
        lectures += 1;
        return page({});
      },
      ouvreFlux: null,
      paneId: "w1:p1",
      planifie: () => () => undefined,
    });
    suivi.demarre();
    await attend();
    expect(lectures).toBe(0);
    expect(suivi.vue().phase).toBe("pret");
  });
});

describe("historique", () => {
  test("une queue sans demande remonte jusqu'à la demande, pages vides comprises", async () => {
    const lectures: unknown[] = [];
    const { suivi } = monte({
      lit: async (_p, options) => {
        lectures.push(options);
        if ("tail" in options) return page({ entries: [entree("a3")], previousCursor: "p1" });
        if (options.before === "p1") return page({ entries: [], previousCursor: "p2" });
        return page({ entries: [demande("u1"), entree("a1")], previousCursor: "p3" });
      },
    });
    suivi.demarre();
    await attend();
    await attend();
    expect(lectures).toEqual([{ tail: 256 * 1024 }, { before: "p1" }, { before: "p2" }]);
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1", "a1", "a3"]);
    expect(suivi.vue().precedent).toBe("p3");
    expect(suivi.vue().ajoutsEnHaut).toBe(1);
  });

  test("rien ramené éteint le curseur (pas de boucle)", async () => {
    const { suivi } = monte({
      lit: async (_p, options) =>
        "tail" in options
          ? page({ entries: [demande("u1")], previousCursor: "p1" })
          : page({ entries: [], previousCursor: "p1" }),
    });
    suivi.demarre();
    await attend();
    await suivi.chargePlusAncien();
    expect(suivi.vue().precedent).toBeNull();
  });

  test("un échec d'historique est montré, le fil reste", async () => {
    const { suivi } = monte({
      lit: async (_p, options) => {
        if ("tail" in options) return page({ entries: [demande("u1")], previousCursor: "p1" });
        throw new Error("502 passager");
      },
    });
    suivi.demarre();
    await attend();
    await suivi.chargePlusAncien();
    expect(suivi.vue().erreurAncien).toBe("502 passager");
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1"]);
    expect(suivi.vue().chargementAncien).toBe(false);
  });
});

describe("erreurs de lecture", () => {
  test("la première lecture ratée dit sa cause", async () => {
    const { suivi } = monte({
      flux: false,
      lit: async () => {
        throw new Error("no usable session path for this agent");
      },
    });
    suivi.demarre();
    await attend();
    expect(suivi.vue().phase).toBe("erreur");
    expect(suivi.vue().erreur).toBe("no usable session path for this agent");
  });

  test("une lecture vide après un reset ne vide pas le fil", async () => {
    const { flux, suivi } = monte({ lit: async () => page({ entries: [demande("u1")] }) });
    suivi.demarre();
    await attend();
    flux[0]?.emet("reset", page({ cause: "absente", entries: [] }));
    expect(suivi.vue().entries.map((e) => e.id)).toEqual(["u1"]);
    expect(suivi.vue().avertissement).toContain("absente");
  });
});
