/**
 * Le rafraîchissement d'une conversation ne repart jamais de zéro.
 *
 * ⚠️ **Pourquoi ce test existe, et pourquoi il lit la source.** Le défaut qu'il
 * encadre n'était pas dans une fonction : il était dans la **liste de
 * dépendances** d'un `useEffect`. Aucun test unitaire ne pouvait l'attraper, et
 * il ne se voyait qu'à l'usage — l'écran sautait au moment précis où l'on
 * venait de faire quelque chose.
 *
 * Le dépôt encadre déjà par la source ce qui ne se teste pas autrement (la
 * coquille des feuilles, les tokens CSS). Même méthode ici : la règle tient en
 * une ligne, et une relecture ne l'aurait pas retenue deux fois.
 *
 * La règle : `agent.status` choisit la **cadence** du rafraîchissement, jamais
 * son **cycle de vie**. S'il redevient une dépendance de l'effet de chargement,
 * tout changement d'état remet le curseur à zéro, relit la session depuis la
 * fin, et le chargement automatique des pages précédentes **préfixe de vieux
 * messages en haut de la conversation**.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "ChatScreen.tsx"), "utf8");

/** Corps de l'effet qui remet le curseur à zéro, avec sa liste de dépendances. */
const effetDeChargement = (): string => {
  const debut = source.indexOf("cursor.current = null;");
  expect(debut).toBeGreaterThan(-1);
  const fin = source.indexOf("}, [load]);", debut);
  expect(fin).toBeGreaterThan(debut);
  return source.slice(debut, fin + "}, [load]);".length);
};

describe("le chargement d'une session ne dépend pas du statut", () => {
  test("l'effet qui remet le curseur à zéro ne liste pas `agent.status`", () => {
    // C'est LA ligne qui a causé le saut d'écran après un changement de modèle.
    expect(effetDeChargement()).not.toContain("agent.status,");
    expect(effetDeChargement()).not.toContain("agent.status]");
  });

  test("il ne dépend que du chargement lui-même", () => {
    expect(effetDeChargement()).toContain("}, [load]);");
  });

  test("le statut est lu par une référence, pas capturé", () => {
    // Sans cette référence, la cadence ne suivrait plus le statut du tout — on
    // aurait corrigé le saut en cassant la réactivité.
    expect(source).toContain("const statutRef = useRef(agent.status);");
    expect(source).toContain('statutRef.current === "working" ? 750 : 2000');
  });

  test("la cadence est relue à chaque tour, pas figée au montage", () => {
    // `setInterval` figerait la cadence à sa création.
    const effet = effetDeChargement();
    expect(effet).toContain("statutRef.current");
    // L'appel, pas le mot : le commentaire qui explique le choix le nomme.
    expect(effet).not.toContain("setInterval(");
  });

  /**
   * ⚠️ Le préfixage est légitime **une fois**, à l'ouverture : il fait remonter
   * jusqu'à la demande en cours. Il ne doit pas se rejouer à chaque changement
   * d'état, sinon chaque action de l'utilisateur remet de vieux messages en haut.
   */
  test("le chargement automatique des pages précédentes reste à usage unique", () => {
    expect(source).toContain("autoLoadedPrevious.current");
    expect(source).toContain(
      "if (previousCursor === null || autoLoadedPrevious.current) return undefined;",
    );
  });
});
