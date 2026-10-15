/**
 * Une notification doit dire **qui**.
 *
 * ⚠️ **Le défaut, mesuré, est un doublon.** `wA` (projet `pixel`) porte deux
 * agents `pi`. Jusqu'ici la notification ne portait que le titre du pane —
 * identique pour les deux — donc deux notifications rigoureusement identiques,
 * et aucun moyen de savoir lequel avait fini. Aller voir le bon relevait du
 * hasard : c'est le seul cas où la notification échoue complètement, et c'est
 * le cas normal dès qu'on travaille sur deux sujets dans le même projet.
 *
 * ⚠️ **La liste ci-dessous n'est pas inventée** : elle vient de
 * `/api/overview` sur Herdr 0.9.3, le 2026-10-15. Elle porte ce que la mesure a
 * appris et qu'aucune relecture du schéma n'aurait donné :
 *
 * - `tabLabel` est **`null` sur 3 des 7 agents** — un nom qui ne reposerait que
 *   sur le libellé serait vide une fois sur deux ;
 * - `tabNumber` est **renseigné sur les 7** — c'est le seul identifiant
 *   d'onglet toujours disponible ;
 * - `tabLabel` peut **répéter le projet** (`atcrea` dans `atcrea`) ;
 * - `tabLabel` porte parfois le titre du terminal (`The chosen one`), et c'est
 *   très bien : c'est ce que Herdr affiche dans sa barre d'onglets, donc c'est
 *   reconnaissable pour l'utilisateur.
 */
import { describe, expect, test } from "bun:test";
import { nomDeNotification, payloadDeNotification } from "./PushNotifications.ts";
import type { IdentiteNotification } from "./PushNotifications.ts";

/** Relevé le 2026-10-15 sur Herdr 0.9.3, via `/api/overview`. */
const MESURES: ReadonlyArray<readonly [string, IdentiteNotification, string]> = [
  [
    "w2:p1",
    {
      agent: "pi",
      tabLabel: null,
      tabNumber: 1,
      title: "π - devcli-private",
      workspaceLabel: "devcli pi",
    },
    "π - devcli-private · tab 1 · pi",
  ],
  [
    "w7:p2",
    {
      agent: "pi",
      tabLabel: "atcrea",
      tabNumber: 2,
      title: "π - atcrea",
      workspaceLabel: "atcrea",
    },
    "π - atcrea · tab 2 · pi",
  ],
  [
    "w9:p1",
    {
      agent: "pi",
      tabLabel: null,
      tabNumber: 1,
      title: "π - prusa-pi-setup",
      workspaceLabel: "prusa-pi-setup",
    },
    "π - prusa-pi-setup · tab 1 · pi",
  ],
  [
    "wA:p1",
    {
      agent: "pi",
      tabLabel: "The chosen one",
      tabNumber: 1,
      title: "π - pixel",
      workspaceLabel: "pixel",
    },
    "π - pixel · The chosen one · pi",
  ],
  [
    "wA:p7",
    {
      agent: "pi",
      tabLabel: "Eternal second",
      tabNumber: 4,
      title: "π - pixel",
      workspaceLabel: "pixel",
    },
    "π - pixel · Eternal second · pi",
  ],
  [
    "wB:p1",
    {
      agent: "pi",
      tabLabel: "The chosen one",
      tabNumber: 1,
      title: "π - herdr-pwa",
      workspaceLabel: "herdr-pwa",
    },
    "π - herdr-pwa · The chosen one · pi",
  ],
  [
    "wC:p1",
    {
      agent: "pi",
      tabLabel: null,
      tabNumber: 1,
      title: "π - lgc-back-end",
      workspaceLabel: "lgc-back-end",
    },
    "π - lgc-back-end · tab 1 · pi",
  ],
];

const vide = (): IdentiteNotification => ({
  agent: null,
  tabLabel: null,
  tabNumber: null,
  title: null,
  workspaceLabel: null,
});

describe("le nom de la notification dit de quel onglet il s'agit", () => {
  test("les sept agents réels donnent sept noms distincts", () => {
    // C'est LA propriété qui compte : si deux agents d'un même projet nomment
    // pareil, la notification ne sert à rien.
    expect(new Set(MESURES.map(([, agent]) => nomDeNotification(agent))).size).toBe(MESURES.length);
  });

  test.each(MESURES.map(([paneId, agent, attendu]) => [paneId, agent, attendu] as const))(
    "%s",
    (_paneId, agent, attendu) => {
      expect(nomDeNotification(agent)).toBe(attendu);
    },
  );

  test("les deux agents de `pixel` se distinguent", () => {
    // Le cas d'origine, reproduit tel quel.
    const premier = MESURES.find(([paneId]) => paneId === "wA:p1");
    const second = MESURES.find(([paneId]) => paneId === "wA:p7");
    if (premier === undefined || second === undefined) throw new Error("mesure absente");

    expect(nomDeNotification(premier[1])).not.toBe(nomDeNotification(second[1]));
  });

  test("le titre du pane passe avant le libellé du projet", () => {
    // Le titre est ce que l'utilisateur a sous les yeux dans Herdr.
    expect(nomDeNotification({ ...vide(), title: "π - pixel", workspaceLabel: "pixel" })).toBe(
      "π - pixel",
    );
  });

  test("sans titre, le libellé du projet prend le relais", () => {
    expect(nomDeNotification({ ...vide(), workspaceLabel: "pixel" })).toBe("pixel");
  });
});

describe("le numéro d'onglet est le filet, jamais une invention", () => {
  test("un libellé purement numérique devient `tab N`", () => {
    // Herdr nomme ses onglets « 1 », « 2 »… : ce libellé n'apprend rien, le
    // numéro est en revanche exact.
    expect(nomDeNotification({ ...vide(), tabLabel: "3", tabNumber: 3 })).toBe("tab 3");
  });

  test("un libellé qui répète le projet cède la place au numéro", () => {
    // Herdr donne `atcrea` comme libellé d'onglet dans le projet `atcrea` :
    // répéter n'apprend rien, et le numéro, lui, distingue les onglets.
    expect(
      nomDeNotification({ ...vide(), tabLabel: "atcrea", tabNumber: 2, title: "π - atcrea" }),
    ).toBe("π - atcrea · tab 2");
  });

  test("sans numéro connu, le libellé reste, même numérique", () => {
    // Le libellé est exact, sinon : on ne le remplace pas par rien.
    expect(nomDeNotification({ ...vide(), tabLabel: "7", tabNumber: null })).toBe("7");
  });

  test("les espaces autour d'un libellé ne comptent pas", () => {
    expect(nomDeNotification({ ...vide(), tabLabel: "  atcrea  ", tabNumber: 2 })).toBe("atcrea");
    expect(nomDeNotification({ ...vide(), title: " π - pixel " })).toBe("π - pixel");
  });
});

describe("rien n'est inventé quand rien n'est connu", () => {
  test("un agent vide donne une chaîne vide, pas un nom de remplacement", () => {
    expect(nomDeNotification(vide())).toBe("");
  });

  test("un agent absent donne aussi une chaîne vide", () => {
    expect(nomDeNotification(undefined)).toBe("");
  });

  test("un libellé fait d'espaces est traité comme absent", () => {
    expect(nomDeNotification({ ...vide(), tabLabel: "   ", title: "   " })).toBe("");
  });

  test("et la phrase reste alors générique, jamais trouée", () => {
    // Le payload reçoit la chaîne vide : il ne doit pas produire « a fini ».
    const payload = payloadDeNotification(nomDeNotification(undefined), "wA:p1", "idle");

    expect(payload.body).toBe("Your agent has finished working.");
    expect(payload.body).not.toContain("  ");
  });
});

describe("le nom arrive bien dans la notification", () => {
  test("le corps nomme l'onglet, et le clic mène au bon agent", () => {
    const agent = MESURES.find(([paneId]) => paneId === "wA:p7")?.[1];
    if (agent === undefined) throw new Error("mesure absente");

    const payload = payloadDeNotification(nomDeNotification(agent), "wA:p7", "idle");

    expect(payload.body).toBe("π - pixel · Eternal second · pi has finished working.");
    expect(payload.url).toBe("/#/agent/wA%3Ap7");
  });

  test("un agent bloqué demande une réponse, il n'a pas « fini »", () => {
    const agent = MESURES.find(([paneId]) => paneId === "wA:p7")?.[1];
    if (agent === undefined) throw new Error("mesure absente");

    const payload = payloadDeNotification(nomDeNotification(agent), "wA:p7", "blocked");

    expect(payload.body).toContain("is waiting for your answer");
    expect(payload.title).toBe("Agent needs you");
  });
});
