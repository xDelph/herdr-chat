/**
 * Le défilement suit le bas — dans les deux sens où la géométrie change.
 *
 * ⚠️ **Pourquoi ce test lit la source.** Le défaut qu'il encadre n'est dans
 * aucune fonction : il est dans la **cible d'un `ResizeObserver`**. Aucun test
 * unitaire ne pouvait l'attraper, et il ne se voyait qu'à l'usage, sur un
 * téléphone, en écrivant un message.
 *
 * Mesuré dans le vrai PWA, fenêtre de téléphone, conversation ouverte :
 *
 * ```
 * composeur +200 px  →  clientHeight du scroller : 711 → 535
 *                       bas de la conversation : 176 px SOUS la zone visible
 *                       dernier bloc visible : non
 * ```
 *
 * La cause : l'observateur ne surveillait que le **contenu**. Quand le
 * **conteneur** rétrécit, le contenu ne change pas de taille, aucun événement
 * n'est émis, et le bas de la conversation disparaît sous le composeur. Le
 * conteneur rétrécit pour deux raisons banales — le composeur qui grandit, et le
 * clavier iOS qui monte.
 *
 * Le dépôt encadre déjà par la source ce qui ne se teste pas autrement (la
 * coquille des feuilles, la cadence de rafraîchissement, le curseur du
 * composeur). Même méthode ici.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

/** Corps de l'effet qui pose l'observateur de défilement. */
const effetDeDefilement = (): string => {
  const debut = source.indexOf("const observer = new ResizeObserver(suivreLeBas);");
  expect(debut).toBeGreaterThan(-1);
  const fin = source.indexOf("observer.disconnect();", debut);
  expect(fin).toBeGreaterThan(debut);
  return source.slice(debut, fin);
};

describe("le défilement suit le contenu ET le conteneur", () => {
  test("l'observateur surveille le contenu", () => {
    expect(effetDeDefilement()).toContain("observer.observe(content);");
  });

  test("l'observateur surveille AUSSI le conteneur", () => {
    // ⚠️ C'est la ligne qui manquait, et tout le défaut tient là : sans elle,
    // un composeur qui grandit ou un clavier qui monte laisse le bas de la
    // conversation hors de la vue, sans qu'aucun événement ne le signale.
    expect(effetDeDefilement()).toContain("observer.observe(scroller);");
  });

  test("il y a donc exactement deux cibles observées", () => {
    expect(effetDeDefilement().match(/observer\.observe\(/g)?.length).toBe(2);
  });

  test("le conteneur observé est bien le défilant, pas le contenu", () => {
    // Les deux références existent et sont distinctes : les confondre
    // reviendrait à observer deux fois la même chose.
    expect(source).toContain("const scrollerRef = useRef<HTMLDivElement | null>(null);");
    expect(source).toContain("const contentRef = useRef<HTMLDivElement | null>(null);");
    expect(source).toContain("ref={scrollerRef}");
    expect(source).toContain("ref={contentRef}");
  });
});

describe("on ne ramène JAMAIS quelqu'un qui lisait plus haut", () => {
  test("le suivi est conditionné à l'intention, pas à la géométrie", () => {
    // ⚠️ `atBottom` enregistre l'**intention** de l'utilisateur. La recalculer
    // au moment du redimensionnement donnerait « faux » exactement dans le cas
    // qu'on veut corriger (le bas est déjà sorti de la vue), et « vrai » après
    // un défilement manuel — l'inverse de ce qu'il faut.
    expect(source).toContain("if (atBottom.current) scroller.scrollTop = scroller.scrollHeight;");
  });

  test("l'intention est mise à jour par le défilement de l'utilisateur", () => {
    expect(source).toContain("onScroll={onScroll}");
    expect(source).toContain(
      "atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;",
    );
  });

  test("le saut est instantané, jamais animé", () => {
    // Une animation se bat avec le clavier iOS et avec les rafraîchissements
    // rapprochés : c'est ce qui faisait « partir en vrille » le défilement.
    //
    // ⚠️ On vise l'**appel**, pas le mot : le commentaire qui explique le choix
    // nomme `scrollIntoView` pour raconter ce qui a été retiré.
    expect(source).not.toContain("scrollIntoView(");
    expect(source).not.toContain('behavior: "smooth"');
  });
});

describe("le défilement ne dépend pas du rafraîchissement des messages", () => {
  test("l'effet ne se repose pas à chaque rendu", () => {
    // ⚠️ Une dépendance sur `messages` ferait reposer l'observateur à chaque
    // tour de rafraîchissement — soit toutes les 400 ms pendant que l'agent
    // travaille. Le défilement suivrait alors des redimensionnements fantômes.
    const index = source.indexOf("const observer = new ResizeObserver(suivreLeBas);");
    const apres = source.slice(index, index + 1_200);
    expect(apres).toContain("}, []);");
    expect(apres).not.toContain("[messages]");
  });
});
