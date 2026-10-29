/**
 * Les messages du harnais et les tâches de fond, côté PWA — sans réseau, sans
 * agent : des lignes de session normalisées (la forme que le démon sert) et des
 * réponses factices.
 *
 * Ce qui est vérifié :
 *
 * - un rapport de sous-agent n'est JAMAIS une bulle de demande ;
 * - une demande envoyée pendant le travail reste une demande, marquée, et ne
 *   relance pas le chronomètre ;
 * - un agent au repos qui attend ses tâches rejoint « En cours » ;
 * - `inconnu` n'est jamais compté ni affiché « en cours ».
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundTask, ConversationSummary } from "@herdr-remote/shared";
import { toItems, toMessages } from "../src/blocks.ts";
import { CarteRapport, InfosTaches } from "../src/chat/CarteRapport.tsx";
import { ElementFil } from "../src/chat/Elements.tsx";
import { PuceTaches } from "../src/chat/PuceTaches.tsx";
import { LigneAgent } from "../src/inbox/LigneAgent.tsx";
import { sectionDe, sectionConversations } from "../src/sections.ts";
import {
  attenteDeTaches,
  dureesDe,
  infosDesTaches,
  nombreDeTaches,
  resumeUtile,
  statutDuHarnais,
  titreDuRapport,
  type RapportDeTache,
} from "../src/taches.ts";
import { tourEnCours } from "../src/transcript.ts";

/** La valeur, ou l'échec nommé du test — jamais une assertion silencieuse. */
const seul = <T>(valeur: T | undefined): T => {
  if (valeur === undefined) throw new Error("valeur attendue");
  return valeur;
};

const rendu = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element).replaceAll("&#x27;", "'").replaceAll("&quot;", '"');

const ligne = (
  id: string,
  message: Record<string, unknown>,
  timestamp = "2026-10-29T10:00:00.000Z",
) => ({
  id,
  raw: JSON.stringify({ id, message, timestamp, type: "message" }),
  timestamp,
  type: "message",
});

const demande = (id: string, texte: string, timestamp: string, pendant = false) =>
  ligne(
    id,
    {
      content: [{ text: texte, type: "text" }],
      role: "user",
      ...(pendant ? { details: { midTurn: true } } : {}),
    },
    timestamp,
  );

const rapport = (id: string, corps: string, timestamp: string, pendant = false) =>
  ligne(
    id,
    {
      content: [{ text: corps, type: "text" }],
      customType: "subagent-report",
      details: { handback: true, taskId: "a1", ...(pendant ? { midTurn: true } : {}) },
      role: "custom",
    },
    timestamp,
  );

const notification = (id: string, timestamp: string, pendant = false) =>
  ligne(
    id,
    {
      content: [{ text: 'Agent "Audit du flux" finished', type: "text" }],
      customType: "task-notification",
      details: {
        description: "Audit du flux",
        kind: "agent",
        status: "completed",
        summary: 'Agent "Audit du flux" finished',
        taskId: "a1",
        usage: { durationMs: 325_661 },
        ...(pendant ? { midTurn: true } : {}),
      },
      role: "custom",
    },
    timestamp,
  );

const reponse = (id: string, texte: string, timestamp: string) =>
  ligne(id, { content: [{ text: texte, type: "text" }], role: "assistant" }, timestamp);

describe("le harnais n'est pas l'utilisateur", () => {
  test("un rapport de sous-agent devient une carte, pas une demande", () => {
    const messages = toMessages([
      demande("u1", "lance l'audit", "2026-10-29T10:00:00.000Z"),
      rapport("r1", "## Diagnostic\n\n- point", "2026-10-29T10:05:00.000Z"),
    ]);
    expect(messages.map((message) => message.role)).toEqual(["user", "custom"]);
    const bloc = messages[1]?.blocks[0];
    expect(bloc?.kind).toBe("rapportTache");
    const items = toItems(messages);
    // La carte est un élément à part — jamais rangée dans un groupe d'outils.
    expect(items.map((item) => item.kind)).toEqual(["single", "single"]);
    const html = rendu(
      createElement(ElementFil, {
        cwd: null,
        enCours: false,
        item: seul(items[1]),
        maintenant: Date.parse("2026-10-29T12:00:00.000Z"),
        onOuvrirFichier: () => undefined,
      }),
    );
    expect(html).toContain("Rapport de sous-agent");
    expect(html).not.toContain('data-demande=""');
    expect(html).toContain(">Diagnostic</h3>");
  });

  test("la carte se titre avec la description et l'état connus", () => {
    const messages = toMessages([
      rapport("r1", "court", "2026-10-29T10:05:00.000Z"),
      notification("n1", "2026-10-29T10:05:01.000Z", true),
    ]);
    const rapports = messages.flatMap((message) =>
      message.blocks.filter((block): block is RapportDeTache => block.kind === "rapportTache"),
    );
    const infos = infosDesTaches(rapports, []);
    const html = rendu(
      createElement(
        InfosTaches.Provider,
        { value: infos },
        createElement(CarteRapport, { message: seul(messages[0]) }),
        createElement(CarteRapport, { message: seul(messages[1]) }),
      ),
    );
    expect(html).toContain("Rapport de sous-agent · Audit du flux · terminée");
    // La fin de tâche renvoie au rapport déjà présent : une ligne, sans corps.
    expect(html).toContain("Tâche de fond · Audit du flux · terminée");
    expect(html).toContain("pendant le travail");
    expect(html).toContain("5 min");
  });

  test("un rapport long est replié, avec « Tout lire »", () => {
    const [message] = toMessages([rapport("r1", "x".repeat(900), "2026-10-29T10:05:00.000Z")]);
    const html = rendu(createElement(CarteRapport, { message: seul(message) }));
    expect(html).toContain("rapport__corps--replie");
    expect(html).toContain("Tout lire");
  });
});

describe("le tour part de la demande qui l'a ouvert", () => {
  test("une demande envoyée pendant le travail ne relance pas le chronomètre", () => {
    const messages = toMessages([
      demande("u1", "corrige le bug", "2026-10-29T10:00:00.000Z"),
      reponse("a1", "je regarde", "2026-10-29T10:00:05.000Z"),
      demande("u2", "et le test aussi", "2026-10-29T10:03:00.000Z", true),
      rapport("r1", "rapport", "2026-10-29T10:04:00.000Z", true),
    ]);
    expect(tourEnCours(messages).debutMs).toBe(Date.parse("2026-10-29T10:00:00.000Z"));
    // Elle reste une demande, marquée « envoyé pendant le travail ».
    expect(messages[2]?.role).toBe("user");
    expect(messages[2]?.meta["pendantTour"]).toBe("1");
    const items = toItems(messages);
    const bulle = items.find((item) => item.kind === "single" && item.message.id === "u2");
    const html = rendu(
      createElement(ElementFil, {
        cwd: null,
        enCours: true,
        item: seul(bulle),
        maintenant: Date.parse("2026-10-29T12:00:00.000Z"),
        onOuvrirFichier: () => undefined,
      }),
    );
    expect(html).toContain("envoyé pendant le travail");
  });

  test("une fin de tâche n'ouvre jamais de tour : c'est la suite du même travail", () => {
    // Retour du 2026-10-29 : le chronomètre repartait à chaque notification.
    const messages = toMessages([
      demande("u1", "lance", "2026-10-29T10:00:00.000Z"),
      reponse("a1", "lancé", "2026-10-29T10:00:05.000Z"),
      notification("n1", "2026-10-29T11:00:00.000Z"),
    ]);
    expect(tourEnCours(messages).debutMs).toBe(Date.parse("2026-10-29T10:00:00.000Z"));
  });
});

const conversation = (
  paneId: string,
  extra: Partial<ConversationSummary> = {},
): ConversationSummary => ({
  agent: "claude",
  name: null,
  paneId,
  paneRank: null,
  sessionState: "available",
  status: "idle",
  tabId: "t1",
  tabPaneCount: 1,
  title: paneId,
  workspaceId: "w1",
  ...extra,
});

describe("la liste suit les tâches de fond et la session", () => {
  test("au repos avec des tâches en cours : « En cours », jamais pour `inconnu`", () => {
    const attend = conversation("p1", { tachesDeFond: { enCours: 2, total: 3 } });
    const finies = conversation("p2", { tachesDeFond: { enCours: 0, total: 3 } });
    const bloque = conversation("p3", {
      status: "blocked",
      tachesDeFond: { enCours: 1, total: 1 },
    });
    expect(sectionDe(attend)).toBe("en-cours");
    expect(sectionDe(finies)).toBe("recents");
    expect(sectionDe(bloque)).toBe("a-traiter");
    const groupes = sectionConversations([attend, finies, bloque]);
    expect(groupes.map((groupe) => groupe.cle)).toEqual(["a-traiter", "en-cours", "recents"]);
    expect(attenteDeTaches(attend.tachesDeFond)).toBe("Attend 2 tâches de fond");
    expect(attenteDeTaches(finies.tachesDeFond)).toBeNull();
    expect(nombreDeTaches(1)).toBe("1 tâche de fond");
  });

  test("la ligne affiche l'attente, et le chronomètre part de la session", () => {
    const attend = rendu(
      createElement(LigneAgent, {
        conversation: conversation("p1", { tachesDeFond: { enCours: 2, total: 2 } }),
        courante: false,
        debutTravail: undefined,
        maintenant: 0,
        nonLue: false,
        projet: "atelier",
        titre: "",
      }),
    );
    expect(attend).toContain("Attend 2 tâches de fond");
    const travaille = rendu(
      createElement(LigneAgent, {
        conversation: conversation("p1", { status: "working", tourDebut: 1_000 }),
        courante: false,
        // L'instant observé, plus récent, ne l'emporte pas sur la session.
        debutTravail: 50_000,
        maintenant: 61_000,
        nonLue: false,
        projet: "atelier",
        titre: "",
      }),
    );
    expect(travaille).toContain("1:00");
  });

  test("la puce de l'en-tête dit ce qui tourne", () => {
    expect(rendu(createElement(PuceTaches, { compte: undefined, onOuvrir: () => undefined }))).toBe(
      "",
    );
    const html = rendu(
      createElement(PuceTaches, { compte: { enCours: 2, total: 5 }, onOuvrir: () => undefined }),
    );
    expect(html).toContain("2 tâches de fond");
    expect(html).toContain("spin");
  });
});

describe("les libellés des tâches", () => {
  const tache: BackgroundTask = {
    description: "Audit",
    id: "a1",
    kind: "agent",
    lastActivity: Date.parse("2026-10-29T10:10:00.000Z"),
    startedAt: Date.parse("2026-10-29T10:00:00.000Z"),
    status: "inconnu",
    transcript: true,
  };

  test("le statut du harnais se traduit sans rien supposer", () => {
    expect(statutDuHarnais("completed")).toBe("terminee");
    expect(statutDuHarnais("failed")).toBe("echouee");
    expect(statutDuHarnais("killed")).toBe("arretee");
    expect(statutDuHarnais("bizarre")).toBe("inconnu");
    expect(statutDuHarnais(null)).toBeNull();
  });

  test("les durées ne se calculent qu'avec leurs bornes", () => {
    const maintenant = Date.parse("2026-10-29T11:00:00.000Z");
    // Inconnu : pas de « depuis » (ce serait affirmer qu'elle tourne).
    expect(dureesDe(tache, maintenant).join(" · ")).toBe("lancée 1 h · activité 50 min");
    expect(
      dureesDe(
        { ...tache, endedAt: Date.parse("2026-10-29T10:07:00.000Z"), status: "terminee" },
        maintenant,
      ),
    ).toEqual(["durée 7 min"]);
    expect(dureesDe({ ...tache, status: "en_cours" }, maintenant)[0]).toBe("depuis 1:00:00");
  });

  test("un résumé qui répète le titre n'est pas montré", () => {
    const finie = { ...tache, status: "terminee" as const };
    expect(resumeUtile({ ...finie, summary: 'Agent "Audit" finished' })).toBeNull();
    expect(
      resumeUtile({ ...finie, summary: 'Background command "x" failed with exit code 1' }),
    ).toBe('Background command "x" failed with exit code 1');
  });

  test("la liste du démon précise ce que le fil savait", () => {
    const infos = infosDesTaches([], [{ ...tache, status: "en_cours" }]);
    expect(infos.get("a1")?.status).toBe("en_cours");
    const [message] = toMessages([rapport("r1", "x", "2026-10-29T10:05:00.000Z")]);
    const bloc = message?.blocks[0];
    if (bloc?.kind !== "rapportTache") throw new Error("bloc attendu");
    expect(titreDuRapport(bloc, infos.get("a1"))).toEqual([
      "Rapport de sous-agent",
      "Audit",
      "en cours",
    ]);
  });
});
