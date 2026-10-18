/**
 * Quand lit-on l'écran d'un agent ?
 *
 * ⚠️ **Cette règle a rendu quatre panes sur cinq inutilisables avant d'être
 * corrigée.** Elle était `status === "blocked"` ; or Herdr déclare **`idle`** un
 * agent qui attend une décision — mesuré sur un onglet à cinq panes, codex
 * affichait « Hooks need review » avec le statut `idle`. Son écran n'était donc
 * jamais lu, aucune carte n'apparaissait, et il n'y avait **aucun moyen d'agir
 * dessus depuis le téléphone**.
 */
import { describe, expect, test } from "bun:test";
import { fautLireLEcran } from "../../src/http/routes-conversations.ts";

describe("U20 — on lit l'écran de qui n'a rien à montrer", () => {
  test("un agent BLOQUÉ : oui", () => {
    // Le seul état où Herdr dit lui-même que quelqu'un attend.
    expect(fautLireLEcran({ lastPrompt: "une demande", status: "blocked" })).toBe(true);
  });

  test("un agent au repos qui n'a RIEN écrit : oui", () => {
    /*
      ⚠️ Le cas mesuré, et tout l'objet de la correction : c'est un agent qui
      vient de démarrer. Il n'a rien écrit — donc rien à montrer — et il peut
      attendre une décision que Herdr ne signale pas.
    */
    expect(fautLireLEcran({ status: "idle" })).toBe(true);
    expect(fautLireLEcran({ status: "unknown" })).toBe(true);
  });

  test("un agent au repos qui a DÉJÀ parlé : non", () => {
    // Le cas ordinaire, et de loin : sur une installation où tous les agents ont
    // parlé, la règle ne coûte **aucune lecture supplémentaire**.
    expect(fautLireLEcran({ lastPrompt: "une demande", status: "idle" })).toBe(false);
    expect(fautLireLEcran({ preview: "une réponse", status: "done" })).toBe(false);
  });

  test("un agent au TRAVAIL : jamais", () => {
    // Il ne peut pas attendre une réponse en même temps, et lire son écran à
    // chaque rafraîchissement serait une dépense sans contrepartie.
    expect(fautLireLEcran({ status: "working" })).toBe(false);
    expect(fautLireLEcran({ lastPrompt: "x", status: "working" })).toBe(false);
  });
});
