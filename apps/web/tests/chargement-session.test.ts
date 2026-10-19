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
 *
 * Depuis, la cadence suit aussi **le regard** : rapide au premier plan, lente en
 * arrière-plan. Le canal reste le même — une fonction relue à chaque tour — donc
 * la règle ci-dessus tient toujours : ce sont des valeurs, pas des dépendances.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

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
  });

  /**
   * ⚠️ **La cadence suit le regard autant que le statut.** Une app visible est
   * regardée ; une app en arrière-plan ne l'est pas. Les deux cas n'ont pas le
   * même prix : au premier plan, la latence se voit ; en arrière-plan, elle
   * vide la batterie du téléphone pour un écran que personne ne lit.
   */
  test("la cadence est rapide au premier plan, lente en arrière-plan", () => {
    const effet = effetDeChargement();

    expect(effet).toContain('document.visibilityState === "visible"');
    expect(effet).toContain('statutRef.current === "working" ? 400 : 1200');
    expect(effet).toContain('statutRef.current === "working" ? 3000 : 10_000');
  });

  test("revenir au premier plan relit immédiatement", () => {
    // Sans cela, on attend la fin du tour en cours — jusqu'à dix secondes — et
    // l'écran paraît figé au moment précis où on le rouvre.
    const effet = effetDeChargement();

    expect(effet).toContain('document.addEventListener("visibilitychange", reveil)');
    expect(effet).toContain('window.addEventListener("focus", reveil)');
    expect(effet).toContain("window.clearTimeout(timer);\n      tour();");
  });

  /**
   * ⚠️ **`hasFocus()` est instable sur iOS** : il tombe à `false` sans que l'app
   * ait été quittée. Caler la cadence dessus la ralentirait au moment précis où
   * on est en train de lire — le contraire de ce qu'on veut, et de façon
   * invisible. Le `focus` de la fenêtre sert donc à **réveiller**, jamais à
   * ralentir.
   */
  test("la cadence ne dépend jamais de `hasFocus`", () => {
    // On vise l'appel, pas le mot : le commentaire qui explique le choix le nomme.
    expect(effetDeChargement()).not.toContain("document.hasFocus(");
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
  test("les pages précédentes se chargent au DÉFILEMENT, pas une fois pour toutes", () => {
    // ⚠️ Ce test gardait un chargement automatique unique. Il a été remplacé :
    // sur une session codex réelle, la demande courante peut être dix pages en
    // arrière, et un seul chargement laissait l'utilisateur appuyer dix fois.
    // Le déclencheur est maintenant le repère de haut de fil, et la garde
    // (`doitChargerPlusTot`) vit dans `defilement.ts` où elle est testée.
    expect(source).not.toContain("autoLoadedPrevious");
    expect(source).toContain("IntersectionObserver");
    expect(source).toContain("doitChargerPlusTot({");
    // Le bouton reste : le clavier n'a pas de geste de défilement, et un échec
    // doit pouvoir être réessayé.
    expect(source).toContain("Load earlier messages");
  });
});

/**
 * Sans session, on ne demande rien — et on ne crie pas au loup.
 *
 * ⚠️ **Le défaut mesuré.** Herdr n'annonce `agent_session` qu'à partir du premier
 * message : un agent neuf a `sessionPath === null`, et la route répond 404
 * « no usable session path for this agent ». L'écran affichait alors un **avis**
 * *et* une **erreur rouge** pour la même absence — sur un agent qui venait
 * simplement de démarrer, et dont l'écran portait par ailleurs l'invite de
 * confiance.
 */
describe("U20 — sans chemin de session, aucun appel", () => {
  const ecran = readFileSync(join(import.meta.dir, "..", "src", "ChatScreen.tsx"), "utf8");

  test("le chargement sort avant tout appel", () => {
    expect(ecran).toContain("if (agent.sessionPath === null) {");
    const garde = ecran.slice(ecran.indexOf("if (agent.sessionPath === null) {"));
    // ⚠️ La garde doit précéder l'appel : la sortie est ce qui évite le 404.
    expect(garde.slice(0, 200)).toContain("return;");
    expect(garde.slice(0, 200)).not.toContain("fetchSession");
  });

  test("un chemin qui apparaît plus tard est REPRIS", () => {
    // ⚠️ Sans `sessionPath` dans les dépendances, la garde resterait figée sur
    // « pas de session » et l'écran ne chargerait jamais rien.
    expect(ecran).toContain("[agent.paneId, agent.sessionPath],");
  });
});
