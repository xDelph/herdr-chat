/**
 * C24 — le focus desktop est un **geste**, jamais un effet de bord (T062).
 *
 * ⚠️ **Le défaut mesuré.** `ChatScreen` POSTait `/api/agents/:id/focus` dans un
 * `useEffect` déclenché par l'ouverture **et** par chaque changement de statut.
 * Ouvrir une conversation pour la lire volait donc le clavier de l'utilisateur
 * sur le Mac, et l'acquittement d'une réponse dépendait de la navigation.
 *
 * ⚠️ **Deux niveaux de preuve, et leur limite dite.**
 * 1. Le bouton existe dans le rendu (`renderToStaticMarkup`) : on peut vérifier
 *    qu'un geste est proposé.
 * 2. Une **garde anti-régression** lit la source : `focusAgent(` n'apparaît
 *    qu'une fois, dans `focusDesktop`, et aucun `useEffect` ne l'appelle. Ce
 *    n'est pas une preuve de comportement — c'est ce qui empêche l'ancien
 *    défaut de revenir sans qu'aucun test ne le voie.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentView } from "@herdr-remote/shared";
import { ChatScreen } from "../src/ChatScreen.tsx";

const agent: AgentView = {
  paneId: "w1:p1",
  tabId: "w1:t1",
  workspaceId: "w1",
  agent: "claude",
  cwd: "/projets/atelier",
  focused: false,
  name: null,
  parentSession: null,
  paneRank: 0,
  sessionCwd: null,
  sessionCwdMatches: null,
  sessionId: null,
  sessionKind: null,
  sessionPath: null,
  status: "working",
  tabLabel: "1",
  tabNumber: 1,
  tabPaneCount: 1,
  title: "atelier",
  workspaceLabel: "projet",
};

const rendu = (): string =>
  renderToStaticMarkup(
    createElement(ChatScreen, {
      agent,
      currentModel: undefined,
      currentProvider: undefined,
      currentThinking: undefined,
      onBack: () => {},
      onOuvrirVoisin: () => {},
      question: undefined,
      trust: undefined,
      voisins: [],
      waiting: undefined,
    }),
  );

describe("C24 — le geste existe dans l'en-tête", () => {
  test("un bouton nommé propose de focaliser le pane sur le Mac", () => {
    const html = rendu();
    // `aria-label` : le bouton est une icône, donc son nom accessible est le
    // seul texte — c'est lui qui doit exister.
    expect(html).toContain('aria-label="Focus this pane on the Mac"');
  });
});

describe("C24 — la garde anti-régression : pas de focus automatique", () => {
  const source = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

  test("`focusAgent` n'est appelé QUE par le bouton et par l'acquittement", () => {
    /*
      ⚠️ **Décision produit du 2026-10-20.** L'acquittement automatique sur
      interaction (défiler, écrire) a été demandé explicitement : une réponse
      `done` devient lue quand on agit, sans bouton. Deux appels sont donc
      légitimes — le geste explicite (`focusDesktop`) et l'acquittement — et
      aucun autre.
    */
    const appels = source.match(/focusAgent\(/g) ?? [];
    expect(appels).toHaveLength(2);
  });

  test("l'acquittement passe par la règle, jamais par le seul affichage", () => {
    // ⚠️ C'est ce qui empêche le retour du défaut d'origine : un focus envoyé
    // à l'ouverture ou à chaque changement de statut.
    expect(source).toContain("doitAcquitter({");
    expect(source).toContain("statut: statutRef.current");
  });

  test("l'appel vit dans `focusDesktop`, pas dans un effet", () => {
    const debut = source.indexOf("const focusDesktop = useCallback");
    expect(debut).toBeGreaterThan(-1);
    const appel = source.indexOf("focusAgent(");
    expect(appel).toBeGreaterThan(debut);
    // Aucun `useEffect` ne mentionne le focus : c'est exactement le défaut
    // d'origine (un effet qui POSTait à l'ouverture et au changement de statut).
    for (const bloc of source.split("useEffect(").slice(1)) {
      const corps = bloc.slice(0, bloc.indexOf("}, [") === -1 ? 400 : bloc.indexOf("}, ["));
      expect(corps).not.toContain("focusAgent");
    }
  });

  test("aucun `agent.status` ne déclenche de focus", () => {
    // La dépendance exacte de l'ancien effet : `[agent.paneId, agent.status]`
    // sur un effet qui appelait `focusAgent`. On vérifie qu'aucun effet ne
    // porte plus cette paire.
    const motifs = source.match(/useEffect\([^)]*,\s*\[agent\.paneId,\s*agent\.status\]/g) ?? [];
    expect(motifs).toHaveLength(0);
  });
});
