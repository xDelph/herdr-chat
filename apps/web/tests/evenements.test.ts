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
import { openEventStream } from "../src/api.ts";

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

describe("le flux global tombé est recréé (mesuré : rien en 60 s après une coupure de 4 s)", () => {
  class Source {
    readyState = 0;
    ferme = false;
    readonly ecouteurs = new Map<string, Array<(evenement: MessageEvent<string>) => void>>();
    addEventListener(type: string, ecouteur: (evenement: MessageEvent<string>) => void): void {
      this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), ecouteur]);
    }
    close(): void {
      this.ferme = true;
      this.readyState = 2;
    }
    emet(type: string): void {
      if (type === "open") this.readyState = 1;
      for (const ecouteur of this.ecouteurs.get(type) ?? []) {
        ecouteur(new MessageEvent(type, { data: "{}" }));
      }
    }
  }

  const banc = () => {
    const sources: Source[] = [];
    const taches: Array<{ action: () => void; delai: number }> = [];
    let reveil: (() => void) | null = null;
    const { c, handlers } = compteurs();
    const fermer = openEventStream(handlers, {
      ecouteReveil: (fn) => {
        reveil = fn;
        return () => undefined;
      },
      ouvre: () => {
        const source = new Source();
        sources.push(source);
        return source;
      },
      planifie: (action, delai) => {
        const tache = { action, delai };
        taches.push(tache);
        return () => {
          const index = taches.indexOf(tache);
          if (index >= 0) taches.splice(index, 1);
        };
      },
      visible: () => true,
    });
    const avance = (delai: number) => {
      for (const tache of taches.filter((t) => t.delai <= delai)) {
        taches.splice(taches.indexOf(tache), 1);
        tache.action();
      }
    };
    return { avance, c, fermer, reveiller: () => reveil?.(), sources };
  };

  test("erreur : recréé à 1 s ; le nouveau, une fois vivant, fait relire la liste (resync)", () => {
    const { avance, c, fermer, sources } = banc();
    sources[0]?.emet("open");
    sources[0]?.emet("error");
    avance(1_000);
    expect(sources).toHaveLength(2);
    expect(sources[0]?.ferme).toBe(true);
    expect(c.resync).toBe(0);
    sources[1]?.emet("open");
    // L'ancien emportait son Last-Event-ID : la liste est relue une fois.
    expect(c.resync).toBe(1);
    fermer();
  });

  test("délais croissants 1 s → 2 s → 5 s → 10 s, plafonnés", () => {
    const { avance, fermer, sources } = banc();
    sources[0]?.emet("error");
    for (const [index, delai] of [1_000, 2_000, 5_000, 10_000, 10_000].entries()) {
      avance(delai - 1);
      expect(sources).toHaveLength(index + 1);
      avance(delai);
      expect(sources).toHaveLength(index + 2);
      sources.at(-1)?.emet("error");
    }
    fermer();
  });

  test("retour du réseau : un flux non ouvert est recréé tout de suite", () => {
    const { fermer, reveiller, sources } = banc();
    sources[0]?.emet("open");
    reveiller();
    expect(sources).toHaveLength(1);
    sources[0]?.close();
    reveiller();
    expect(sources).toHaveLength(2);
    fermer();
  });
});
