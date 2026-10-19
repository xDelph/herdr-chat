/**
 * Parité entre la façade **générée** (Rust) et les schemas **écrits à la main**
 * (T057).
 *
 * ⚠️ **Pourquoi ce test existe.** Le contrat vivait en deux définitions : le
 * bundle Rust et `api.ts`. On ne remplace pas l'une par l'autre d'un coup sans
 * preuve : ce test décode les MÊMES charges avec les deux et exige le même
 * verdict (accepté/refusé) et, quand c'est accepté, la même valeur. Tant qu'il
 * est vert, le basculement est sûr ; s'il rougit, c'est une divergence réelle
 * que le générateur ou le schéma manuel doit corriger.
 *
 * ⚠️ **Ce qui n'est pas encore comparable est nommé** : les definitions Rust
 * qui portent un autre nom côté client (`AgentView` ↔ `AgentViewSchema`,
 * `RecentImage` ↔ `RecentImageSchema`, `SessionEntry` ↔ `SessionEntrySchema`)
 * sont listées dans `RENOMMAGES` — c'est la liste EXACTE du travail restant
 * de T057, pas un oubli silencieux.
 */
import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import * as manuel from "../src/api.ts";
import * as genere from "../generated/schemas.ts";

/** Les noms qui diffèrent entre le bundle Rust et `api.ts` (basculement à faire). */
const RENOMMAGES: Record<string, string> = {
  Choice: "Choix",
  AgentView: "AgentViewSchema",
  RecentImage: "RecentImageSchema",
  SessionEntry: "SessionEntrySchema",
  WorkspaceView: "WorkspaceViewSchema",
};

type SchemaEffect = Parameters<typeof Schema.decodeUnknownOption>[0];

/** Un objet est-il un schema Effect ? Le garde évite toute assertion de type. */
const estSchema = (valeur: unknown): valeur is SchemaEffect =>
  // En Effect 4 un schema est une FONCTION (constructeur) portant `ast` —
  // le garde doit donc accepter les deux formes.
  (typeof valeur === "object" || typeof valeur === "function") &&
  valeur !== null &&
  "ast" in valeur;

/** Un schema exporté par un module, ou une erreur nommée (jamais `undefined`). */
const schemaDe = (module: Record<string, unknown>, nom: string): SchemaEffect => {
  const trouve = module[nom];
  if (!estSchema(trouve)) {
    throw new Error(`schéma absent ou invalide : ${nom}`);
  }
  return trouve;
};

/** Le verdict d'un décodage — la seule chose qui compte pour la parité. */
const verdict = (valeur: unknown): string => (valeur === undefined ? "refusé" : "accepté");

const decode = (schema: SchemaEffect, valeur: unknown): unknown =>
  // Effect 4 rend un `Option` : on le déballe comme le fait le client
  // (`decoderOf` dans `apps/web/src/api.ts`).
  Option.getOrUndefined(Schema.decodeUnknownOption(schema)(valeur));

/** Les deux verdicts doivent coïncider — et la valeur aussi. */
const parite = (nomGenere: string, charges: unknown[]): void => {
  const depuisRust = schemaDe(genere, nomGenere);
  const nomManuel = RENOMMAGES[nomGenere] ?? nomGenere;
  const depuisManuel = schemaDe(manuel, nomManuel);
  for (const charge of charges) {
    const a = decode(depuisRust, charge);
    const b = decode(depuisManuel, charge);
    // Le verdict d'abord : un schéma plus permissif est le défaut à attraper.
    expect(verdict(a), `${nomGenere} : ${JSON.stringify(charge).slice(0, 120)}`).toBe(verdict(b));
    if (a !== undefined && b !== undefined) {
      expect(a).toEqual(b);
    }
  }
};

describe("façade générée — parité avec les schemas écrits à la main", () => {
  test("HealthResponse : les deux branches du fil", () => {
    const joignable = {
      herdr: { protocol: 22, reachable: true, socket: "/tmp/h.sock", version: "0.9.3" },
      log: "/tmp/h.log",
      ok: true,
      uptimeMs: 1234,
    };
    const injoignable = {
      herdr: { reachable: false, socket: "/tmp/h.sock" },
      ok: false,
      uptimeMs: 99,
    };
    parite("HealthResponse", [
      joignable,
      injoignable,
      // Refus : `reachable` manquant (le bug D011).
      { herdr: { socket: "/tmp/h.sock" }, ok: true },
      // Refus : `ok` en chaîne.
      { herdr: { reachable: true, socket: "s" }, ok: "oui" },
    ]);
  });

  test("ApiErrorResponse : cause omissible, hint omissible", () => {
    parite("ApiErrorResponse", [
      { error: "no usable session path for this agent" },
      { cause: "absente", error: "session absente", hint: "code : no_source" },
      { cause: "io", error: "permission refusée" },
      // Refus : cause hors des quatre.
      { cause: "autre", error: "x" },
      // Refus : error manquant.
      { cause: "vide", hint: "x" },
    ]);
  });

  test("SessionResponse : caughtUp est omissible (C18)", () => {
    const page = {
      cause: "vide",
      entries: [
        {
          type: "message",
          id: "m-1",
          parentId: null,
          raw: '{"role":"user"}',
          timestamp: "2026-10-15T10:00:00Z",
        },
      ],
      incremental: false,
      cursor: "hc2:LTAwMQ==",
      hasMore: true,
      reset: false,
      sessionPath: "/sessions/pi/wx.jsonl",
    };
    parite("SessionResponse", [
      page,
      { ...page, caughtUp: true },
      { ...page, caughtUp: false },
      // Refus : cause inconnue.
      { ...page, cause: "perdue" },
      // Refus : `entries` n'est pas un tableau.
      { ...page, entries: "aucune" },
    ]);
  });

  test("Question : choix imbriqués, contexte tableau", () => {
    const question = {
      choix: [
        { libelle: "Allow once", numero: 1, selectionne: true, detail: "une fois" },
        { libelle: "Deny", numero: 2, selectionne: false },
      ],
      contexte: ["Field 1/1"],
      invite: "Allow Computer Use?",
      texte: "Allows access",
    };
    parite("Question", [
      question,
      { ...question, contexte: [] },
      // Refus : `numero` manquant dans un choix.
      { ...question, choix: [{ libelle: "x", selectionne: false }] },
    ]);
  });

  test("ConversationsResponse : liste de résumés", () => {
    const ligne = {
      paneId: "w1:p1",
      tabId: "w1:t1",
      workspaceId: "w1",
      agent: "claude",
      name: null,
      title: "atelier",
      status: "blocked",
      sessionState: "available",
      tabPaneCount: 1,
    };
    parite("ConversationsResponse", [
      { conversations: [ligne] },
      { conversations: [] },
      // Refus : statut hors union.
      { conversations: [{ ...ligne, status: "en_cours" }] },
    ]);
  });

  test("ModelCatalogResponse : error nullable obligatoire", () => {
    parite("ModelCatalogResponse", [
      {
        error: null,
        kind: "pi",
        models: [{ id: "anthropic/claude", label: "Claude", thinkingLevels: ["low"] }],
        thinkingLevels: ["low"],
        source: "pi --list-models",
      },
      { error: "aucun mécanisme", kind: "cursor", models: [], thinkingLevels: [], source: "" },
      // Refus : `error` absent (nullable OBLIGATOIRE).
      { kind: "cursor", models: [], thinkingLevels: [], source: "" },
    ]);
  });

  test("TrustResolvedResponse : l'état est obligatoire (C03)", () => {
    parite("TrustResolvedResponse", [
      { accepted: true, state: "acceptee", status: "trust-resolved" },
      { accepted: false, state: "non-applicable", status: "trust-resolved" },
      // Refus : l'état manquait dans le défaut d'origine (C03).
      { accepted: true, status: "trust-resolved" },
      // Refus : état hors union.
      { accepted: true, state: "accordee", status: "trust-resolved" },
    ]);
  });
});

describe("événements du flux — la façade générée couvre le contrat", () => {
  test("session_changed est décodé (événement AJOUTÉ, C26)", () => {
    // TECH §7 : la charge porte un `paneId` et une révision OPAQUE — aucun
    // chemin, aucun texte.
    const present = decode(genere.SessionChanged, {
      paneId: "w1:p1",
      sourceRevision: "0123456789abcdef",
    });
    expect(present).toEqual({ paneId: "w1:p1", sourceRevision: "0123456789abcdef" });
    // Refus : révision manquante (c'est le cœur de la charge).
    expect(decode(genere.SessionChanged, { paneId: "w1:p1" })).toBeUndefined();
    // Refus : un CHEMIN à la place de la révision — le contrat n'en veut pas.
    expect(decode(genere.SessionChanged, { paneId: "w1:p1", path: "/s.jsonl" })).toBeUndefined();
  });

  test("l'enveloppe SSE accepte les six genres", () => {
    const enveloppes = [
      { event: "ready", data: { cursor: 3 } },
      {
        event: "agent_status",
        data: { from: null, kind: "appeared", paneId: "w1:p1", to: "working" },
      },
      {
        event: "prompt",
        data: {
          paneId: "w1:p1",
          confirmation: "confirmed",
          fingerprint: "abc",
          status: "sent",
        },
      },
      {
        event: "prompt-suppressed",
        data: { paneId: "w1:p1", reason: "consecutive identical send" },
      },
      { event: "agent-launched", data: { kind: "pi", paneId: "w1:p4", workspaceId: "w1" } },
      {
        event: "session_changed",
        data: { paneId: "w1:p1", sourceRevision: "0123456789abcdef" },
      },
      { event: "resync", data: { reason: "truncated journal", resumeFrom: 12 } },
    ];
    for (const enveloppe of enveloppes) {
      expect(decode(genere.EvenementSse, enveloppe), `enveloppe ${enveloppe.event}`).toBeDefined();
    }
    // Refus : un genre inconnu n'est pas un succès silencieux.
    expect(decode(genere.EvenementSse, { event: "inconnu", data: {} })).toBeUndefined();
  });

  test("la façade TS écrite à la main porte les mêmes ajouts", () => {
    // `caughtUp` et `session_changed` existent des deux côtés : c'est ce que
    // le basculement va brancher (T057b).
    expect(
      decode(manuel.SessionResponse, {
        cause: "vide",
        entries: [],
        incremental: false,
        hasMore: false,
        reset: false,
        sessionPath: "/s.jsonl",
        caughtUp: true,
      }),
    ).toBeDefined();
    expect(
      decode(manuel.SessionChanged, { paneId: "w1:p1", sourceRevision: "0123456789abcdef" }),
    ).toEqual({ paneId: "w1:p1", sourceRevision: "0123456789abcdef" });
  });
});

/**
 * La couverture du basculement : **quels** DTO de `api.ts` existent déjà dans
 * la façade générée, et lesquels restent.
 *
 * ⚠️ Cette liste est un **inventaire**, pas une permission : chaque nom
 * restant est soit un renommage (`RENOMMAGES`), soit un type qui n'appartient
 * PAS au contrat HTTP (charge amont Herdr, structure de disposition, curseur
 * client). Le test échoue si un nom « contrat » disparaît du bundle — c'est le
 * seul moyen d'empêcher la duplication de revenir en silence (C01).
 */
describe("façade générée — couverture du basculement (T057b)", () => {
  /** Les noms de `api.ts` qui ne sont pas des DTO de notre contrat HTTP. */
  const HORS_CONTRAT = new Set([
    // Structures de la disposition Herdr (charge amont, pas notre API).
    "PaneLayout",
    "PaneLayoutPane",
    "PaneLayoutRect",
    "SnapshotPane",
    "SnapshotPayload",
    "TabInfo",
    // Curseurs : codec client (`hc2:`…), la forme interne appartient à `sessions`.
    "SessionCursor",
    "encodeCursor",
    "decodeCursor",
  ]);

  /** Les schémas de `api.ts` qui sont des DTO de notre API. */
  const dtoDeLApi = (): string[] =>
    Object.keys(manuel).filter(
      (nom) => !HORS_CONTRAT.has(nom) && estSchema((manuel as Record<string, unknown>)[nom]),
    );

  test("chaque DTO du client existe dans la façade générée (sous son nom ou son alias)", () => {
    const manquants = dtoDeLApi().filter((nom) => {
      const nomGenere =
        Object.entries(RENOMMAGES).find(([, manuel_]) => manuel_ === nom)?.[0] ?? nom;
      return schemaDe(genere, nomGenere) === undefined;
    });
    expect(manquants).toEqual([]);
  });

  test("aucun renommage n'est oublié : chaque alias pointe une définition réelle", () => {
    for (const [nomGenere, nomManuel] of Object.entries(RENOMMAGES)) {
      // La définition existe des deux côtés — un alias mort serait une dette
      // invisible.
      expect(estSchema((genere as Record<string, unknown>)[nomGenere])).toBe(true);
      expect(estSchema((manuel as Record<string, unknown>)[nomManuel])).toBe(true);
    }
  });
});
