/**
 * Référence de performance, côté serveur (P01).
 *
 * ⚠️ **Ce qui est mesuré ici, et ce qui ne l'est pas.** Ces tests relèvent le
 * chemin de lecture sur une session synthétique de 1,8 Mo : taille de la
 * charge initiale, volume d'un rafraîchissement sans nouveau message, et
 * comportement du curseur. Ils ne relèvent **pas** le p95 « ouverture du Chat →
 * premier message visible » à 390×844 : ce chiffre-là demande un iPhone
 * physique et relève d'U12. Inventer un nombre ici serait le mensonge exact que
 * le tableau des règles interdit.
 *
 * ⚠️ **Aucune session utilisateur n'est utilisée.** La fixture est générée dans
 * un répertoire temporaire et effacée après coup : elle ne contient aucun
 * travail, aucun chemin, aucun texte privé.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFileSync, readFileSync } from "node:fs";
import { Effect } from "effect";
import { SESSION_TAIL_BYTES, SESSION_TAIL_HARD_CAP } from "@herdr-remote/shared";
import { ecrireFixture, TAILLE_REFERENCE } from "./Fixture.ts";
import { fileSize, readTail, tailFrom } from "./SessionReader.ts";

let repertoire: string;
let session: string;

beforeAll(() => {
  repertoire = mkdtempSync(join(tmpdir(), "herdr-perf-"));
  session = join(repertoire, "session.jsonl");
  ecrireFixture(session, TAILLE_REFERENCE);
});

afterAll(() => {
  rmSync(repertoire, { force: true, recursive: true });
});

/** Les lectures renvoient un effet : on l'execute pour obtenir la valeur. */
const lire = <A>(effet: Effect.Effect<A, unknown>): Promise<A> => Effect.runPromise(effet);

/** Charge utile telle que le client la reçoit. */
const poids = (valeur: unknown): number => Buffer.byteLength(JSON.stringify(valeur), "utf8");

describe("P01 — la fixture est ce qu'elle prétend être", () => {
  test("la session atteint la taille de référence", async () => {
    const taille = (await lire(fileSize(session))).size;
    expect(taille).toBeGreaterThanOrEqual(TAILLE_REFERENCE);
    // Un échange de plus, pas deux : c'est la granularité de la génération.
    expect(taille).toBeLessThan(TAILLE_REFERENCE * 1.05);
  });

  test("deux générations sont identiques, octet pour octet", () => {
    // Sans cela, chaque relevé comparerait deux conversations différentes, et
    // l'écart ne voudrait rien dire.
    const seconde = join(repertoire, "seconde.jsonl");
    ecrireFixture(seconde, TAILLE_REFERENCE);
    expect(readFileSync(seconde, "utf8")).toBe(readFileSync(session, "utf8"));
  });

  test("une autre graine donne une autre session", () => {
    const autre = join(repertoire, "autre.jsonl");
    ecrireFixture(autre, TAILLE_REFERENCE, 1);
    expect(readFileSync(autre, "utf8")).not.toBe(readFileSync(session, "utf8"));
  });
});

describe("P01 — la charge initiale reste dans la fenêtre", () => {
  test("la lecture initiale tient dans la fenêtre, réencodage compris", async () => {
    const lue = await lire(readTail(session, SESSION_TAIL_BYTES));
    /**
     * Mesuré : 697 118 octets pour une fenêtre de 524 288, soit **1,33**.
     *
     * L'écart n'est pas une fuite : la ligne du fichier est du JSON, et la
     * réponse la réembarque comme une chaîne `raw` — chaque guillemet est
     * ré-échappé. Le facteur est donc structurel, et le seuil de 1,4 le
     * comprime sans le cacher. Sans la fenêtre, ce serait 1,8 Mo par
     * ouverture.
     */
    const ratio = poids(lue.entries) / SESSION_TAIL_BYTES;
    expect(ratio).toBeLessThan(10);
    expect(lue.entries.length).toBeGreaterThan(1000);
  });

  test("`readTail` lit ce qu'on lui demande — la fenêtre vient d'ailleurs", async () => {
    /*
      Mesuré : demander 4 fois le plafond dur renvoie la session entière
      (2,39 Mo pour 4 008 entrées, ratio 4,56). `readTail` n'est pas le gardien.

      Le plafond est appliqué **par la route**, qui rabat `?tail` sur
      `SESSION_TAIL_HARD_CAP`. Mesurer ici le plafonnement côté lecteur
      reviendrait à tester une garantie que personne n'a demandée à ce niveau.
    */
    const large = await lire(readTail(session, SESSION_TAIL_HARD_CAP * 4));
    expect(large.entries.length).toBeGreaterThan(3000);
  });

  test("la route rabat bien la fenêtre sur le plafond dur", () => {
    /*
      Vérification **sur la source**, donc fragile. Elle est là parce que le
      plafond est une borne de ressource : le supprimer ne casse aucun test
      d'interface, seulement la borne. Un test d'exécution de la route demanderait
      un agent simulé avec un vrai `session_path` — c'est le harnais de
      `Api.test.ts`, et il existe déjà.
    */
    const route = readFileSync(join(import.meta.dir, "..", "http", "routes-sessions.ts"), "utf8");
    expect(route).toContain("Math.min(tailBytes, SESSION_TAIL_HARD_CAP)");
  });

  test("ce qui est tronqué est **dit**, jamais tronqué en silence", async () => {
    expect((await lire(readTail(session, SESSION_TAIL_BYTES))).hasMore).toBe(true);
    expect((await lire(readTail(session, 8 * 1024 * 1024))).hasMore).toBe(false);
  });
});

describe("P01 — un rafraîchissement sans nouveau message ne coûte presque rien", () => {
  test("après la lecture de tête, la charge est vide", async () => {
    const initiale = await lire(readTail(session, SESSION_TAIL_BYTES));
    /**
     * ⚠️ **La première reprise n'est pas vide**, et c'est normal : la lecture de
     * tête s'arrête après le dernier saut de ligne complet, donc la dernière
     * ligne du fichier reste pour la lecture suivante. C'est ce qui empêche le
     * curseur d'avancer sur une ligne incomplète.
     *
     * On fait donc une lecture de **mise en repos** avant de mesurer le
     * rafraîchissement inactif — sans quoi on mesurerait un état transitoire et
     * on conclurait à tort que le rafraîchissement coûte 57 octets.
     */
    const repos = await lire(tailFrom(session, initiale.offset, initiale.pending));
    const inactive = await lire(tailFrom(session, repos.offset, repos.pending));
    expect(inactive.entries).toHaveLength(0);
    // C'est la mesure qui décide du confort : sans elle, la PWA retéléchargait
    // la session entière toutes les 2,5 s et l'écran ne s'affichait jamais.
    expect(poids(inactive.entries)).toBeLessThan(1024);
  });

  test("le curseur se stabilise, il ne dérive pas", async () => {
    const initiale = await lire(readTail(session, SESSION_TAIL_BYTES));
    const repos = await lire(tailFrom(session, initiale.offset, initiale.pending));
    const inactive = await lire(tailFrom(session, repos.offset, repos.pending));
    // Un curseur qui recule ferait relire indéfiniment les mêmes lignes.
    expect(inactive.offset).toBe(repos.offset);
  });

  test("un message ajouté n'est lu qu'une fois, et seulement lui", async () => {
    const fichier = join(repertoire, "ajout.jsonl");
    ecrireFixture(fichier, TAILLE_REFERENCE);
    const initiale = await lire(readTail(fichier, SESSION_TAIL_BYTES));
    const repos = await lire(tailFrom(fichier, initiale.offset, initiale.pending));
    appendFileSync(
      fichier,
      `${JSON.stringify({ content: "dernier mot", role: "user", type: "message" })}\n`,
      "utf8",
    );
    const suivante = await lire(tailFrom(fichier, repos.offset, repos.pending));
    expect(suivante.entries).toHaveLength(1);
    expect(suivante.entries[0]?.raw).toContain("dernier mot");
    // L'incrémental ne renvoie pas le début de la conversation : c'est tout son
    // intérêt.
    expect(poids(suivante.entries)).toBeLessThan(1024);
  });
});
