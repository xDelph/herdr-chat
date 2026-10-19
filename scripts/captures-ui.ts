/**
 * Captures de l'interface, en headless, contre le démon **réel** (lecture seule).
 *
 * ⚠️ **Pourquoi ce script existe.** Les tests de `apps/web/tests` lisent la
 * source : ils attrapent les régressions de règle, pas une mise en page cassée,
 * un bouton hors écran ou un écran vide. Ici on regarde vraiment.
 *
 * ⚠️ **Ce qu'il ne fait pas.** Aucun clic sur `Stop`, `Focus`, `Answer`,
 * `Trust` : ces gestes agissent sur les agents de l'utilisateur (AGENTS.md).
 * On navigue et on ouvre des feuilles — le pire effet est un panneau ouvert.
 *
 * Usage :
 *   bun scripts/captures-ui.ts http://localhost:8793 apps/web/captures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = process.argv[2] ?? "http://localhost:8793";
const SORTIE = process.argv[3] ?? "apps/web/captures";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT_CDP = 9333;
/**
 * ⚠️ L'hôte est **composé**, jamais écrit en littéral : une adresse IP en clair
 * dans un fichier se fait réécrire par l'outillage d'affichage de ce dépôt, et
 * le script se retrouve à interroger un hôte qui n'existe pas.
 */
const HOTE_CDP = ["127", "0", "0", "1"].join(".");

mkdirSync(SORTIE, { recursive: true });

/** Un client CDP minimal — pas de dépendance, `WebSocket` est natif ici. */
class Cdp {
  #ws: WebSocket;
  #id = 0;
  #attente = new Map<number, (valeur: Record<string, unknown>) => void>();

  constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (evenement) => {
      const message = JSON.parse(String(evenement.data)) as { id?: number };
      if (message.id === undefined) return;
      this.#attente.get(message.id)?.(message as Record<string, unknown>);
      this.#attente.delete(message.id);
    });
  }

  static async ouvre(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((ok, ko) => {
      ws.addEventListener("open", ok, { once: true });
      ws.addEventListener("error", ko, { once: true });
    });
    return new Cdp(ws);
  }

  envoie(methode: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.#id += 1;
    const identifiant = this.#id;
    return new Promise((ok) => {
      this.#attente.set(identifiant, ok);
      this.#ws.send(JSON.stringify({ id: identifiant, method: methode, params }));
    });
  }

  /** Évalue une expression dans la page et rend sa valeur. */
  async evalue<T>(expression: string): Promise<T> {
    const reponse = (await this.envoie("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    })) as { result?: { result?: { value?: T } } };
    return reponse.result?.result?.value as T;
  }
}

const dort = async (ms: number): Promise<void> =>
  new Promise((ok) => {
    setTimeout(ok, ms);
  });

/** Lance Chrome headless une fois, et le referme à la fin. */
const lancer = (): { pid: number } => {
  const enfant = Bun.spawn([
    CHROME,
    "--headless=new",
    `--remote-debugging-port=${String(PORT_CDP)}`,
    "--user-data-dir=/tmp/herdr-captures-profil",
    "--window-size=390,844",
    "--hide-scrollbars",
    "about:blank",
  ]);
  return { pid: enfant.pid };
};

const point = async (): Promise<string> => {
  for (let essai = 0; essai < 40; essai += 1) {
    try {
      // ⚠️ La cible PAGE, pas la cible navigateur : `/json/version` rend le
      // WebSocket du navigateur, où le domaine `Page` n'existe pas —
      // `Page.captureScreenshot` répondait « wasn't found ».
      const reponse = await fetch(`http://${HOTE_CDP}:${String(PORT_CDP)}/json/list`);
      const cibles = (await reponse.json()) as { type?: string; webSocketDebuggerUrl?: string }[];
      const page = cibles.find((cible) => cible.type === "page");
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome n'écoute pas encore.
    }
    await dort(250);
  }
  throw new Error("Chrome n'a jamais ouvert son port de débogage");
};

/**
 * Attend qu'une condition soit vraie dans la page, ou rend la main au délai.
 *
 * ⚠️ **Une attente fixe ne suffit pas, et c'est mesuré** : avec 2,5 s, la
 * capture montrait « Loading… » ; à 4 s, la liste était remplie. Un chiffre en
 * dur aurait fait conclure à un défaut de démarrage qui n'existait pas — le
 * premier vol et l'ouverture du flux prennent quelques secondes en headless.
 */
const attendreQue = async (cdp: Cdp, expression: string, delaiMs = 15_000): Promise<boolean> => {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    const pret = await cdp.evalue<boolean>(`(() => { try { return Boolean(${expression}); } catch { return false; } })()`);
    if (pret) return true;
    await dort(150);
  }
  return false;
};

const capture = async (cdp: Cdp, nom: string): Promise<void> => {
  const reponse = (await cdp.envoie("Page.captureScreenshot", { format: "png" })) as {
    result?: { data?: string };
  };
  const donnees = reponse.result?.data;
  if (donnees === undefined) {
    throw new Error(`capture vide : ${nom} — réponse ${JSON.stringify(reponse).slice(0, 300)}`);
  }
  writeFileSync(join(SORTIE, `${nom}.png`), Buffer.from(donnees, "base64"));
  console.log(`capture : ${nom}.png`);
};

const principal = async (): Promise<void> => {
  let tailleCourante = "390x844";
  const chrome = lancer();
  try {
    const cdp = await Cdp.ouvre(await point());
    await cdp.envoie("Page.enable");
    await cdp.envoie("Runtime.enable");
    /*
      ⚠️ **Trois tailles, pas une.** 320×568 est le pire cas (iPhone SE, barre
      d'URL comprise) : c'est là que les libellés débordent et que le composeur
      recouvre le fil. 1440 large est l'autre extrême : le chat occupe-t-il la
      largeur entière, avec des lignes de 200 caractères illisibles ?
    */
    const tailles: { etiquette: string; height: number; width: number }[] = [
      { etiquette: "320x568", height: 568, width: 320 },
      { etiquette: "390x844", height: 844, width: 390 },
      { etiquette: "desktop", height: 900, width: 1440 },
    ];
    for (const taille of tailles) {
    tailleCourante = taille.etiquette;
    await cdp.envoie("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: taille.etiquette === "desktop" ? 1 : 2,
      height: taille.height,
      mobile: taille.etiquette !== "desktop",
      width: taille.width,
    });

    /*
      ⚠️ **Recharger après avoir changé les métriques.** Sans ce `reload`, la
      page garde la mise en page de la taille PRÉCÉDENTE et la capture montre un
      contenu plus large que l'écran — coupé aux deux bords. Je l'ai pris pour
      un défaut de mise en page à 320 px ; c'en était encore un du harnais.
    */
    await cdp.envoie("Page.reload", { ignoreCache: true });
    await dort(400);
    await cdp.envoie("Page.navigate", { url: `${RACINE}/#/` });
    // On attend le CONTENU, jamais un nombre de millisecondes.
    const listePrete = await attendreQue(
      cdp,
      `document.querySelector('a[href*="#/agent/"]') || /\b(Empty|No agents)\b/.test(document.body.innerText)`,
    );
    if (!listePrete) console.log("avertissement : la liste n'est pas remplie après 15 s");
    await dort(300);
    await capture(cdp, `${tailleCourante}-01-liste`);

    // La première conversation disponible : on lit son paneId depuis la liste.
    /*
      ⚠️ **Les lignes sont des `<button class="conv">`, pas des liens.** La
      première version du script cherchait un `a[href*="#/agent/"]` : il n'en
      existe aucun, et le script concluait « liste vide » sur une liste pleine.
      On clique donc la première ligne et on lit le fragment obtenu.
    */
    const clic = await cdp.evalue<boolean>(
      `(() => { const b = document.querySelector('button.conv'); if (!b) return false; b.click(); return true; })()`,
    );
    if (!clic) {
      console.log("aucune conversation : la liste est vide, captures suivantes sautées");
      return;
    }
    await attendreQue(cdp, `location.hash.startsWith('#/agent/')`, 4000);
    const pane = await cdp.evalue<string>(`location.hash`);
    if (pane === "") {
      console.log("aucune route d'agent : captures suivantes sautées");
      return;
    }
    await attendreQue(cdp, `document.querySelector('.bubble, .messages__empty')`);
    await dort(600);
    await capture(cdp, `${tailleCourante}-02-chat`);

    // Les feuilles : on ouvre par le bouton, jamais par un état forcé.
    const ouvrir = async (selecteur: string, nom: string): Promise<void> => {
      const clique = await cdp.evalue<boolean>(
        `(() => { const b = document.querySelector(${JSON.stringify(selecteur)}); if (!b) return false; b.click(); return true; })()`,
      );
      if (!clique) {
        console.log(`bouton absent : ${nom}`);
        return;
      }
      await attendreQue(cdp, `document.querySelector('dialog[open]')`, 4000);
      await dort(400);
      await capture(cdp, nom);
      await cdp.evalue(`(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); return true; })()`);
      await dort(300);
    };

    // ⚠️ Le bouton Settings vit sur la **liste**, pas dans le chat : on y
    // retourne pour l'ouvrir, puis on revient sur l'agent pour les feuilles.
    await cdp.envoie("Page.navigate", { url: `${RACINE}/#/` });
    await attendreQue(cdp, `document.querySelector('button.conv')`);
    await ouvrir('button[aria-label="Settings"]', "03-settings");

    await cdp.envoie("Page.navigate", { url: `${RACINE}/${pane}` });
    await attendreQue(cdp, `document.querySelector('.bubble, .messages__empty')`);
    await dort(400);
    await ouvrir('button[aria-label*="model" i], button[title*="model" i]', "04-model");
    await ouvrir('button[aria-label*="files" i], button[title*="files" i]', "05-files");
    }
  } finally {
    try {
      process.kill(chrome.pid);
    } catch {
      // Chrome est déjà parti : rien à faire.
    }
  }
};

await principal();
