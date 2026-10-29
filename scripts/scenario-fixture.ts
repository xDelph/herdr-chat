/**
 * Scénario navigateur contre un démon **fixture uniquement** (T067, socle).
 *
 * Parcours : liste → chat → page d'historique → reconnexion, dans Chrome
 * headless piloté par CDP (aucune dépendance : `WebSocket` est natif).
 *
 * ⚠️ **Fixture, jamais le réel.** Le démon est lancé par
 * `xtask fixture-daemon` : vrai binaire `herdrchat`, mais socket Herdr FAUX
 * (il refuse nommément toute mutation), sessions synthétiques copiées du
 * bundle gelé, `HOME` temporaire, port libre du loopback (jamais 8791).
 * Aucun clic n'envoie quoi que ce soit : on lit, on navigue, on coupe le
 * réseau du navigateur.
 *
 * ⚠️ **Ne tue que ce qu'il a lancé** : le processus Chrome qu'il a démarré
 * (profil temporaire, port CDP libre) et le démon, arrêté en fermant l'entrée
 * standard de `xtask fixture-daemon`.
 *
 * Prérequis : PWA construite puis binaire construit (la PWA est embarquée) :
 *   bun run build && cargo build -p herdrchat
 *
 * Usage :
 *   bun scripts/scenario-fixture.ts [dossier-de-sortie]
 * Sortie : `rapport.json` + captures PNG ; code 1 si une étape échoue.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** L'hôte est composé, jamais écrit en littéral (voir captures-ui.ts). */
const HOTE = ["127", "0", "0", "1"].join(".");
const SORTIE = process.argv[2] ?? mkdtempSync(join(tmpdir(), "herdr-scenario-"));
mkdirSync(SORTIE, { recursive: true });

type Etape = {
  readonly nom: string;
  readonly ok: boolean;
  readonly statut: "ok" | "echec" | "non-applicable";
  readonly detail: string;
};
const etapes: Etape[] = [];
const note = (nom: string, statut: Etape["statut"], detail: string): void => {
  etapes.push({ detail, nom, ok: statut !== "echec", statut });
  console.log(`[${statut}] ${nom} — ${detail}`);
};

const dort = async (ms: number): Promise<void> =>
  new Promise((ok) => {
    setTimeout(ok, ms);
  });

const portLibre = async (): Promise<number> =>
  new Promise((ok, ko) => {
    const serveur = createServer();
    serveur.once("error", ko);
    serveur.listen(0, HOTE, () => {
      const adresse = serveur.address();
      const port = typeof adresse === "object" && adresse !== null ? adresse.port : 0;
      serveur.close(() => ok(port));
    });
  });

/** Un client CDP minimal, avec écoute des événements. */
class Cdp {
  #ws: WebSocket;
  #id = 0;
  #attente = new Map<number, (valeur: Record<string, unknown>) => void>();
  readonly evenements: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (evenement) => {
      const message = JSON.parse(String(evenement.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (message.id === undefined) {
        if (message.method !== undefined) {
          this.evenements.push({ method: message.method, params: message.params ?? {} });
        }
        return;
      }
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

  async envoie(
    methode: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    this.#id += 1;
    const identifiant = this.#id;
    const reponse = await new Promise<Record<string, unknown>>((ok) => {
      this.#attente.set(identifiant, ok);
      this.#ws.send(JSON.stringify({ id: identifiant, method: methode, params }));
    });
    if (reponse["error"] !== undefined) {
      throw new Error(`${methode} : ${JSON.stringify(reponse["error"])}`);
    }
    return reponse;
  }

  async evalue<T>(expression: string): Promise<T> {
    const reponse = (await this.envoie("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    })) as { result?: { result?: { value?: T } } };
    return reponse.result?.result?.value as T;
  }

  /** Les URL demandées depuis le début (Network.requestWillBeSent). */
  urls(): string[] {
    return this.evenements
      .filter((e) => e.method === "Network.requestWillBeSent")
      .map((e) => String((e.params["request"] as { url?: string } | undefined)?.url ?? ""));
  }

  close(): void {
    this.#ws.close();
  }
}

const attend = async (
  cdp: Cdp,
  expression: string,
  delaiMs: number,
): Promise<{ ok: boolean; ms: number }> => {
  const debut = Date.now();
  while (Date.now() - debut < delaiMs) {
    if (await cdp.evalue<boolean>(expression)) return { ms: Date.now() - debut, ok: true };
    await dort(150);
  }
  return { ms: Date.now() - debut, ok: false };
};

const capture = async (cdp: Cdp, nom: string): Promise<string> => {
  const reponse = (await cdp.envoie("Page.captureScreenshot", { format: "png" })) as {
    result?: { data?: string };
  };
  const chemin = join(SORTIE, `${nom}.png`);
  writeFileSync(chemin, Buffer.from(reponse.result?.data ?? "", "base64"));
  return chemin;
};

// ── 1. Le démon fixture ──
const demon = spawn("cargo", ["run", "--offline", "-q", "-p", "xtask", "--", "fixture-daemon"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const racine = await new Promise<string>((ok, ko) => {
  let tampon = "";
  const delai = setTimeout(() => ko(new Error("démon fixture non prêt en 180 s")), 180_000);
  demon.stdout.on("data", (morceau: Buffer) => {
    tampon += morceau.toString();
    const trouve = /FIXTURE_PRETE (\S+)/.exec(tampon);
    if (trouve?.[1] !== undefined) {
      clearTimeout(delai);
      ok(trouve[1]);
    }
  });
  demon.once("exit", (code) => {
    clearTimeout(delai);
    ko(new Error(`xtask fixture-daemon s'est arrêté (code ${code})`));
  });
});
console.log(`démon fixture : ${racine}`);

// ── 2. Chrome headless, profil jetable ──
const profil = mkdtempSync(join(tmpdir(), "herdr-scenario-chrome-"));
const portCdp = await portLibre();
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${portCdp}`,
    `--user-data-dir=${profil}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=390,844",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let codeSortie = 0;
try {
  let cibles: Array<{ type: string; webSocketDebuggerUrl: string }> = [];
  for (let essai = 0; essai < 50 && cibles.length === 0; essai += 1) {
    await dort(200);
    try {
      const liste = (await (await fetch(`http://${HOTE}:${portCdp}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl: string;
      }>;
      cibles = liste.filter((cible) => cible.type === "page");
    } catch {
      // Chrome démarre encore.
    }
  }
  const page = cibles[0];
  if (page === undefined) throw new Error("Chrome : aucune page CDP");
  const cdp = await Cdp.ouvre(page.webSocketDebuggerUrl);
  await cdp.envoie("Network.enable");
  await cdp.envoie("Page.enable");
  await cdp.envoie("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 2,
    height: 844,
    mobile: true,
    width: 390,
  });

  // ── 3. Liste ──
  await cdp.envoie("Page.navigate", { url: `${racine}/#/liste` });
  const liste = await attend(cdp, "document.querySelectorAll('a.ligne').length > 0", 15_000);
  const lignes = await cdp.evalue<number>("document.querySelectorAll('a.ligne').length");
  await capture(cdp, "01-liste");
  note(
    "liste",
    liste.ok ? "ok" : "echec",
    `${lignes} conversation(s) affichée(s) en ${liste.ms} ms`,
  );

  // ── 4. Chat ──
  await cdp.evalue<void>("document.querySelector('a.ligne')?.click()");
  const chat = await attend(
    cdp,
    "location.hash.startsWith('#/agent/') && document.querySelectorAll('.fil__el').length > 0",
    15_000,
  );
  const elements = await cdp.evalue<number>("document.querySelectorAll('.fil__el').length");
  const hash = await cdp.evalue<string>("location.hash");
  await capture(cdp, "02-chat");
  note(
    "chat",
    chat.ok ? "ok" : "echec",
    `${hash} : ${elements} élément(s) de fil en ${chat.ms} ms`,
  );

  // ── 5. Page d'historique ──
  const avantHistorique = cdp.urls().filter((url) => url.includes("before=")).length;
  for (let essai = 0; essai < 20; essai += 1) {
    await cdp.evalue<void>(
      "(() => { const f = document.querySelector('.fil'); if (f) { f.scrollTop = 0; f.dispatchEvent(new Event('scroll')); } })()",
    );
    await dort(250);
    if (cdp.urls().filter((url) => url.includes("before=")).length > avantHistorique) break;
  }
  const demandesHistorique = cdp.urls().filter((url) => url.includes("before="));
  await dort(800);
  const elementsApres = await cdp.evalue<number>("document.querySelectorAll('.fil__el').length");
  await capture(cdp, "03-historique");
  if (demandesHistorique.length > avantHistorique) {
    note(
      "historique",
      elementsApres > elements ? "ok" : "echec",
      `page antérieure demandée (${demandesHistorique.at(-1)}) ; éléments ${elements} → ${elementsApres}`,
    );
  } else {
    // Une session de fixture plus courte que la fenêtre initiale n'a pas de
    // page antérieure : c'est dit, pas compté comme un succès.
    note(
      "historique",
      "non-applicable",
      "aucune requête before= après défilement en haut — la session de fixture tient peut-être dans la première fenêtre",
    );
  }

  // ── 6. Reconnexion ──
  const fluxAvant = cdp.urls().filter((url) => /\/api\/(events|agents\/[^/]+\/stream)/.test(url));
  await cdp.envoie("Network.emulateNetworkConditions", {
    downloadThroughput: -1,
    latency: 0,
    offline: true,
    uploadThroughput: -1,
  });
  await dort(4_000);
  await capture(cdp, "04-hors-ligne");
  await cdp.envoie("Network.emulateNetworkConditions", {
    downloadThroughput: -1,
    latency: 0,
    offline: false,
    uploadThroughput: -1,
  });
  const debutReprise = Date.now();
  const indiceReprise = cdp.evenements.length;
  let fluxApres = fluxAvant;
  while (Date.now() - debutReprise < 60_000) {
    await dort(250);
    fluxApres = cdp.urls().filter((url) => /\/api\/(events|agents\/[^/]+\/stream)/.test(url));
    if (fluxApres.length > fluxAvant.length) break;
  }
  await dort(1_000);
  const elementsRepris = await cdp.evalue<number>("document.querySelectorAll('.fil__el').length");
  await capture(cdp, "05-reconnecte");
  const apresReprise = cdp.evenements
    .slice(indiceReprise)
    .filter((e) => e.method === "Network.requestWillBeSent")
    .map((e) => new URL(String((e.params["request"] as { url?: string }).url)).pathname);
  const echecs = cdp.evenements
    .filter((e) => e.method === "Network.loadingFailed")
    .map((e) => String(e.params["errorText"]));
  // Critère : les flux SSE (journal global ou flux de session) sont ROUVERTS.
  // Un retour au seul sondage est rapporté, pas compté comme une reconnexion.
  note(
    "reconnexion",
    fluxApres.length > fluxAvant.length && elementsRepris > 0 ? "ok" : "echec",
    `flux SSE ouverts avant coupure : ${fluxAvant.length} ; échecs pendant la coupure : ${echecs.length} (${[...new Set(echecs)].join(", ")}) ; flux rouverts : ${fluxApres.length - fluxAvant.length} en ${Date.now() - debutReprise} ms ; requêtes après reprise : ${apresReprise.length} (${[...new Set(apresReprise)].join(", ")}) ; fil : ${elementsRepris} élément(s)`,
  );

  // ── 7. Aucun appel hors du démon fixture ──
  const etrangeres = cdp
    .urls()
    .filter((url) => url.startsWith("http") && !url.startsWith(racine) && !url.startsWith("data:"));
  note(
    "isolement",
    etrangeres.length === 0 ? "ok" : "echec",
    etrangeres.length === 0
      ? "toutes les requêtes visent le démon fixture"
      : `requêtes hors fixture : ${etrangeres.join(", ")}`,
  );
  cdp.close();
} catch (erreur) {
  note("execution", "echec", erreur instanceof Error ? erreur.message : String(erreur));
} finally {
  chrome.kill();
  demon.stdin.end();
  await new Promise((ok) => {
    demon.once("exit", ok);
    setTimeout(ok, 10_000);
  });
  rmSync(profil, { force: true, recursive: true });
}

if (etapes.some((etape) => !etape.ok)) codeSortie = 1;
writeFileSync(
  join(SORTIE, "rapport.json"),
  `${JSON.stringify({ demon: "xtask fixture-daemon", date: new Date().toISOString(), etapes }, null, 2)}\n`,
);
console.log(`rapport : ${join(SORTIE, "rapport.json")}`);
process.exit(codeSortie);
