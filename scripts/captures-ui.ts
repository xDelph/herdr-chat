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
  const chrome = lancer();
  try {
    const cdp = await Cdp.ouvre(await point());
    await cdp.envoie("Page.enable");
    await cdp.envoie("Runtime.enable");
    // 390×844 : la taille d'un iPhone, celle qui casse les mises en page larges.
    await cdp.envoie("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 2,
      height: 844,
      width: 390,
    });

    await cdp.envoie("Page.navigate", { url: `${RACINE}/#/` });
    await dort(2500);
    await capture(cdp, "01-liste");

    // La première conversation disponible : on lit son paneId depuis la liste.
    const pane = await cdp.evalue<string | null>(
      `(() => { const a = document.querySelector('a[href*="#/agent/"]'); return a ? a.getAttribute('href') : null; })()`,
    );
    if (pane === null) {
      console.log("aucune conversation : la liste est vide, captures suivantes sautées");
      return;
    }
    await cdp.envoie("Page.navigate", { url: `${RACINE}/${String(pane)}` });
    await dort(3000);
    await capture(cdp, "02-chat");

    // Les feuilles : on ouvre par le bouton, jamais par un état forcé.
    const ouvrir = async (selecteur: string, nom: string): Promise<void> => {
      const clique = await cdp.evalue<boolean>(
        `(() => { const b = document.querySelector(${JSON.stringify(selecteur)}); if (!b) return false; b.click(); return true; })()`,
      );
      if (!clique) {
        console.log(`bouton absent : ${nom}`);
        return;
      }
      await dort(700);
      await capture(cdp, nom);
      await cdp.evalue(`(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); return true; })()`);
      await dort(300);
    };

    await ouvrir('button[aria-label*="ettings" i], button[title*="ettings" i]', "03-settings");
    await ouvrir('button[aria-label*="model" i], button[title*="model" i]', "04-model");
    await ouvrir('button[aria-label*="files" i], button[title*="files" i]', "05-files");
  } finally {
    try {
      process.kill(chrome.pid);
    } catch {
      // Chrome est déjà parti : rien à faire.
    }
  }
};

await principal();
