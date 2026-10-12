/**
 * Le flux d'événements, avec un `EventSource` de substitution (U10).
 *
 * Le contrat dit « `resync` recharge une fois ». Le risque réel n'est pas
 * l'événement lui-même : c'est qu'un flux resté abonné continue d'appeler le
 * gestionnaire après un remontage de l'effet, et qu'un `resync` se mette
 * alors à déclencher deux rechargements — puis quatre.
 *
 * Ces tests gardent donc la référence sur la source réellement construite et
 * comptent les appels. Un faux `EventSource` qui ne compte rien ne prouverait
 * rien.
 */
import { describe, expect, test } from "bun:test";
import { openEventStream } from "./api.ts";

type Ecouteur = (evenement: unknown) => void;

class FauxEventSource {
  static dernier: FauxEventSource | null = null;
  static total = 0;

  readonly ecouteurs = new Map<string, Ecouteur[]>();
  readonly url: string;
  ferme = false;

  constructor(url: string) {
    this.url = url;
    FauxEventSource.dernier = this;
    FauxEventSource.total += 1;
  }

  addEventListener(kind: string, fn: Ecouteur): void {
    const liste = this.ecouteurs.get(kind) ?? [];
    liste.push(fn);
    this.ecouteurs.set(kind, liste);
  }

  removeEventListener(kind: string, fn: Ecouteur): void {
    const liste = this.ecouteurs.get(kind) ?? [];
    this.ecouteurs.set(
      kind,
      liste.filter((candidat) => candidat !== fn),
    );
  }

  close(): void {
    this.ferme = true;
    this.ecouteurs.clear();
  }

  emettre(kind: string, data: unknown = {}): void {
    for (const fn of this.ecouteurs.get(kind) ?? []) fn({ data: JSON.stringify(data) });
  }

  compte(kind: string): number {
    return (this.ecouteurs.get(kind) ?? []).length;
  }
}

/**
 * Raccroche le faux `EventSource` le temps d'un test.
 *
 * `defineProperty` plutôt qu'une affectation transtypée : le transtypage
 * aurait élargi la surface de `globalThis` sans le dire, et le lint le refuse —
 * à raison, puisque c'est exactement le genre deHack qui survit au projet.
 */
const avecFauxSource = (corps: () => void): void => {
  FauxEventSource.dernier = null;
  const avant = globalThis.EventSource;
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FauxEventSource,
    writable: true,
  });
  try {
    corps();
  } finally {
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: avant,
      writable: true,
    });
  }
};

const faux = (): FauxEventSource => {
  if (FauxEventSource.dernier === null) throw new Error("aucun flux ouvert");
  return FauxEventSource.dernier;
};

/**
 * Compteurs partagés avec les gestionnaires.
 *
 * ⚠️ Ils sont retournés **par référence**, jamais par copie : `{ ...c }`
 * recopierait le nombre au moment de la création, et le test lirait toujours
 * zéro — il passerait sans jamais avoir rien vérifié.
 */
const compteurs = () => {
  const c = { events: [] as string[], resync: 0, status: [] as string[] };
  return {
    c,
    handlers: {
      onEvent: (kind: string) => {
        c.events.push(kind);
      },
      onResync: () => {
        c.resync += 1;
      },
      onStatus: (status: "live" | "down") => {
        c.status.push(status);
      },
    },
  };
};

describe("U10 — un resync, un rechargement", () => {
  test("un resync notifié une fois, et une seule", () => {
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      faux().emettre("resync", { reason: "journal tronqué" });
      expect(c.resync).toBe(1);
      fermer();
    });
  });

  test("trois resync notifiés trois fois — un chacun, jamais plus", () => {
    // Le serveur émet un resync par coupure de continuité. Si l'application en
    // déduisait deux, elle multiplierait les rechargements sans raison.
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      for (let i = 0; i < 3; i += 1) faux().emettre("resync");
      expect(c.resync).toBe(3);
      fermer();
    });
  });

  test("après fermeture, la source ne notifie plus rien", () => {
    // Le vrai risque de multiplication : un flux démonté qui continue d'appeler.
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      const source = faux();
      fermer();
      source.emettre("resync");
      expect(c.resync).toBe(0);
      expect(source.ferme).toBe(true);
    });
  });

  test("chaque abonnement est retiré à la fermeture", () => {
    avecFauxSource(() => {
      const { handlers } = compteurs();
      const fermer = openEventStream(handlers);
      const source = faux();
      expect(source.compte("resync")).toBe(1);
      fermer();
      expect(source.compte("resync")).toBe(0);
    });
  });
});

describe("U10 — le flux ne parle que des événements nommés", () => {
  test("un événement nommé est transmis avec ses données décodées", () => {
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      faux().emettre("agent_status", { paneId: "w1:p1", status: "working" });
      expect(c.events).toEqual(["agent_status"]);
      fermer();
    });
  });

  test("resync et ready ne passent pas par onEvent : ils ont leur chemin", () => {
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      faux().emettre("resync");
      faux().emettre("ready");
      // Sinon un resync se lirait deux fois dans l'application : comme activité,
      // et comme rechargement.
      expect(c.events).toEqual([]);
      expect(c.resync).toBe(1);
      fermer();
    });
  });

  test("le flux vise le même point que les autres requêtes", () => {
    avecFauxSource(() => {
      const { handlers } = compteurs();
      const fermer = openEventStream(handlers);
      expect(faux().url).toBe("/api/events");
      fermer();
    });
  });
});

describe("U10 — le statut ne clignote pas", () => {
  test("l'ouverture marque le flux vivant", () => {
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      faux().emettre("open");
      expect(c.status).toEqual(["live"]);
      fermer();
    });
  });

  test("une erreur ne bascule pas tout de suite hors ligne", () => {
    // `EventSource` déclenche `error` à **chaque** tentative, y compris quand
    // tout va bien. Basculer immédiatement faisait clignoter l'indicateur en
    // permanence ; l'annonce est différée de quelques secondes.
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      faux().emettre("error");
      expect(c.status).toEqual([]);
      fermer();
    });
  });

  test("un événement reçu après une erreur rappelle que le flux vit", () => {
    avecFauxSource(() => {
      const { c, handlers } = compteurs();
      const fermer = openEventStream(handlers);
      faux().emettre("error");
      faux().emettre("agent_status", { paneId: "w1:p1" });
      expect(c.status).toEqual(["live"]);
      fermer();
    });
  });
});
