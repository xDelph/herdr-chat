/**
 * Retrouver la session d'un agent codex quand Herdr ne la publie plus.
 *
 * ⚠️ **Ce fichier verrouille une régression réelle, datée du 2026-10-17.** Le
 * côté Herdr a cessé de rapporter les sessions codex :
 *
 * ```
 * api request completed outcome=error method="pane.report_agent_session"
 * ```
 *
 * `agent_session` restait nul, la route rendait `404 no usable session path`, et
 * une conversation qui existait sur le disque devenait invisible. Le repli lit
 * l'index de codex lui-même — nom du fil et dossier — et **exige** les trois
 * preuves (nom, dossier, fichier présent). Sans les trois, il rend `undefined` :
 * jamais la session d'un autre.
 *
 * ⚠️ Les fixtures sont de **vrais** fichiers et une **vraie** base SQLite, pas
 * des simulacres : la seule façon de prouver qu'une requête trouve une ligne est
 * de la lui faire trouver.
 */
import { Database } from "bun:sqlite";
import { Option, Schema } from "effect";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cheminCodexParNom,
  nomDeSessionCodex,
  sessionCodexParTitre,
  sourceSessionDe,
} from "./SessionLocator.ts";

let racine = "";

beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), "herdr-codex-loc-"));
  process.env["CODEX_HOME"] = racine;
  process.env["CODEX_SESSION_ROOT"] = join(racine, "sessions");
  mkdirSync(join(racine, "sessions", "2026", "10", "17"), { recursive: true });
});

afterEach(() => {
  delete process.env["CODEX_HOME"];
  delete process.env["CODEX_SESSION_ROOT"];
  rmSync(racine, { force: true, recursive: true });
});

/** Crée un fichier de session et rend son chemin. */
const session = (id: string): string => {
  const chemin = join(racine, "sessions", "2026", "10", "17", `rollout-2026-10-17-${id}.jsonl`);
  writeFileSync(chemin, `${JSON.stringify({ payload: { id } })}\n`, "utf8");
  return chemin;
};

/** Écrit l'index de codex, le vrai : `threads (name, cwd, rollout_path, archived)`. */
const index = (
  lignes: ReadonlyArray<{ name: string; cwd: string; rollout: string; archived?: number }>,
): void => {
  const db = new Database(join(racine, "state_9.sqlite"));
  db.run(
    "create table threads (id text primary key, name text, cwd text, rollout_path text, archived integer, updated_at integer)",
  );
  const insert = db.query(
    "insert into threads (id, name, cwd, rollout_path, archived, updated_at) values (?, ?, ?, ?, ?, ?)",
  );
  lignes.forEach((ligne, rang) => {
    insert.run(rang, ligne.name, ligne.cwd, ligne.rollout, ligne.archived ?? 0, rang);
  });
  db.close();
};

const CWD = "/Users/someone/projects/perso/herdr-pwa";
/** Le titre relevé sur `wB:p1B`, verbatim. */
const TITRE = "Audit PWA and webapp | herdr-pwa";

describe("le nom de session est lu dans le titre du pane", () => {
  test("« <nom> | <dossier> » donne le nom", () => {
    expect(nomDeSessionCodex(TITRE, CWD)).toBe("Audit PWA and webapp");
  });

  test("un titre qui n'est QUE le dossier ne dit aucun nom", () => {
    // C'est le titre d'un pane codex jamais utilisé : il n'y a rien à retrouver.
    expect(nomDeSessionCodex("herdr-pwa", CWD)).toBeUndefined();
    expect(nomDeSessionCodex("perso", "/Users/someone/projects/perso")).toBeUndefined();
  });

  test("le dossier doit être celui du pane", () => {
    // Sinon le titre vient d'un autre référentiel et le nom ne prouve rien.
    expect(nomDeSessionCodex(TITRE, "/Users/someone/ailleurs")).toBeUndefined();
  });

  test("un titre vide ou un dossier absent ne lèvent pas", () => {
    expect(nomDeSessionCodex(null, CWD)).toBeUndefined();
    expect(nomDeSessionCodex(TITRE, null)).toBeUndefined();
    expect(nomDeSessionCodex("", CWD)).toBeUndefined();
    expect(nomDeSessionCodex(" | herdr-pwa", CWD)).toBeUndefined();
  });
});

describe("l'index de codex confirme, ou ne confirme pas", () => {
  test("nom ET dossier correspondent, le fichier existe : la session est trouvée", () => {
    const chemin = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    expect(cheminCodexParNom("Audit PWA and webapp", CWD)).toBe(chemin);
  });

  test("le même nom dans un AUTRE dossier n'est pas celle du pane", () => {
    const chemin = session("01a14a74");
    index([{ cwd: "/Users/someone/ailleurs", name: "Audit PWA and webapp", rollout: chemin }]);

    expect(cheminCodexParNom("Audit PWA and webapp", CWD)).toBeUndefined();
  });

  test("un fil ARCHIVÉ ne compte pas", () => {
    const chemin = session("01a14a74");
    index([{ archived: 1, cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    expect(cheminCodexParNom("Audit PWA and webapp", CWD)).toBeUndefined();
  });

  test("un chemin indexé mais ABSENT du disque ne compte pas", () => {
    // L'index peut survivre à un fichier effacé : exister est une preuve, être
    // indexé n'en est pas une.
    index([
      {
        cwd: CWD,
        name: "Audit PWA and webapp",
        rollout: join(racine, "sessions", "disparu.jsonl"),
      },
    ]);

    expect(cheminCodexParNom("Audit PWA and webapp", CWD)).toBeUndefined();
  });

  test("sans base du tout, rien n'est trouvé — et rien ne lève", () => {
    expect(cheminCodexParNom("Audit PWA and webapp", CWD)).toBeUndefined();
  });

  test("la base est ouverte en LECTURE SEULE", () => {
    const chemin = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    // Si la base était ouverte en écriture, ceci ne prouverait rien : on vérifie
    // que le module n'a laissé aucune trace — la fixture est intacte.
    expect(cheminCodexParNom("Audit PWA and webapp", CWD)).toBe(chemin);
    const db = new Database(join(racine, "state_9.sqlite"), { readonly: true });
    const brute = db.query("select count(*) as n from threads").get();
    db.close();
    const compte = Option.getOrUndefined(
      Schema.decodeUnknownOption(Schema.Struct({ n: Schema.Number }))(brute),
    );
    expect(compte?.n).toBe(1);
  });
});

describe("l'emplacement se déduit du titre, bout en bout", () => {
  test("le titre de `wB:p1B` rend le fichier de sa session", () => {
    const chemin = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    expect(sessionCodexParTitre(TITRE, CWD)).toEqual({ kind: "path", value: chemin });
  });

  test("un titre sans nom ne rend rien — le pane restera neutre", () => {
    const chemin = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    expect(sessionCodexParTitre("herdr-pwa", CWD)).toBeUndefined();
  });
});

describe("sourceSessionDe — la publication d'Herdr fait toujours foi", () => {
  test("un emplacement publié gagne, même pour codex", () => {
    const parTitre = session("01a14a74");
    const annoncee = session("01a13437");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: parTitre }]);

    // Herdr a parlé : on ne va pas chercher ailleurs. Les deux sessions existent
    // et le titre en désigne une — c'est celle d'Herdr qui doit sortir.
    expect(sourceSessionDe("codex", { kind: "id", value: "01a13437" }, TITRE, CWD)?.base).toBe(
      annoncee,
    );
  });

  test("un id publié qui ne résout pas laisse le repli s'appliquer", () => {
    const parTitre = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: parTitre }]);

    // Un id d'une autre machine, ou d'une session effacée : Herdr a parlé, mais
    // rien ne le confirme. Le titre, lui, confirme.
    expect(sourceSessionDe("codex", { kind: "id", value: "inconnu" }, TITRE, CWD)?.base).toBe(
      parTitre,
    );
  });

  test("Herdr se tait et le titre nomme un fil : le repli s'active", () => {
    const chemin = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    expect(sourceSessionDe("codex", null, TITRE, CWD)).toEqual({ base: chemin, kind: "fichier" });
  });

  test("le repli ne concerne QUE codex", () => {
    const chemin = session("01a14a74");
    index([{ cwd: CWD, name: "Audit PWA and webapp", rollout: chemin }]);

    // Un pi sans session reste sans session : son chemin vient d'Herdr, et un
    // titre qui ressemble à celui de codex ne doit pas le rattacher ailleurs.
    expect(sourceSessionDe("pi", null, TITRE, CWD)).toBeUndefined();
  });

  test("un codex sans titre exploitable reste sans session", () => {
    expect(sourceSessionDe("codex", null, "herdr-pwa", CWD)).toBeUndefined();
  });
});
