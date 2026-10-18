/**
 * Confinement des chemins de session (S03).
 *
 * **Ce que ces tests protègent.** Le chemin d'une session vient de Herdr, donc
 * d'une source externe. Sans confinement, un `agent_session` malveillant
 * pointant vers `~/.ssh/id_rsa` serait lu et renvoyé comme une conversation.
 *
 * Chaque cas négatif est écrit pour **échouer** si la garde est contournée.
 * C'est la preuve exigée par le backlog : « `../`, préfixe similaire, lien
 * sortant et chemin absent rejetés avec cause distincte ».
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeRejection, isWithin, resolveWithin } from "../../src/sessions/PathGuard.ts";

let TMP = "";
let ROOT = "";
let SESSIONS = "";
let OUTSIDE = "";

/** Un `agent_session` valide, que seule la position doit rendre refusé. */
const seed = (dir: string, name: string, body = '{"type":"assistant"}\n') => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, body, "utf8");
  return file;
};

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "herdr-guard-"));
  ROOT = join(TMP, "sessions");
  SESSIONS = join(ROOT, "projet");
  OUTSIDE = join(TMP, "secrets");
  mkdirSync(SESSIONS, { recursive: true });
  seed(SESSIONS, "ok.jsonl");
  seed(OUTSIDE, "id_rsa", "PRIVATE KEY\n");
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("isWithin — comparaison par segments", () => {
  test("un descendant direct est accepté", () => {
    expect(isWithin("/a/b", "/a/b/c")).toBe(true);
  });

  test("la racine elle-même est acceptée", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(true);
  });

  /**
   * **Le piège du préfixe.** `"/ab".startsWith("/a")` est vrai, alors que
   * `/ab` est un dossier **frère** de `/a`, pas un enfant. Comparer des
   * chaînes autoriserait donc `/secrets` dès lors que la racine s'appelle
   * `/sec`.
   */
  test("un préfixe de chaîne similar est REFUSÉ", () => {
    expect(isWithin("/a/b", "/a/bc")).toBe(false);
    expect(isWithin("/root", "/rootsecrets")).toBe(false);
  });

  test("un parent est refusé", () => {
    expect(isWithin("/a/b/c", "/a/b")).toBe(false);
  });

  test("un dossier frère est refusé", () => {
    expect(isWithin("/a/b", "/a/x")).toBe(false);
  });

  test("une racine avec barre finale se comporte pareil", () => {
    expect(isWithin("/a/b/", "/a/b")).toBe(true);
    expect(isWithin("/a/b/", "/a/b/c")).toBe(true);
    expect(isWithin("/a/b/", "/a/bc")).toBe(false);
  });
});

describe("resolveWithin — le refus garde sa cause", () => {
  test("une session dans la racine est acceptée", async () => {
    const verdict = await resolveWithin(ROOT, join(SESSIONS, "ok.jsonl"));
    expect(verdict.ok).toBe(true);
    expect(verdict.resolved).toBeDefined();
  });

  test("le chemin accepted est le chemin RÉSOLU, pas l'original", async () => {
    /*
      ⚠️ **Ce test s'appuyait sur la plateforme, pas sur le produit.**

      Il comptait sur le dossier temporaire de macOS, qui est derrière un lien
      (`/var/folders` → `/private/var`) : il vérifiait donc qu'un chemin rendu
      commençait par `/private`. Vrai sur un Mac, faux sur un runner Linux où
      `/tmp` est réel — et il n'avait jamais pu échouer ici. Il ne testait pas la
      résolution, il testait le système d'exploitation.

      On crée donc **son propre** lien symbolique. La propriété testée est
      maintenant la vraie : un chemin qui **traverse** un lien revient résolu.
    */
    const lien = join(ROOT, "lien-vers-projet");
    symlinkSync(SESSIONS, lien);
    const verdict = await resolveWithin(ROOT, join(lien, "ok.jsonl"));
    expect(verdict.ok).toBe(true);
    // Plus aucune trace du segment emprunté : c'est la cible qui est rendue.
    expect(verdict.resolved).not.toContain("lien-vers-projet");
    expect(verdict.resolved?.endsWith(join("projet", "ok.jsonl"))).toBe(true);
  });

  test("une traversée `../` est refusée avec cause « hors-racine »", async () => {
    const verdict = await resolveWithin(ROOT, join(SESSIONS, "..", "..", "secrets", "id_rsa"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("hors-racine");
  });

  test("un lien symbolique sortant est refusé, cause distincte", async () => {
    const link = join(SESSIONS, "raccourci.jsonl");
    try {
      symlinkSync(join(OUTSIDE, "id_rsa"), link);
    } catch {
      return; // le FS ne permet pas le lien : rien à prouver ici
    }
    const verdict = await resolveWithin(ROOT, link);
    expect(verdict.ok).toBe(false);
    // Le lien **lui-même** est dans la racine, mais sa cible ne l'est pas : c'est
    // ce qui distingue `lien-sortant` de `hors-racine`. Mesuré, pas supposé.
    expect(verdict.reason).toBe("lien-sortant");
  });

  test("un lien symbolique interne reste accepté", async () => {
    const link = join(SESSIONS, "interne.jsonl");
    try {
      symlinkSync(join(SESSIONS, "ok.jsonl"), link);
    } catch {
      return;
    }
    const verdict = await resolveWithin(ROOT, link);
    expect(verdict.ok).toBe(true);
  });

  test("un fichier absent donne « chemin-absent », pas une intrusion", async () => {
    const verdict = await resolveWithin(ROOT, join(SESSIONS, "pas-encore-la.jsonl"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("chemin-absent");
  });

  test("un absent DANS un dossier hors racine reste « hors-racine »", async () => {
    // L'ordre compte : refuser « hors racine » avant « absent », sinon une
    // intrusion devient indiscernable d'un fichier simplement pas encore créé.
    const verdict = await resolveWithin(ROOT, join(OUTSIDE, "absent.jsonl"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("hors-racine");
  });

  test("une racine absente a sa propre cause", async () => {
    const verdict = await resolveWithin(join(TMP, "pas-de-racine"), join(SESSIONS, "ok.jsonl"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("racine-absente");
  });
});

describe("describeRejection — jamais de message générique", () => {
  test("chaque cause a son propre texte", () => {
    const textes = [
      describeRejection("racine-absente"),
      describeRejection("chemin-absent"),
      describeRejection("hors-racine"),
      describeRejection("lien-sortant"),
    ];
    expect(new Set(textes).size).toBe(4);
  });

  test("le refus nomme la racine autorisée", () => {
    expect(describeRejection("hors-racine")).toContain("root");
  });
});

describe("intégration — la lecture refuse bien d'ouvrir", () => {
  test("readTail refuse un chemin hors racine au lieu de le lire", async () => {
    const { readTail } = await import("../../src/sessions/SessionReader.ts");
    const secret = seed(OUTSIDE, "reve.jsonl", '{"type":"assistant","text":"secret"}\n');
    const outcome = await Effect.runPromise(Effect.result(readTail(secret, 4096, ROOT)));
    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      // Le refus est typé et nommé, pas une exception d'E/S.
      expect(String(outcome.failure)).toContain("SessionPathRejected");
    }
  });

  test("readTail lit bien une session légitime dans la racine", async () => {
    const { readTail } = await import("../../src/sessions/SessionReader.ts");
    const ok = seed(SESSIONS, "lisible.jsonl", '{"type":"assistant","text":"bonjour"}\n');
    const outcome = await Effect.runPromise(Effect.result(readTail(ok, 4096, ROOT)));
    expect(outcome._tag).toBe("Success");
  });
});
