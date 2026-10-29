/**
 * La règle de l'accueil — testée seule, sans application (U04).
 *
 * Chaque cas vient du tableau des « Règles déjà tranchées ». Si la règle
 * change, un de ces tests tombe : c'est le but.
 */
import { describe, expect, test } from "bun:test";
import type { AgentStatus, ConversationSummary } from "@herdr-remote/shared";
import {
  countOf,
  grouperAttentionPuisProjet,
  groupesDe,
  SECTIONS,
  SECTION_LABEL,
  sectionConversations,
  sectionOf,
} from "../src/sections.ts";

const ligne = (
  paneId: string,
  status: AgentStatus = "idle",
  timestamp?: number,
  /** Titre affiché. Par défaut le `paneId`, ce qui rend les listes lisibles. */
  titre?: string,
): ConversationSummary => ({
  ...(timestamp === undefined ? {} : { timestamp }),
  // Le type d'agent est **obligatoire** dans le contrat : la marque de la liste
  // en dépend. Ces fixtures n'en ont pas besoin, mais elles doivent le dire.
  agent: "pi",
  // ⚠️ Les trois faits de nommage : l'agent est **seul** dans son tab, donc
  // aucune étiquette de pane n'est produite. Ces tests portent sur le
  // regroupement, pas sur l'étiquetage.
  name: null,
  paneRank: null,
  paneId,
  sessionState: "available",
  tabId: "w1:t1",
  tabPaneCount: 1,
  status,
  title: titre ?? paneId,
  workspaceId: "w1",
});

const dans = (
  entrees: ReadonlyArray<ReturnType<typeof sectionConversations>[number]>,
  nom: string,
) => entrees.find((entree) => entree.cle === nom)?.conversations.map((c) => c.paneId) ?? [];

describe("U04 — un pane apparaît une fois", () => {
  test("chaque statut tombe dans sa section", () => {
    expect(sectionOf("blocked")).toBe("a-traiter");
    expect(sectionOf("working")).toBe("en-cours");
    expect(sectionOf("idle")).toBe("recents");
    // `done` se lit (point « non lu » des récents), il ne se tranche pas.
    expect(sectionOf("done")).toBe("recents");
    expect(sectionOf("unknown")).toBe("recents");
  });

  test("un agent bloqué n'apparaît qu'une fois, même s'il travaille aussi", () => {
    // La priorité de `blocked` est la règle : un agent qui travaille *et* est
    // bloqué doit rester actionnable. Le mettre aussi dans « En cours » le
    // ferait apparaître deux fois.
    const entrees = sectionConversations([ligne("w1:p1", "blocked", 100)]);
    expect(dans(entrees, "a-traiter")).toEqual(["w1:p1"]);
    expect(dans(entrees, "en-cours")).toEqual([]);
    expect(dans(entrees, "recents")).toEqual([]);
  });

  test("chaque pane est dans exactement une section", () => {
    const entrees = sectionConversations([
      ligne("w1:p1", "blocked", 1),
      ligne("w1:p2", "working", 2),
      ligne("w1:p3", "idle", 3),
      ligne("w1:p4", "done", 4),
      ligne("w1:p5", "unknown", 5),
    ]);
    const total = entrees.reduce((somme, entree) => somme + entree.conversations.length, 0);
    expect(total).toBe(5);
    // `blocked` attend une décision ; `working` progresse ; `idle`, `done` et
    // `unknown` se lisent dans les récents.
    expect(countOf(entrees, "a-traiter")).toBe(1);
    expect(countOf(entrees, "en-cours")).toBe(1);
    expect(countOf(entrees, "recents")).toBe(3);
  });
});

describe("U04 — tri dans chaque section", () => {
  test("dernier message décroissant", () => {
    const entrees = sectionConversations([
      ligne("w1:p1", "idle", 100),
      ligne("w1:p2", "idle", 300),
      ligne("w1:p3", "idle", 200),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:p2", "w1:p3", "w1:p1"]);
  });

  /**
   * Le contrepied : une ligne **sans horodatage** n'est pas « la plus
   * ancienne », elle est hors classement. La traiter comme une date à zéro la
   * remonterait en tête de liste — l'inverse de l'intention.
   */
  test("absence d'horodatage : la ligne passe en DERNIER", () => {
    const entrees = sectionConversations([
      ligne("w1:sans-date", "idle"),
      ligne("w1:recent", "idle", 300),
      ligne("w1:moyen", "idle", 200),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:recent", "w1:moyen", "w1:sans-date"]);
  });

  test("deux lignes sans horodatage : paneId croissant", () => {
    const entrees = sectionConversations([
      ligne("w1:p9", "idle"),
      ligne("w1:p2", "idle"),
      ligne("w1:p5", "idle"),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:p2", "w1:p5", "w1:p9"]);
  });

  test("à horodatage égal, paneId croissant — donc tri déterministe", () => {
    const entrees = sectionConversations([
      ligne("w1:p9", "idle", 500),
      ligne("w1:p2", "idle", 500),
      ligne("w1:p5", "idle", 500),
    ]);
    expect(dans(entrees, "recents")).toEqual(["w1:p2", "w1:p5", "w1:p9"]);
  });

  test("le tri ne modifie pas le tableau d'entrée", () => {
    const source = [ligne("w1:p1", "idle", 100), ligne("w1:p2", "idle", 300)];
    const copie = source.map((c) => c.paneId);
    sectionConversations(source);
    expect(source.map((c) => c.paneId)).toEqual(copie);
  });
});

describe("U04 — l'ordre par nom", () => {
  test("le défaut reste le plus récent — on ne change pas la règle en silence", () => {
    const source = [ligne("w1:p1", "idle", 100), ligne("w1:p2", "idle", 300)];
    expect(dans(sectionConversations(source), "recents")).toEqual(["w1:p2", "w1:p1"]);
    expect(dans(sectionConversations(source, "recent"), "recents")).toEqual(["w1:p2", "w1:p1"]);
  });

  test("par nom : ordre alphabétique, quelle que soit la date", () => {
    const source = [
      ligne("w1:p1", "idle", 300, "zeta"),
      ligne("w1:p2", "idle", 100, "alpha"),
      ligne("w1:p3", "idle", 200, "midi"),
    ];
    expect(dans(sectionConversations(source, "nom"), "recents")).toEqual([
      "w1:p2",
      "w1:p3",
      "w1:p1",
    ]);
  });

  test("l'ordre par nom ignore la casse et les accents", () => {
    // « Émile » doit se ranger à « e », pas après « z » : sinon la liste paraît
    // rangée alors qu'elle ne l'est pas.
    const source = [ligne("w1:p1", "idle", 1, "Émile"), ligne("w1:p2", "idle", 1, "zoe")];
    expect(dans(sectionConversations(source, "nom"), "recents")).toEqual(["w1:p1", "w1:p2"]);
  });

  test("à nom égal, paneId croissant — l'ordre reste déterministe", () => {
    const source = [ligne("w1:p9", "idle", 1), ligne("w1:p2", "idle", 2)];
    expect(dans(sectionConversations(source, "nom"), "recents")).toEqual(["w1:p2", "w1:p9"]);
  });

  test("changer l'ordre ne change AUCUNE répartition", () => {
    // L'ordre est un affichage, pas un classement : les sections et leurs
    // effectifs doivent être identiques dans les deux ordres.
    const source = [
      ligne("w1:p1", "blocked", 100, "c"),
      ligne("w1:p2", "working", 200, "a"),
      ligne("w1:p3", "idle", 300, "b"),
    ];
    for (const ordre of ["recent", "nom"] as const) {
      const entrees = sectionConversations(source, ordre);
      expect(entrees.map((e) => e.cle)).toEqual([...SECTIONS]);
      expect(entrees.map((e) => e.conversations.length)).toEqual([1, 1, 1]);
    }
  });
});

describe("U04 — structure et libellés", () => {
  test("une section vide n'est PAS rendue", () => {
    /*
      ⚠️ **Renversement assumé d'une décision antérieure.** Ce test affirmait
      l'inverse — « les trois sections existent toujours, même vides » — et il
      donnait sa raison : l'écran garde sa hauteur, donc il ne saute pas quand une
      conversation change de section.

      Le coût s'est révélé plus grand que le bénéfice. Un titre de section
      **promet du contenu** : « Attend une décision » suivi de rien fait chercher ce
      qui manque, et use le mot pour le jour où il compte vraiment. Le saut de
      mise en page, lui, ne concerne que le haut d'une liste courte.
    */
    expect(sectionConversations([])).toEqual([]);
  });

  test("aucune section n'est inventée pour combler un vide", () => {
    // Le filtre retire, il n'ajoute jamais : les sections rendues sont toujours
    // un sous-ensemble de `SECTIONS`, dans l'ordre déclaré.
    const sections = sectionConversations([ligne("w1:p1", "working", 1_000)], "recent");

    expect(sections.map((e) => e.cle)).toEqual(["en-cours"]);
    // ⚠️ Vu comme des chaînes : `.includes` sur le tuple littéral exigerait une
    // assertion, qui masquerait justement la clé inattendue qu'on veut voir.
    const connues: ReadonlyArray<string> = SECTIONS;
    for (const entree of sections) expect(connues.includes(entree.cle)).toBe(true);
  });

  test("chaque section a un libellé exact", () => {
    expect(SECTION_LABEL["a-traiter"]).toBe("Attend une décision");
    expect(SECTION_LABEL["en-cours"]).toBe("En cours");
    expect(SECTION_LABEL["recents"]).toBe("Récents");
  });

  test("la réponse est stable à conversation identique", () => {
    const source = [
      ligne("w1:p3", "idle", 300),
      ligne("w1:p1", "blocked", 100),
      ligne("w1:p2", "idle"),
    ];
    expect(sectionConversations(source)).toEqual(sectionConversations(source));
  });
});

describe("une section vide ne s'affiche pas", () => {
  test("sans agent bloqué, « Attend une décision » disparaît", () => {
    // ⚠️ Un titre de section promet du contenu. « Attend une décision » suivi de
    // rien fait chercher ce qui manque, et use le mot pour le jour où il compte.
    const sections = sectionConversations([ligne("w1:p1", "idle", 1_000)], "recent");

    expect(sections.map((entree) => entree.cle)).toEqual(["recents"]);
  });

  test("sans agent au travail, « En cours » disparaît", () => {
    const sections = sectionConversations([ligne("w1:p1", "blocked", 1_000)], "recent");

    expect(sections.map((entree) => entree.cle)).toEqual(["a-traiter"]);
  });

  test("avec les deux, les deux sont là", () => {
    const sections = sectionConversations(
      [ligne("w1:p1", "blocked", 1_000), ligne("w1:p2", "working", 2_000)],
      "recent",
    );

    expect(sections.map((entree) => entree.cle)).toEqual(["a-traiter", "en-cours"]);
  });

  test("une liste vide ne rend AUCUNE section", () => {
    expect(sectionConversations([], "recent")).toEqual([]);
  });

  test("le tri et le contenu des sections gardées ne changent pas", () => {
    // Le filtre retire des sections, il ne réordonne rien.
    const sections = sectionConversations(
      [ligne("w1:p1", "idle", 1_000, "zeta"), ligne("w1:p2", "idle", 2_000, "alpha")],
      "nom",
    );

    expect(sections.length).toBe(1);
    expect(sections[0]?.conversations.map((c) => c.title)).toEqual(["alpha", "zeta"]);
  });

  test("`countOf` reste juste sur une section absente", () => {
    // Il cherchait déjà par `find`, donc l'absence d'une section ne casse rien.
    expect(
      countOf(sectionConversations([ligne("w1:p1", "idle", 1_000)], "recent"), "a-traiter"),
    ).toBe(0);
  });
});

/**
 * Le regroupement par projet.
 *
 * ⚠️ **Pourquoi cette option existe.** Le regroupement par état répond à
 * « qu'est-ce qui m'attend ? ». À dix agents répartis dans trois sections, on ne
 * sait plus à quel chantier chacun appartient — et c'est la question qu'on se
 * pose quand les projets se multiplient.
 *
 * ⚠️ **Ce qu'elle fait perdre, et qui est vérifié ici.** Un agent bloqué n'est
 * plus en tête : il est dans son projet, à sa place alphabétique ou
 * chronologique. C'est le prix du regroupement, et il est écrit dans les
 * réglages plutôt que découvert à l'usage.
 */
const ligneProjet = (
  paneId: string,
  workspaceId: string,
  status: AgentStatus = "idle",
  timestamp?: number,
): ConversationSummary => ({
  ...ligne(paneId, status, timestamp),
  workspaceId,
});

/** Résolveur de libellé : `w1` → « Alpha », le reste → « Workspace ». */
const nomDeProjet = (workspaceId: string): string =>
  workspaceId === "w1" ? "Alpha" : workspaceId === "w2" ? "Beta" : "Workspace";

describe("U18 — le regroupement par projet", () => {
  test("chaque projet forme un groupe, nommé par son libellé", () => {
    const groupes = grouperAttentionPuisProjet(
      [ligneProjet("w1:p1", "w1"), ligneProjet("w2:p1", "w2"), ligneProjet("w1:p2", "w1")],
      "recent",
      nomDeProjet,
    );

    expect(groupes.map((g) => g.titre).toSorted()).toEqual(["Alpha", "Beta"]);
    expect(dans(groupes, "w1")).toEqual(["w1:p1", "w1:p2"]);
    expect(dans(groupes, "w2")).toEqual(["w2:p1"]);
  });

  test("le projet le plus récemment touché passe en premier", () => {
    // ⚠️ C'est la même règle que pour les lignes — on veut voir ce qui vient de
    // bouger. Trier les groupes par nom et les lignes par date aurait donné deux
    // règles d'ordre dans le même écran.
    const groupes = grouperAttentionPuisProjet(
      [
        ligneProjet("w1:p1", "w1", "idle", 1_000),
        ligneProjet("w2:p1", "w2", "idle", 5_000),
        ligneProjet("w1:p2", "w1", "idle", 3_000),
      ],
      "recent",
      nomDeProjet,
    );

    expect(groupes.map((g) => g.cle)).toEqual(["w2", "w1"]);
  });

  test("un projet sans aucune date passe en dernier", () => {
    // Même contrepied que pour les lignes : sans horodatage n'est pas « le plus
    // ancien », c'est **hors classement** — donc en bas, jamais en tête.
    const groupes = grouperAttentionPuisProjet(
      [ligneProjet("w2:p1", "w2"), ligneProjet("w1:p1", "w1", "idle", 1_000)],
      "recent",
      nomDeProjet,
    );

    expect(groupes.map((g) => g.cle)).toEqual(["w1", "w2"]);
  });

  test("en tri par nom, ce sont les PROJETS qui s'ordonnent", () => {
    const groupes = grouperAttentionPuisProjet(
      [ligneProjet("w2:p1", "w2", "idle", 9_000), ligneProjet("w1:p1", "w1", "idle", 1_000)],
      "nom",
      nomDeProjet,
    );

    expect(groupes.map((g) => g.titre)).toEqual(["Alpha", "Beta"]);
  });

  test("à l'intérieur d'un groupe, l'ordre choisi s'applique encore", () => {
    const groupes = grouperAttentionPuisProjet(
      [
        ligneProjet("w1:p1", "w1", "idle", 1_000),
        ligneProjet("w1:p2", "w1", "idle", 9_000),
        ligneProjet("w1:p3", "w1", "idle", 5_000),
      ],
      "recent",
      nomDeProjet,
    );

    expect(dans(groupes, "w1")).toEqual(["w1:p2", "w1:p3", "w1:p1"]);
  });

  test("un projet que l'aperçu ne connaît pas garde son groupe", () => {
    // ⚠️ Le libellé peut manquer : l'aperçu arrive après la liste. Le groupe
    // existe quand même — le faire disparaître cacherait une conversation.
    const groupes = grouperAttentionPuisProjet([ligneProjet("w9:p1", "w9")], "recent", nomDeProjet);

    expect(groupes.map((g) => g.titre)).toEqual(["Workspace"]);
    expect(dans(groupes, "w9")).toEqual(["w9:p1"]);
  });

  test("une liste vide ne rend aucun groupe", () => {
    expect(grouperAttentionPuisProjet([], "recent", nomDeProjet)).toEqual([]);
  });

  test("le compte se lit aussi par clé de projet", () => {
    const groupes = grouperAttentionPuisProjet(
      [ligneProjet("w1:p1", "w1"), ligneProjet("w1:p2", "w1"), ligneProjet("w2:p1", "w2")],
      "recent",
      nomDeProjet,
    );

    expect(countOf(groupes, "w1")).toBe(2);
    expect(countOf(groupes, "w2")).toBe(1);
    expect(countOf(groupes, "w3")).toBe(0);
  });
});

describe("U18 — le dispatcher ne dérive pas", () => {
  const source = [
    ligneProjet("w1:p1", "w1", "blocked", 1_000),
    ligneProjet("w2:p1", "w2", "working", 2_000),
  ];

  test("« statut » rend exactement ce que rend la répartition par état", () => {
    // ⚠️ Un seul point d'entrée : si le dispatcher réimplémentait la règle, elle
    // pourrait s'écarter de celle qui est testée juste au-dessus.
    expect(groupesDe(source, "recent", "statut", nomDeProjet)).toEqual(
      sectionConversations(source, "recent"),
    );
  });

  test("« projet » met l'attention en tête, et ne range que le reste", () => {
    /*
      ⚠️ Un agent bloqué et un agent au travail restent en tête, **non découpés
      par projet** : c'est ce qu'on vient chercher. Seuls les agents au repos
      forment des groupes de projet — c'est là qu'est la masse à ranger.
    */
    expect(groupesDe(source, "recent", "projet", nomDeProjet).map((g) => g.cle)).toEqual([
      "a-traiter",
      "en-cours",
    ]);
  });

  test("« projet » range bien les agents au repos par projet", () => {
    expect(
      groupesDe(
        [ligneProjet("w1:p1", "w1", "idle", 1_000), ligneProjet("w2:p1", "w2", "idle", 2_000)],
        "recent",
        "projet",
        nomDeProjet,
      ).map((g) => g.cle),
    ).toEqual(["w2", "w1"]);
  });

  test("le regroupement par état garde les titres que l'interface attend", () => {
    // La clé redevient un titre : c'est ce que `sections.ts` résout, et l'écran
    // n'a plus de table à consulter.
    expect(
      groupesDe([ligne("w1:p1", "blocked", 1_000)], "recent", "statut", nomDeProjet)[0]?.titre,
    ).toBe("Attend une décision");
  });
});

/**
 * L'attention n'est PAS rangée par projet.
 *
 * ⚠️ **Cette règle a été corrigée par l'usage, et elle mérite ses tests.** Une
 * première version rangeait tout par projet : un agent bloqué se retrouvait
 * dispersé dans le sien, et il fallait ouvrir chaque groupe pour trouver ce qui
 * demandait une réponse. Le regroupement sert à ranger la **masse** — les agents
 * finis et au repos — pas à cacher ce qui attend une action.
 */
describe("U18 — l'attention passe avant le rangement", () => {
  /*
    Fixture **mixte à dessein** : `w1` a un agent en attention ET un au repos.
    Sans les deux, on ne pourrait pas vérifier qu'un projet apparaît *sans* son
    agent bloqué — qui est le point de la règle.
  */
  const source = [
    ligneProjet("w1:p1", "w1", "blocked", 1_000),
    ligneProjet("w1:p3", "w1", "idle", 2_000),
    ligneProjet("w1:p2", "w1", "working", 4_000),
    ligneProjet("w2:p1", "w2", "idle", 5_000),
    ligneProjet("w2:p2", "w2", "done", 3_000),
  ];
  const groupes = grouperAttentionPuisProjet(source, "recent", nomDeProjet);

  test("les deux premières sections sont l'attention, dans cet ordre", () => {
    // `blocked` avant `working` : un agent bloqué demande une action, un agent
    // qui travaille n'en demande pas.
    expect(groupes.map((g) => g.cle)).toEqual(["a-traiter", "en-cours", "w2", "w1"]);
    expect(groupes[0]?.titre).toBe("Attend une décision");
    expect(groupes[1]?.titre).toBe("En cours");
  });

  test("le groupe d'un projet ne contient QUE ses agents au repos", () => {
    // ⚠️ C'est tout l'objet de la correction : `w1:p1` et `w1:p2` sont en haut,
    // pas ici. Les y remettre les rendrait trouvables à deux endroits.
    // `w2:p2` est `done` : une réponse à lire, rangée avec son projet (marquée
    // non lue par l'écran). `w1:p1` (blocked) et `w1:p2` (working) sont en haut.
    expect(dans(groupes, "w1")).toEqual(["w1:p3"]);
    expect(dans(groupes, "w2")).toEqual(["w2:p1", "w2:p2"]);
  });

  test("l'attention n'est pas découpée par projet", () => {
    // Seul `blocked` attend une décision ; `done` se lit dans son projet.
    expect(dans(groupes, "a-traiter")).toEqual(["w1:p1"]);
    expect(dans(groupes, "en-cours")).toEqual(["w1:p2"]);
  });

  test("chaque ligne n'apparaît qu'UNE fois, tous groupes confondus", () => {
    const vues = groupes.flatMap((g) => g.conversations.map((c) => c.paneId));
    expect(vues.toSorted()).toEqual(["w1:p1", "w1:p2", "w1:p3", "w2:p1", "w2:p2"]);
  });

  test("en tri par nom, ce sont les projets qui s'ordonnent", () => {
    // Les deux sections d'attention gardent leur place : elles ne sont pas des
    // projets, et les trier avec eux n'aurait pas de sens.
    expect(grouperAttentionPuisProjet(source, "nom", nomDeProjet).map((g) => g.cle)).toEqual([
      "a-traiter",
      "en-cours",
      "w1",
      "w2",
    ]);
  });

  test("un projet dont TOUS les agents sont en attention n'a pas de groupe", () => {
    // Sinon il apparaîtrait vide, ce qui ferait chercher ce qui manque.
    const toutEnAttention = grouperAttentionPuisProjet(
      [ligneProjet("w1:p1", "w1", "blocked"), ligneProjet("w1:p2", "w1", "working")],
      "recent",
      nomDeProjet,
    );
    expect(toutEnAttention.map((g) => g.cle)).toEqual(["a-traiter", "en-cours"]);
  });

  test("sans agent en attention, il ne reste que les projets", () => {
    const auRepos = grouperAttentionPuisProjet(
      [ligneProjet("w1:p1", "w1"), ligneProjet("w2:p1", "w2")],
      "recent",
      nomDeProjet,
    );
    expect(auRepos.map((g) => g.cle)).toEqual(["w1", "w2"]);
  });

  test("une liste vide ne rend aucun groupe", () => {
    expect(grouperAttentionPuisProjet([], "recent", nomDeProjet)).toEqual([]);
  });
});
