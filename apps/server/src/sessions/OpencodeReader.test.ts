/**
 * Le lecteur SQLite d'opencode.
 *
 * ⚠️ **Pourquoi ces tests fabriquent une base.** Le contrat à vérifier n'est pas
 * « ça lit ma base » mais « ça lit **n'importe quelle** base au bon format », y
 * compris les cas que la base réelle ne contient pas encore : une session vide,
 * un identifiant inconnu, une page antérieure, un `seq` qui avance. Un test
 * branché sur la base de la machine ne prouverait rien de tout cela — et
 * échouerait sur la machine de quelqu'un d'autre.
 *
 * La base est créée avec **exactement** le schéma mesuré, colonnes et types :
 * `session_v2(id, …)` et `session_message(id, session_id, type, seq,
 * time_created, time_updated, data)`.
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lireAvant, lireDepuis, lireDerniere, sessionExiste } from "./OpencodeReader.ts";

let dossier = "";
let base = "";
const SESSION = "ses_ef41fb118ffeUmFo0RN74rXEyi";

/** Le schéma réel, réduit aux colonnes utilisées. */
const creer = (chemin: string): Database => {
  const db = new Database(chemin);
  db.exec(`
    CREATE TABLE session_v2 (id text PRIMARY KEY, slug text NOT NULL, directory text NOT NULL);
    CREATE TABLE session_message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      type text NOT NULL,
      seq integer NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
  `);
  return db;
};

/** Insère une ligne de session, comme opencode l'écrit. */
const poser = (
  db: Database,
  seq: number,
  type: string,
  data: Record<string, unknown>,
  id = `msg_${String(seq)}`,
): void => {
  db.query(
    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, SESSION, type, seq, 1791873812016 + seq, 1791873812016 + seq, JSON.stringify(data));
};

const assistant = (texte: string): Record<string, unknown> => ({
  content: [{ text: texte, type: "text" }],
  time: { created: 1791873812016 },
});

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "opencode-test-"));
  base = join(dossier, "opencode.db");
  const db = creer(base);
  db.query("INSERT INTO session_v2 (id, slug, directory) VALUES (?, ?, ?)").run(
    SESSION,
    "stellar-wolf",
    "/projet",
  );
  // Une conversation courte, avec les types qui ne se traduisent pas.
  poser(db, 1, "user", { text: "fais ceci", time: { created: 1791873812017 } });
  poser(db, 2, "assistant", assistant("je le fais"));
  poser(db, 3, "assistant", { content: [{ text: "encore", type: "text" }] });
  poser(db, 4, "idle", { outcome: "succeeded" });
  poser(db, 5, "system", { text: "instructions" });
  poser(db, 6, "assistant", assistant("et voilà"));
  db.close();
});

afterEach(() => {
  rmSync(dossier, { force: true, recursive: true });
});

describe("la dernière page", () => {
  test("rend les messages dans l'ordre, du plus ancien au plus récent", () => {
    const page = lireDerniere(base, SESSION, 10);

    expect(page.entries.map((e) => e.id)).toEqual([
      "opencode:msg_1",
      "opencode:msg_2",
      "opencode:msg_3",
      "opencode:msg_4",
      "opencode:msg_5",
      "opencode:msg_6",
    ]);
  });

  test("les lignes traduites portent le type `message`, les autres leur type réel", () => {
    const page = lireDerniere(base, SESSION, 10);
    const types = page.entries.map((e) => e.type);

    expect(types).toEqual(["message", "message", "message", "idle", "system", "message"]);
  });

  test("une ligne non traduite est conservée, pas jetée", () => {
    // ⚠️ La fidélité prime : un type inconnu ne doit pas disparaître de
    // l'historique. C'est la même règle que pour le lecteur de fichier.
    const page = lireDerniere(base, SESSION, 10);
    const idle = page.entries.find((e) => e.type === "idle");

    expect(idle).toBeDefined();
    expect(idle?.raw).toContain("succeeded");
  });

  test("la fenêtre se limite à ce qu'on demande, et le dit", () => {
    const page = lireDerniere(base, SESSION, 3);

    expect(page.entries.length).toBe(3);
    expect(page.hasMore).toBe(true);
    expect(page.entries.map((e) => e.id)).toEqual([
      "opencode:msg_4",
      "opencode:msg_5",
      "opencode:msg_6",
    ]);
  });

  test("quand tout tient, `hasMore` est faux", () => {
    const page = lireDerniere(base, SESSION, 100);

    expect(page.hasMore).toBe(false);
  });

  test("le curseur pointe sur la PREMIÈRE ligne de la page", () => {
    // ⚠️ C'est ce curseur qui sert à demander la page d'avant : il doit désigner
    // le début de ce qu'on a déjà, pas la fin.
    const page = lireDerniere(base, SESSION, 3);

    expect(page.seq).toBe(4);
  });
});

describe("le rafraîchissement incrémental", () => {
  test("ne renvoie que ce qui suit le curseur", () => {
    const page = lireDepuis(base, SESSION, 3, 100);

    expect(page.entries.map((e) => e.id)).toEqual([
      "opencode:msg_4",
      "opencode:msg_5",
      "opencode:msg_6",
    ]);
  });

  test("le curseur lui-même n'est PAS renvoyé deux fois", () => {
    // `seq > ?` et non `>=` : un `>=` redonnerait la ligne déjà affichée à
    // chaque tour, et le fil la dupliquerait.
    const page = lireDepuis(base, SESSION, 6, 100);

    expect(page.entries).toEqual([]);
  });

  test("sans nouveau message, le curseur ne bouge pas", () => {
    const page = lireDepuis(base, SESSION, 6, 100);

    expect(page.seq).toBe(6);
    expect(page.hasMore).toBe(false);
  });

  test("le curseur avance sur les lignes NON traduites aussi", () => {
    // ⚠️ Le défaut que ce test encadre : n'avancer que sur les lignes traduites
    // ferait relire `idle` et `system` à chaque tour, indéfiniment.
    const page = lireDepuis(base, SESSION, 3, 100);

    expect(page.seq).toBe(6);
  });
});

describe("la page antérieure", () => {
  test("rend la fenêtre qui PRÉCÈDE le curseur", () => {
    // Avant `seq 4` : les lignes 1 à 3.
    const page = lireAvant(base, SESSION, 4, 10);

    expect(page.entries.map((e) => e.id)).toEqual([
      "opencode:msg_1",
      "opencode:msg_2",
      "opencode:msg_3",
    ]);
  });

  test("elle est remise dans l'ordre de lecture", () => {
    // La requête descend (pour prendre les plus proches), le rendu monte.
    const page = lireAvant(base, SESSION, 6, 2);
    const seqs = page.entries.map((e) => e.id);

    expect(seqs).toEqual(["opencode:msg_4", "opencode:msg_5"]);
  });

  test("elle dit s'il reste plus ancien", () => {
    expect(lireAvant(base, SESSION, 6, 2).hasMore).toBe(true);
    expect(lireAvant(base, SESSION, 3, 10).hasMore).toBe(false);
  });

  test("son curseur pointe sur la première ligne rendue", () => {
    expect(lireAvant(base, SESSION, 6, 2).seq).toBe(4);
  });
});

describe("une session connue mais vide n'est pas une erreur", () => {
  test("la session existe, et sa page est vide", () => {
    const db = creer(join(dossier, "vide.db"));
    db.query("INSERT INTO session_v2 (id, slug, directory) VALUES (?, ?, ?)").run(
      "ses_vide",
      "calm-otter",
      "/projet",
    );
    db.close();

    expect(sessionExiste(join(dossier, "vide.db"), "ses_vide")).toBe(true);
    const page = lireDerniere(join(dossier, "vide.db"), "ses_vide", 10);
    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.seq).toBe(0);
  });
});

describe("un identifiant inconnu est distingué d'une session vide", () => {
  test("la session n'existe pas", () => {
    // ⚠️ La distinction compte : un identifiant qu'Herdr annonce mais que la
    // base ignore est une PANNE (mauvaise base, mauvais identifiant) ; une
    // session sans message est bénigne. Les confondre donnerait soit une erreur
    // rouge sur un agent qui démarre, soit un écran muet sur une vraie panne.
    expect(sessionExiste(base, "ses_inexistante")).toBe(false);
  });

  test("une autre session ne fuit pas dans la première", () => {
    const db = creer(join(dossier, "deux.db"));
    db.query("INSERT INTO session_v2 (id, slug, directory) VALUES (?, ?, ?)").run(
      SESSION,
      "a",
      "/projet",
    );
    db.query("INSERT INTO session_v2 (id, slug, directory) VALUES (?, ?, ?)").run(
      "ses_autre",
      "b",
      "/projet",
    );
    db.query(
      "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("m1", "ses_autre", "user", 1, 1, 1, JSON.stringify({ text: "ailleurs" }));
    db.close();

    expect(lireDerniere(join(dossier, "deux.db"), SESSION, 10).entries).toEqual([]);
    expect(lireDerniere(join(dossier, "deux.db"), "ses_autre", 10).entries.length).toBe(1);
  });
});

describe("rien n'est inventé quand la source est abîmée", () => {
  test("un `data` illisible donne une entrée brute, jamais une exception", () => {
    const db = creer(join(dossier, "casse.db"));
    db.query("INSERT INTO session_v2 (id, slug, directory) VALUES (?, ?, ?)").run(
      SESSION,
      "a",
      "/projet",
    );
    db.query(
      "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("m1", SESSION, "assistant", 1, 1791873812016, 1791873812016, "{pas du json");
    db.close();

    const page = lireDerniere(join(dossier, "casse.db"), SESSION, 10);

    expect(page.entries.length).toBe(1);
    expect(page.entries[0]?.raw).toBe("{pas du json");
    expect(page.entries[0]?.type).toBe("assistant");
  });

  test("une base absente lève, et ne rend pas une session vide", () => {
    // ⚠️ Une base absente est une panne de configuration, pas une session vide.
    // La confondre ferait passer une installation cassée pour un agent muet.
    expect(() => lireDerniere(join(dossier, "inconnue.db"), SESSION, 10)).toThrow();
  });
});
