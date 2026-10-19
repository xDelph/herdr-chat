/**
 * Le mot d'état d'une ligne de conversation (C22).
 *
 * ⚠️ **Deux mensonges mesurés, chacun avec sa conséquence :**
 *
 * - `blocked` affichait « working » : l'utilisateur croyait l'agent au travail
 *   alors qu'il attendait une réponse — donc il n'allait pas la donner ;
 * - `idle` affichait « finished il y a 3 min » : une **fin** inventée, calculée
 *   sur l'horloge de l'écran et sur un horodatage de session qui ne dit rien
 *   d'une fin de travail.
 *
 * Le test vérifie donc deux choses distinctes : le mot de chaque état (une
 * table), et **ce qui n'est pas affiché** (`idle` ne dit jamais « finished »).
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentStatus, ConversationSummary } from "@herdr-remote/shared";
import { ConversationRow } from "../src/ConversationRow.tsx";
import { motDEtat } from "../src/mot-etat.ts";
import { STATUS_LABEL } from "../src/labels.tsx";

/** Une ligne minimale — tout ce qui n'est pas le sujet est absent. */
const ligne = (status: AgentStatus, timestamp?: number): ConversationSummary => {
  const base: ConversationSummary = {
    paneId: "w1:p1",
    tabId: "w1:t1",
    workspaceId: "w1",
    agent: "claude",
    name: null,
    title: "atelier",
    status,
    sessionState: "available",
    tabPaneCount: 1,
  };
  // Un horodatage est omissible : absent, il reste ABSENT (jamais `null`).
  return timestamp === undefined ? base : { ...base, timestamp };
};

const MAINTENANT = 1_700_000_000_000;

describe("les cinq états ont CHACUN leur mot", () => {
  test("blocked dit qu'il attend, jamais qu'il travaille", () => {
    expect(motDEtat(ligne("blocked"), MAINTENANT)).toBe("waiting for input");
    expect(motDEtat(ligne("blocked"), MAINTENANT)).not.toBe("working");
  });

  test("working dit qu'il travaille", () => {
    expect(motDEtat(ligne("working"), MAINTENANT)).toBe("working");
  });

  test("idle reste idle — aucune fin inventée", () => {
    // ⚠️ Le défaut d'origine : `idle` + horodatage donnait « finished 3m ».
    const mot = motDEtat(ligne("idle", MAINTENANT - 180_000), MAINTENANT);
    expect(mot).toBe("idle");
    expect(mot).not.toContain("finished");
  });

  test("done dit la fin, et quand la session le sait", () => {
    expect(motDEtat(ligne("done", MAINTENANT - 180_000), MAINTENANT)).toBe("finished 3 min ago");
    // Sans horodatage : le mot seul, aucune durée devinée.
    expect(motDEtat(ligne("done"), MAINTENANT)).toBe("finished");
  });

  test("unknown le dit sans accuser l'agent", () => {
    expect(motDEtat(ligne("unknown"), MAINTENANT)).toBe("unknown status");
  });

  test("chaque état du contrat a un mot (aucun oubli possible)", () => {
    const etats: AgentStatus[] = ["working", "blocked", "idle", "done", "unknown"];
    for (const etat of etats) {
      expect(motDEtat(ligne(etat), MAINTENANT)).toBe(STATUS_LABEL[etat]);
    }
  });
});

/** La ligne RÉELLEMENT rendue en HTML (pas seulement la fonction). */
const rendu = (status: AgentStatus, timestamp?: number): string =>
  renderToStaticMarkup(
    createElement(ConversationRow, {
      conversation: ligne(status, timestamp),
      projet: "atelier",
      onglet: "1",
      maintenant: MAINTENANT,
      onOpen: () => {},
    }),
  );

describe("la ligne RENDUE — pas seulement la fonction", () => {
  test("un agent bloqué affiche « waiting for input » dans la liste", () => {
    const html = rendu("blocked");
    expect(html).toContain("waiting for input");
    expect(html).not.toContain(">working<");
  });

  test("un agent au repos n'affiche aucune heure de fin", () => {
    const html = rendu("idle", MAINTENANT - 180_000);
    expect(html).toContain(">idle<");
    expect(html).not.toContain("finished");
  });
});
