/**
 * T072 — la matrice **états × surfaces**.
 *
 * ⚠️ **Ce que ce fichier apporte, et ce qu'il n'apporte pas.** Les règles
 * unitaires (ancrage, décision d'affichage, cadence, envois) sont testées
 * ailleurs, en pur. Ici on vérifie la **jonction** : chaque état réel du
 * système a-t-il un chemin de rendu dans la surface qui le montre, et ce chemin
 * dit-il la vérité ? Ce sont des assertions sur la source, comme les autres
 * tests de structure du projet — elles ne remplacent pas une capture d'écran,
 * elles empêchent la régression silencieuse (« cet état n'est plus rendu du
 * tout », « le fil disparaît »).
 *
 * Ce fichier ne prétend **pas** avoir vu l'interface dans un navigateur.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const lire = (chemin: string): string =>
  readFileSync(join(import.meta.dir, "..", "src", chemin), "utf8");

const chat = lire("ChatScreen.tsx");
const etats = lire("etats.ts");
const bandeauLecture = lire("EtatLecture.tsx");
const bandeauMAJ = lire("BandeauMiseAJour.tsx");
const visionneuse = lire("Viewer.tsx");
const detailProjet = lire("ProjectDetail.tsx");

/**
 * Les phases déclarées par l'union, lues à la source.
 *
 * ⚠️ On déduplique : le même motif apparaît aussi aux **sites de
 * construction** (`return { phase: "erreur" }`), et les compter comme des
 * déclarations faisait échouer la comparaison sur un doublon — pas sur un
 * état manquant.
 */
const phases = (): string[] => [
  ...new Set([...etats.matchAll(/phase: "([a-z-]+)"/g)].map((trouve) => trouve[1] ?? "")),
];

describe("les six états de lecture ont chacun leur rendu", () => {
  test("l'union déclare bien six phases", () => {
    expect(phases().toSorted()).toEqual([
      "chargement",
      "erreur",
      "hors-ligne",
      "pret",
      "reconnexion",
      "vide",
    ]);
  });

  test("chaque phase a un `case` dans le bandeau", () => {
    // ⚠️ Le défaut que ça attrape : ajouter une phase à l'union sans la rendre.
    // `switch` sans `default` typé ne le dit pas, et l'écran afficherait le
    // repli inconnu pour un état parfaitement normal.
    for (const phase of phases()) {
      expect(bandeauLecture).toContain(`case "${phase}"`);
    }
  });

  test("un état inconnu est une ERREUR visible, jamais un écran muet", () => {
    expect(bandeauLecture).toContain("Unknown reading state");
  });

  test("« hors-ligne » porte l'heure de la dernière lecture réussie", () => {
    // « Hors ligne » sans horodatage dit la moitié du problème : on ne sait pas
    // si ce qu'on lit date de dix secondes ou de la veille.
    expect(bandeauLecture).toContain("heureLue");
  });
});

describe("la mise à jour ne se propose jamais sans dire pourquoi elle attend", () => {
  test("le bouton est désactivé dès qu'un blocage existe", () => {
    expect(bandeauMAJ).toContain('disabled={blocage !== "aucune"}');
  });

  test("la raison vient de la règle, pas d'un texte générique", () => {
    expect(bandeauMAJ).toContain("texteDeMiseAJour");
    expect(bandeauMAJ).toContain("blocageDeMiseAJour");
  });
});

describe("le fil reste rendu quel que soit l'état", () => {
  test("le conteneur du fil n'est sous aucune condition", () => {
    // ⚠️ Le défaut corrigé (session illisible) venait précisément d'un écran qui
    // cessait d'afficher le fil. Le conteneur doit être rendu **toujours** ; ce
    // sont les messages dedans qui varient.
    const position = chat.indexOf('className="messages"');
    expect(position).toBeGreaterThan(-1);
    const avant = chat.slice(Math.max(0, position - 200), position);
    expect(avant).not.toContain("phase ===");
    expect(avant).not.toContain("? (");
  });

  test("un agent bloqué peut afficher sa carte de confiance", () => {
    // `blocked` sans chemin d'approbation obligerait à passer par Herdr à la
    // main pour la manœuvre la plus courante.
    expect(chat).toContain("<TrustCard");
  });

  test("un agent dont Herdr ne publie pas de session le DIT sans alarmer", () => {
    // Agent neuf : la session apparaît au premier message. Un avis alarmant
    // ferait passer un agent qui démarre pour un agent cassé.
    expect(chat).toContain("Herdr does not expose a session for this agent");
    // Et la mention d'une lecture incomplète reste **neutre**, pas une erreur.
    expect(chat).toContain('<Notice ton="neutre">{lecturePartielle}</Notice>');
  });
});

describe("les surfaces secondaires disent leurs pannes", () => {
  test("la visionneuse nomme la cause et le statut HTTP", () => {
    // Un fichier illisible ne doit pas donner une zone blanche : on lit le
    // message du serveur, sinon le statut.
    expect(visionneuse).toContain("Unable to load file");
    expect(visionneuse).toContain("response.status");
  });

  test("un projet disparu est annoncé, pas silencieusement vide", () => {
    expect(detailProjet).toContain("This workspace no longer exists.");
  });
});

describe("les états d'agent traversent la liste et le chat", () => {
  test("les cinq statuts ont un libellé unique et lisible", () => {
    // ⚠️ « blocked » a déjà été affiché « working », et « idle » « finished » :
    // le mot venait d'ailleurs que de l'état. Une seule source (T061).
    const mots = lire("mot-etat.ts");
    for (const statut of ["idle", "working", "blocked", "done", "unknown"]) {
      expect(mots).toContain(statut);
    }
    expect(mots).toContain("waiting for input");
  });
});
