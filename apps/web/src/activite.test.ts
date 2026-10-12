/**
 * Le journal d'activité, exécuté (A02).
 *
 * Ces fonctions n'étaient testées nulle part : leur comportement était garanti
 * par la relecture. Il y a une règle qu'on ne relit pas — **aucun identifiant
 * de pane à l'écran** — et c'est celle-ci qui est testée sur chaque branche.
 */
import { describe, expect, test } from "bun:test";
import type { AgentView } from "./api.ts";
import { describeEvent, nameByPane } from "./activite.ts";

/**
 * Un agent complet.
 *
 * ⚠️ Tous les champs, sans transformation de type : une moitié de structure
 * ferait passer le test pour une garantie alors qu'il n'aurait rien vérifié.
 * Le type est la seule preuve qu'un champ n'a pas été oublié ici.
 */
const agent = (surcharge: Partial<AgentView> = {}): AgentView => ({
  agent: "pi",
  cwd: "/dev/projets/pixel",
  focused: false,
  paneId: "w1:p1",
  parentSession: null,
  sessionCwd: "/dev/projets/pixel",
  sessionCwdMatches: true,
  sessionId: null,
  sessionKind: null,
  sessionPath: null,
  status: "idle",
  tabLabel: null,
  tabId: "t1",
  tabNumber: 1,
  title: "relecture du contrat",
  workspaceId: "w1",
  workspaceLabel: null,
  ...surcharge,
});

const noms = nameByPane([agent(), agent({ paneId: "w1:p2", workspaceLabel: "pixel" })]);

describe("A02 — la table des noms", () => {
  test("un pane connu porte le nom de son projet", () => {
    expect(noms.get("w1:p2")).toBe("pixel");
  });

  test("sans nom de projet, on prend le dossier", () => {
    expect(noms.get("w1:p1")).toBe("pixel");
  });

  test("un pane inconnu n'a pas de nom", () => {
    expect(noms.get("w9:p9")).toBeUndefined();
  });

  test("aucun agent, table vide — jamais une exception", () => {
    expect(nameByPane([]).size).toBe(0);
  });
});

describe("A02 — chaque événement se lit", () => {
  test("apparition et disparition : ce qui s'est passé", () => {
    expect(describeEvent("agent_status", { kind: "appeared", paneId: "w1:p2" }, noms)).toBe(
      "pixel — agent lancé",
    );
    expect(describeEvent("agent_status", { kind: "disappeared", paneId: "w1:p2" }, noms)).toBe(
      "pixel — agent arrêté",
    );
  });

  test("changement d'état : d'où à où", () => {
    expect(
      describeEvent("agent_status", { from: "idle", paneId: "w1:p2", to: "working" }, noms),
    ).toBe("pixel — disponible → en cours");
  });

  test("état manquant : on ne comble pas, on montre l'inconnu", () => {
    expect(describeEvent("agent_status", { paneId: "w1:p2" }, noms)).toContain("inconnu");
  });

  test("envoi, double envoi, lancement", () => {
    expect(describeEvent("prompt", { paneId: "w1:p2" }, noms)).toBe("message envoyé à pixel");
    expect(describeEvent("prompt-suppressed", { paneId: "w1:p2" }, noms)).toBe(
      "double envoi supprimé pour pixel",
    );
    expect(describeEvent("agent-launched", { kind: "pi", paneId: "w1:p2" }, noms)).toBe(
      "pixel — agent lancé (pi)",
    );
  });

  test("resync dit ce qu'il implique", () => {
    expect(describeEvent("resync", {}, noms)).toBe("journal tronqué — rechargement complet");
  });

  test("un événement inconnu garde son nom, sans JSON", () => {
    expect(describeEvent("quelque-chose", { paneId: "w1:p2" }, noms)).toBe("quelque-chose");
  });

  test("une charge utile illisible rend le nom, jamais le brut", () => {
    // `text: 12` ne correspond pas au schéma. Recharger la charge utile
    // afficherait du JSON à l'écran, dont le texte d'un message privé.
    expect(describeEvent("prompt", { paneId: "w1:p2", text: 12 }, noms)).toBe("prompt");
  });
});

describe("A02 — aucun identifiant de pane à l'écran", () => {
  const charges = [
    { kind: "appeared", paneId: "w1:p2" },
    { from: "idle", paneId: "w1:p2", to: "working" },
    { kind: "pi", paneId: "w1:p2" },
    { paneId: "w1:p2" },
    { paneId: "w9:p9" },
  ];

  test("connu comme inconnu, l'identifiant n'apparaît jamais", () => {
    for (const kind of ["agent_status", "prompt", "prompt-suppressed", "agent-launched"]) {
      for (const charge of charges) {
        const rendu = describeEvent(kind, charge, noms);
        expect(rendu).not.toContain("w1:p2");
        expect(rendu).not.toContain("w9:p9");
      }
    }
  });

  test("un pane inconnu devient un libellé neutre, pas une absence", () => {
    // « un agent » et non rien : une ligne vide ferait croire à un bug.
    expect(describeEvent("prompt", { paneId: "w9:p9" }, noms)).toBe("message envoyé à un agent");
  });

  test("sans pane du tout, le libellé neutre reste", () => {
    expect(describeEvent("prompt", {}, noms)).toBe("message envoyé à un agent");
  });
});
