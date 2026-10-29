/**
 * C19/C20 — les envois en attente, **par pane** (T058).
 *
 * ⚠️ **Les trois défauts, chacun avec son test :**
 *
 * 1. **La cible était celle du rendu** : échec sur A, ouverture de B,
 *    « réessayer » envoyait à B. Le test le rejoue et exige que le lanceur
 *    reçoive **A**.
 * 2. **La minuterie mourait avec l'écran** : changer de conversation dans les
 *    900 ms annulait l'envoi sans le dire. Le test programme un envoi, « change
 *    d'écran » (aucun effet sur le magasin), avance l'horloge et exige **un**
 *    appel.
 * 3. **Une réponse tardive pouvait se poser sur la mauvaise conversation** :
 *    chaque envoi est rangé sous son pane. Le test fait répondre A après coup et
 *    vérifie que la liste de B est **vide**.
 *
 * Aucune attente réelle : la minuterie est un planificateur manuel.
 */
import { describe, expect, test } from "bun:test";
import {
  creeMagasinEnvois,
  DELAI_ENVOI_MS,
  type Lanceur,
  type Planificateur,
} from "../src/envois.ts";

/** Un planificateur qui exécute tout de suite — le départ part sans `avance()`. */
const planificateurImmediat = (): Planificateur => (action) => {
  action();
  return () => undefined;
};

/** Un planificateur manuel : rien ne part tant que `avance()` n'est pas appelé. */
const planificateurManuel = (): {
  avance: (delai: number) => void;
  planifie: Planificateur;
} => {
  const taches: { action: () => void; delai: number }[] = [];
  return {
    avance: (delai) => {
      for (const tache of taches.filter((candidate) => candidate.delai <= delai)) {
        taches.splice(taches.indexOf(tache), 1);
        tache.action();
      }
    },
    planifie: (action, delai) => {
      const tache = { action, delai };
      taches.push(tache);
      return () => {
        const index = taches.indexOf(tache);
        if (index >= 0) taches.splice(index, 1);
      };
    },
  };
};

/** Un lanceur qui note les cibles, et répond ce qu'on lui demande. */
const lanceurNote = (
  reponse: Awaited<ReturnType<Lanceur>> = {
    confirmation: "confirmed",
    kind: "sent",
  },
): { appels: Array<{ pane: string; text: string }>; lance: Lanceur } => {
  const appels: Array<{ pane: string; text: string }> = [];
  return {
    appels,
    lance: async (pane, text) => {
      appels.push({ pane, text });
      return reponse;
    },
  };
};

/** Un lanceur qui échoue toujours. */
const lanceurQuiLeve =
  (message: string): Lanceur =>
  () =>
    Promise.reject(new Error(message));

/** Laisse tourner la microtâche qui termine le lancement. */
const souffle = (): Promise<void> => new Promise((ok) => setTimeout(ok, 0));

describe("C19 — la cible est CAPTURÉE, pas relue depuis l'écran", () => {
  test("échec sur A, puis B : réessayer appelle A, une seule fois", async () => {
    const { appels, lance } = lanceurNote({
      kind: "failed",
      message: "Herdr injoignable",
      state: "erreur",
    });
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);

    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "bonjour" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    expect(appels).toEqual([{ pane: "w1:p1", text: "bonjour" }]);
    expect(magasin.liste("w1:p1")[0]?.state).toBe("failed");

    // L'utilisateur ouvre B. Le magasin n'a AUCUN état d'écran : la cible de
    // l'envoi reste w1:p1.
    expect(magasin.liste("w1:p2")).toHaveLength(0);
    expect(magasin.reessaye(id)).toBe(true);
    await souffle();
    expect(appels).toEqual([
      { pane: "w1:p1", text: "bonjour" },
      { pane: "w1:p1", text: "bonjour" },
    ]);
  });

  test("un envoi DÉLIVRÉ ne se réessaie pas (pas de double envoi)", async () => {
    const { appels, lance } = lanceurNote();
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "bonjour" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    expect(magasin.liste("w1:p1")[0]?.state).toBe("delivered");
    expect(magasin.reessaye(id)).toBe(false);
    expect(appels).toHaveLength(1);
  });
});

describe("C20 — la minuterie survit à la navigation", () => {
  test("changer de conversation dans les 900 ms n'annule pas l'envoi", async () => {
    const { appels, lance } = lanceurNote();
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "message de A" });
    // « Ouvrir B » : le magasin ne voit aucun démontage, et c'est le point —
    // l'ancien `setTimeout` du composant était annulé au démontage.
    magasin.ajoute({ baseline: 0, pane: "w1:p2", text: "message de B" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    // Les DEUX partent, chacun sur sa cible.
    expect(appels).toEqual([
      { pane: "w1:p1", text: "message de A" },
      { pane: "w1:p2", text: "message de B" },
    ]);
  });

  test("une annulation avant le départ n'appelle jamais le serveur", async () => {
    const { appels, lance } = lanceurNote();
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    const id = magasin.ajoute({
      baseline: 0,
      pane: "w1:p1",
      text: "à annuler",
    });
    expect(magasin.annule(id)).toBe("à annuler");
    avance(DELAI_ENVOI_MS);
    await souffle();
    expect(appels).toHaveLength(0);
    expect(magasin.liste("w1:p1")).toHaveLength(0);
  });
});

describe("C20 — une réponse tardive ne traverse pas les conversations", () => {
  test("A répond après coup : la liste de B reste vide", async () => {
    const { avance, planifie } = planificateurManuel();
    // Une seule entrée : la fabrique est créée une fois, et le test la remplit.
    const resolution: Array<(valeur: Awaited<ReturnType<Lanceur>>) => void> = [];
    const lance: Lanceur = () => new Promise((ok) => resolution.push(ok));
    const magasin = creeMagasinEnvois(lance, planifie);
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "pour A" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    expect(magasin.liste("w1:p1")[0]?.state).toBe("sending");

    // L'utilisateur est passé sur B ; la réponse de A arrive maintenant.
    for (const resoudre of resolution) resoudre({ confirmation: "unknown", kind: "sent" });
    await souffle();
    // A porte son état ; B n'a jamais rien reçu.
    expect(magasin.liste("w1:p1")[0]?.state).toBe("uncertain");
    expect(magasin.liste("w1:p2")).toEqual([]);
    // Et le compte d'appels reste celui d'A.
    expect(magasin.lancements()).toBe(1);
    void id;
  });
});

describe("T058 — les états du fil, sans mensonge", () => {
  test("confirmation absente ⇒ `uncertain`, jamais `delivered`", async () => {
    const { lance } = lanceurNote({ confirmation: "unknown", kind: "sent" });
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "x" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    const envoi = magasin.liste("w1:p1")[0];
    expect(envoi?.state).toBe("uncertain");
    expect(envoi?.detail).toContain("pas confirmé");
  });

  test("un double supprimé est un succès assumé, pas une erreur", async () => {
    const { lance } = lanceurNote({
      kind: "suppressed",
      reason: "consecutive identical send",
    });
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "x" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    const envoi = magasin.liste("w1:p1")[0];
    expect(envoi?.state).toBe("delivered");
    expect(envoi?.detail).toContain("déjà confirmé");
  });

  test("le lanceur qui LÈVE donne un état `inconnu`, jamais un échec", async () => {
    /*
      ⚠️ **Une exception réseau ne prouve pas que le message n'est pas parti.**
      Elle s'affichait en ROUGE (`failed`), c'est-à-dire comme un échec certain —
      la bulle rouge observée sur un message réellement arrivé sur le Mac.
      `inconnu` est un état du contrat (B05), il s'affiche en orange, avec le
      renvoi possible et son avertissement de doublon.
    */
    const lance = lanceurQuiLeve("réseau coupé");
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "x" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    const envoi = magasin.liste("w1:p1")[0];
    expect(envoi?.state).toBe("uncertain");
    expect(envoi?.failureState).toBe("inconnu");
    expect(envoi?.detail).toContain("réseau coupé");
  });

  test("un envoi délivré s'oublie quand la session le porte", async () => {
    const { lance } = lanceurNote();
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "x" });
    avance(DELAI_ENVOI_MS);
    await souffle();
    expect(magasin.liste("w1:p1")).toHaveLength(1);
    magasin.oublie(id);
    expect(magasin.liste("w1:p1")).toEqual([]);
  });

  test("les abonnés sont notifiés, et le désabonnement coupe", async () => {
    const { lance } = lanceurNote();
    const { avance, planifie } = planificateurManuel();
    const magasin = creeMagasinEnvois(lance, planifie);
    let notifications = 0;
    const desabonner = magasin.souscrire(() => {
      notifications += 1;
    });
    magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "x" });
    expect(notifications).toBeGreaterThan(0);
    const avant = notifications;
    desabonner();
    avance(DELAI_ENVOI_MS);
    await souffle();
    expect(notifications).toBe(avant);
  });
});

describe("le SSE résout un envoi incertain — sans délai", () => {
  test("un envoi `uncertain` devient délivré quand l'événement arrive", async () => {
    // ⚠️ Un délai n'est pas une preuve : l'événement `prompt` en est une. Le
    // message est confirmé par ce que le serveur PUBLIE, pas par une absence de
    // réponse interprétée.
    const magasin = creeMagasinEnvois(
      async () => ({ confirmation: "unknown", fingerprint: "f", kind: "sent" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "salut" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    const envoi = () => magasin.liste("w1:p1").find((candidat) => candidat.id === id);
    expect(envoi()?.state).toBe("uncertain");
    expect(magasin.resoutParEvenement("w1:p1")).toBe(1);
    expect(envoi()?.state).toBe("delivered");
  });

  test("un envoi réellement `failed` n'est PAS ressuscité par un événement", async () => {
    // Un refus nommé reste un refus ; un autre prompt qui passe ne le blanchit pas.
    const magasin = creeMagasinEnvois(
      async () => ({ kind: "failed", message: "refusé", state: "erreur" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "salut" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(magasin.resoutParEvenement("w1:p1")).toBe(0);
    expect(magasin.liste("w1:p1").find((candidat) => candidat.id === id)?.state).toBe("failed");
  });

  test("un événement d'un AUTRE pane ne touche pas cet envoi", async () => {
    const magasin = creeMagasinEnvois(
      async () => ({ confirmation: "unknown", fingerprint: "f", kind: "sent" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "salut" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(magasin.resoutParEvenement("w2:p2")).toBe(0);
    expect(magasin.liste("w1:p1").find((candidat) => candidat.id === id)?.state).toBe("uncertain");
  });
});

describe("une panne non prouvée n'est pas un échec certain", () => {
  /**
   * ⚠️ **Le défaut tel qu'il a été vu à l'écran.** Message envoyé depuis la PWA :
   * bulle **rouge** immédiate (donc « échec »), alors que le texte était bien
   * parti sur la session du Mac. Les trois natures de panne du contrat (B05) ont
   * été confondues à l'affichage : `attente` et `inconnu` ne prouvent rien,
   * seul `erreur` est un échec.
   */
  test("`attente` (délai dépassé) s'affiche comme incertain", async () => {
    const magasin = creeMagasinEnvois(
      async () => ({ kind: "failed", message: "pas de réponse à temps", state: "attente" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "bonjour" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    const envoi = magasin.liste("w1:p1").find((candidat) => candidat.id === id);
    expect(envoi?.state).toBe("uncertain");
    expect(envoi?.failureState).toBe("attente");
  });

  test("`inconnu` (transport muet) s'affiche comme incertain", async () => {
    const magasin = creeMagasinEnvois(
      async () => ({ kind: "failed", message: "réponse illisible", state: "inconnu" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "bonjour" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(magasin.liste("w1:p1").find((candidat) => candidat.id === id)?.state).toBe("uncertain");
  });

  test("`erreur` (refus amont) reste un échec", async () => {
    const magasin = creeMagasinEnvois(
      async () => ({ kind: "failed", message: "refusé", state: "erreur" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "bonjour" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(magasin.liste("w1:p1").find((candidat) => candidat.id === id)?.state).toBe("failed");
  });
});

describe("la preuve du fil prime sur l'état de l'envoi", () => {
  /**
   * ⚠️ **Deux affichages du même message.** `oublie` refusait tout état autre que
   * `delivered` : un envoi resté `uncertain` (réponse muette du serveur) gardait
   * sa bulle optimiste alors que son texte était **déjà dans le fil** — le
   * message apparaissait deux fois, la bulle continuant d'annoncer « non
   * confirmé » devant la preuve.
   */
  test("un envoi incertain s'oublie quand la session porte son texte", async () => {
    const magasin = creeMagasinEnvois(
      async () => ({ kind: "failed", message: "pas de réponse", state: "inconnu" }),
      planificateurImmediat(),
    );
    const id = magasin.ajoute({ baseline: 0, pane: "w1:p1", text: "bonjour" });
    await new Promise((resoudre) => setTimeout(resoudre, 0));
    expect(magasin.liste("w1:p1").find((candidat) => candidat.id === id)?.state).toBe("uncertain");
    magasin.oublie(id);
    expect(magasin.liste("w1:p1")).toHaveLength(0);
  });
});
