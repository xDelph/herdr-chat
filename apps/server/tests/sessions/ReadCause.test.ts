/**
 * Les quatre causes de lecture (B03).
 *
 * Ces tests verrouillent la distinction que l'interface doit faire : une
 * session **absente** n'est pas une panne, une session **vide** non plus, et
 * une session **illisible** ne se répare pas en réessayant.
 *
 * Le test qui compte le plus est « seule `ENOENT` donne absent » : c'est
 * exactement le bug qui faisait crier tout agent fraîchement lancé, en boucle
 * toutes les 2 s.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyReadFailure,
  estAbsence,
  invalidSession,
  statusFor,
  verdictOf,
} from "../../src/sessions/ReadCause.ts";
import { isMissingFile } from "../../src/sessions/SessionReader.ts";

const rejet = (reason: string) => ({
  _tag: "SessionPathRejected",
  detail: `refus ${reason}`,
  reason,
});

/** Reproduit la forme d'une erreur Node : `code` à la racine ou dans `cause`. */
const erreur = (code: string | undefined, nested = false) => {
  const base =
    code === undefined ? new Error("panne") : Object.assign(new Error("panne"), { code });
  return nested ? { cause: base, detail: "enveloppé" } : base;
};

describe("B03 — quatre causes, jamais confondues", () => {
  test("ENOENT seul donne « absente »", () => {
    expect(classifyReadFailure(erreur("ENOENT")).cause).toBe("absente");
  });

  test("ENOENT imbriqué dans `cause` donne aussi « absente »", () => {
    // La forme réelle d'une erreur enveloppée par Effect porte le code un
    // niveau plus bas : ne chercher qu'à la racine manquait ce cas.
    expect(classifyReadFailure(erreur("ENOENT", true)).cause).toBe("absente");
  });

  test("EACCES et EPERM donnent « io », pas « absente »", () => {
    // Le bug symétrique : traiter une permission refusée comme un fichier
    // absent afficherait « session absente » alors qu'elle existe et est
    // interdite. L'utilisateur croirait à une session neuve.
    expect(classifyReadFailure(erreur("EACCES")).cause).toBe("io");
    expect(classifyReadFailure(erreur("EPERM")).cause).toBe("io");
  });

  test("ELOOP donne « io »", () => {
    expect(classifyReadFailure(erreur("ELOOP")).cause).toBe("io");
  });

  test("une erreur sans code donne « io »", () => {
    expect(classifyReadFailure(new Error("disque plein")).cause).toBe("io");
  });

  test("un refus de chemin garde sa propre cause, pas « io » générique", () => {
    const refus = { _tag: "SessionPathRejected", detail: "chemin hors de la racine autorisée" };
    const verdict = classifyReadFailure(refus);
    // Le message du refus est conservé tel quel : le réqualifier en « io »
    // effacerait exactement la distinction que S03 a construite.
    expect(verdict.message).toBe("chemin hors de la racine autorisée");
    expect(verdict.benign).toBe(false);
  });

  test("seules « absente » et « vide » sont bénignes", () => {
    expect(verdictOf("absente").benign).toBe(true);
    expect(verdictOf("vide").benign).toBe(true);
    expect(verdictOf("invalide").benign).toBe(false);
    expect(verdictOf("io").benign).toBe(false);
  });

  test("chaque cause a un statut et un message distincts", () => {
    const causes = ["absente", "vide", "invalide", "io"] as const;
    const messages = causes.map((cause) => verdictOf(cause).message);
    expect(new Set(messages).size).toBe(4);
    expect(statusFor("absente")).toBe(200);
    expect(statusFor("vide")).toBe(200);
    // « illisible » vaut 422 : ni OK, ni panne serveur.
    expect(statusFor("invalide")).toBe(422);
    expect(statusFor("io")).toBe(502);
  });

  test("« illisible » nomme ce qui est illisible", () => {
    // Un message générique ferait croire à une panne réseau et pousserait à
    // réessayer, alors que le fichier ne se réparera pas tout seul.
    const verdict = invalidSession("ligne tronquée");
    expect(verdict.message).toContain("ligne tronquée");
    expect(verdict.cause).toBe("invalide");
  });
});

/**
 * Un fichier de session **pas encore écrit** n'est pas une panne.
 *
 * ⚠️ **Mesuré sur un onglet réel à cinq panes.** Un agent qui vient de démarrer
 * annonce son chemin de session **avant** d'avoir écrit quoi que ce soit : le
 * pane `pi` s'affichait donc en `error`, alors qu'il était simplement neuf. Un
 * `error` fait croire à une panne et envoie chercher un problème qui n'existe
 * pas — c'est le même défaut que devin, qui avait été corrigé pour les bases et
 * laissé pour les fichiers.
 *
 * ⚠️ Les autres refus de chemin gardent leur refus : `hors-racine` et
 * `lien-sortant` sont des **intrusions**, `racine-absente` dit que le magasin
 * manque. Les requalifier effacerait la distinction que S03 a construite.
 */
describe("un chemin absent est bénin, un refus ne l'est pas", () => {
  test("`chemin-absent` donne « absente », donc bénin", () => {
    const verdict = classifyReadFailure(rejet("chemin-absent"));

    expect(verdict.cause).toBe("absente");
    expect(verdict.benign).toBe(true);
  });

  test("`hors-racine` reste un refus, jamais « absente »", () => {
    const verdict = classifyReadFailure(rejet("hors-racine"));

    expect(verdict.benign).toBe(false);
    expect(verdict.cause).toBe("io");
  });

  test("`lien-sortant` aussi", () => {
    expect(classifyReadFailure(rejet("lien-sortant")).benign).toBe(false);
  });

  test("`racine-absente` aussi : c'est le magasin qui manque", () => {
    expect(classifyReadFailure(rejet("racine-absente")).benign).toBe(false);
  });

  test("un refus SANS raison reste un refus", () => {
    // ⚠️ Garde-fou : si la raison disparaissait de la classe, on retomberait sur
    // le traitement dangereux plutôt que sur le bénin — le bon sens de l'erreur.
    expect(classifyReadFailure({ _tag: "SessionPathRejected", detail: "refus" }).benign).toBe(
      false,
    );
  });
});

/**
 * Une absence se reconnaît de **deux** façons, et elles doivent tomber d'accord.
 *
 * ⚠️ **Le désaccord existait, et il a rendu un pane inutilisable.** L'absence
 * arrive soit par un `ENOENT` d'E/S, soit par le rejet `chemin-absent` de la
 * garde de chemin — qui vérifie l'existence **avant** d'ouvrir. Le lecteur de
 * fichier ne testait que le premier : pour un agent neuf, dont Herdr annonce le
 * chemin avant que le fichier existe, le rejet passait donc pour une **panne** —
 * 403 sur la route, `error` dans la liste, et « forme de réponse inattendue »
 * à l'écran.
 */
describe("estAbsence — les deux formes d'une même absence", () => {
  test("un ENOENT d'E/S est une absence", () => {
    expect(estAbsence(Object.assign(new Error("no such file"), { code: "ENOENT" }))).toBe(true);
  });

  test("un rejet `chemin-absent` de la garde en est une aussi", () => {
    expect(
      classifyReadFailure({
        _tag: "SessionPathRejected",
        detail: "missing session",
        reason: "chemin-absent",
      }).cause,
    ).toBe("absente");
    expect(
      estAbsence({
        _tag: "SessionPathRejected",
        detail: "missing session",
        reason: "chemin-absent",
      }),
    ).toBe(true);
  });

  test("une intrusion n'est PAS une absence", () => {
    // ⚠️ C'est la distinction que la garde construit : `hors-racine` et
    // `lien-sortant` ne doivent jamais être confondus avec « il n'y a rien ici ».
    expect(estAbsence({ _tag: "SessionPathRejected", detail: "x", reason: "hors-racine" })).toBe(
      false,
    );
    expect(estAbsence({ _tag: "SessionPathRejected", detail: "x", reason: "lien-sortant" })).toBe(
      false,
    );
  });

  test("une permission refusée n'en est pas une non plus", () => {
    expect(estAbsence(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
  });

  test("le lecteur et le classificateur disent la MÊME chose", () => {
    // Une seule règle : `isMissingFile` délègue à `estAbsence`.
    const enoCnt = Object.assign(new Error("x"), { code: "ENOENT" });
    const refusDeChemin = { _tag: "SessionPathRejected", detail: "x", reason: "chemin-absent" };
    for (const e of [enoCnt, refusDeChemin]) expect(isMissingFile(e)).toBe(estAbsence(e));
  });
});
