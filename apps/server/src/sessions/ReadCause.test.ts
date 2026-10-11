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
import { classifyReadFailure, invalidSession, statusFor, verdictOf } from "./ReadCause.ts";

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
    const rejet = { _tag: "SessionPathRejected", detail: "chemin hors de la racine autorisée" };
    const verdict = classifyReadFailure(rejet);
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
