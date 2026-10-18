/**
 * Les origines Tailscale, dérivées de la configuration de Serve.
 *
 * ⚠️ **Le défaut que ce fichier encadre ne se voyait que sur les autres
 * machines.** `tailscale serve` sert sur **443** par défaut, et le navigateur
 * *omet* ce port de l'en-tête `Origin` : on envoie `https://<machine>.<tailnet>.ts.net`,
 * jamais `https://<machine>.<tailnet>.ts.net:443`. Le code fabriquait pourtant
 * `https://${hostPort}`, donc une origine qui ne correspondait à rien — et
 * **chaque envoi de message était refusé en 403** sur une machine configurée par
 * défaut.
 *
 * La machine de développement, elle, sert sur un port explicite (8790) : le
 * port figurait des deux côtés, tout passait, et rien ne se voyait.
 *
 * ⚠️ **La fixture principale n'est pas inventée** : c'est la sortie réelle de
 * `tailscale serve status --json`, relevée le 2026-10-15. Elle porte deux
 * services — le nôtre sur 8790, `print-cost-report` sur 8765 — parce que c'est
 * exactement ce qui rend le filtre vérifiable : autoriser les deux élargirait la
 * porte, et un test le refuse.
 */
import { describe, expect, test } from "bun:test";
import { hoteUrl, originesDeServe } from "../src/config.ts";

const PORT = 8791;

/** Sortie réelle de `tailscale serve status --json` (2026-10-15). */
const REEL = {
  TCP: {
    "8765": { HTTPS: true },
    "8790": { HTTPS: true },
  },
  Web: {
    "macbook-pro-de-thomas.tailae2442.ts.net:8765": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:8765" } },
    },
    "macbook-pro-de-thomas.tailae2442.ts.net:8790": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:8791" } },
    },
  },
};

/** Le même service, mais sur le port **par défaut** de Tailscale. */
const DEFAUT_443 = {
  TCP: { "443": { HTTPS: true } },
  Web: {
    "machine.tailnet.ts.net:443": {
      Handlers: { "/": { Proxy: "http://127.0.0.1:8791" } },
    },
  },
};

const serve = (proxy: string, hostPort = "machine.tailnet.ts.net:443") => ({
  Web: { [hostPort]: { Handlers: { "/": { Proxy: proxy } } } },
});

describe("le port 443 est omis de l'origine, comme le fait le navigateur", () => {
  test("Serve sur son port par défaut donne une origine SANS port", () => {
    // ⚠️ C'est la ligne qui était fausse. Avec `…:443`, toute la PWA répondait
    // 403 sur une installation par défaut.
    expect(originesDeServe(DEFAUT_443, PORT)).toEqual(["https://machine.tailnet.ts.net"]);
  });

  test("un port explicite reste dans l'origine", () => {
    expect(originesDeServe(serve("http://127.0.0.1:8791", "machine.ts.net:8790"), PORT)).toEqual([
      "https://machine.ts.net:8790",
    ]);
  });

  test("un autre port explicite est conservé tel quel", () => {
    expect(originesDeServe(serve("http://127.0.0.1:8791", "machine.ts.net:8443"), PORT)).toEqual([
      "https://machine.ts.net:8443",
    ]);
  });

  test("un hôte sans port est accepté", () => {
    expect(originesDeServe(serve("http://127.0.0.1:8791", "machine.ts.net"), PORT)).toEqual([
      "https://machine.ts.net",
    ]);
  });

  test("une adresse IPv6 entre crochets perd aussi son port 443", () => {
    expect(originesDeServe(serve("http://[::1]:8791", "[fd7a:115c:a1e0::1]:443"), PORT)).toEqual([
      "https://[fd7a:115c:a1e0::1]",
    ]);
  });
});

describe("seul le service qui pointe vers NOTRE backend est autorisé", () => {
  test("la configuration réelle ne livre que 8790, jamais 8765", () => {
    // ⚠️ Le test qui compte pour la sécurité : la machine sert aussi
    // `print-cost-report`. Autoriser son origine n'aurait aucun sens, et c'est
    // le genre d'élargissement qu'une comparaison approximative laisse passer.
    expect(originesDeServe(REEL, PORT)).toEqual([
      "https://macbook-pro-de-thomas.tailae2442.ts.net:8790",
    ]);
  });

  test("le même relevé, mais avec notre backend sur 8765, donne l'autre", () => {
    // La règle suit le **proxy**, pas le nom de l'hôte : rien n'est codé en dur
    // pour un port ou un service en particulier.
    expect(originesDeServe(REEL, 8765)).toEqual([
      "https://macbook-pro-de-thomas.tailae2442.ts.net:8765",
    ]);
  });

  test("un port voisin ne suffit pas", () => {
    expect(originesDeServe(serve("http://127.0.0.1:8792"), PORT)).toEqual([]);
  });

  test("une autre machine ne suffit pas", () => {
    expect(originesDeServe(serve("http://10.0.0.5:8791"), PORT)).toEqual([]);
  });

  test("aucun service : aucune origine", () => {
    expect(originesDeServe({ TCP: { "443": { HTTPS: true } } }, PORT)).toEqual([]);
  });

  test("plusieurs chemins sur le même hôte : il suffit qu'un seul vise le backend", () => {
    const statut = {
      Web: {
        "machine.ts.net:443": {
          Handlers: {
            "/autre": { Proxy: "http://127.0.0.1:9000" },
            "/": { Proxy: "http://127.0.0.1:8791" },
          },
        },
      },
    };

    expect(originesDeServe(statut, PORT)).toEqual(["https://machine.ts.net"]);
  });
});

describe("la cible est comparée par hôte et par port, jamais comme une chaîne", () => {
  test("`localhost` est accepté comme `127.0.0.1`", () => {
    // ⚠️ Serve rapporte la cible **telle qu'elle a été écrite** :
    // `tailscale serve --bg http://localhost:8791` est aussi valide. Une
    // comparaison textuelle refusait cette écriture, donc plus aucune origine
    // n'était ajoutée, donc 403.
    expect(originesDeServe(serve("http://localhost:8791"), PORT)).toEqual([
      "https://machine.tailnet.ts.net",
    ]);
  });

  test("une barre finale ne change rien", () => {
    expect(originesDeServe(serve("http://127.0.0.1:8791/"), PORT)).toEqual([
      "https://machine.tailnet.ts.net",
    ]);
  });

  test("une cible illisible est écartée, pas devinée", () => {
    expect(originesDeServe(serve("pas-une-url"), PORT)).toEqual([]);
  });

  test("une cible sans port est écartée", () => {
    expect(originesDeServe(serve("http://127.0.0.1"), PORT)).toEqual([]);
  });
});

describe("un relevé illisible ne fait pas tomber le démarrage", () => {
  test("un statut vide donne une liste vide", () => {
    expect(originesDeServe({}, PORT)).toEqual([]);
  });

  test("un type inattendu donne une liste vide", () => {
    // Serve non configuré : la liste locale suffit, ce n'est pas une erreur.
    expect(originesDeServe("pas-un-objet", PORT)).toEqual([]);
    expect(originesDeServe(null, PORT)).toEqual([]);
  });

  test("un `Web` au format inattendu donne une liste vide", () => {
    expect(originesDeServe({ Web: { "machine.ts.net:443": { Handlers: {} } } }, PORT)).toEqual([]);
  });

  test("un handler sans proxy donne une liste vide", () => {
    expect(
      originesDeServe({ Web: { "machine.ts.net:443": { Handlers: { "/": {} } } } }, PORT),
    ).toEqual([]);
  });
});

/**
 * L'hôte du mode `HERDR_REMOTE_BIND` (D010).
 *
 * ⚠️ **Sans Serve, le mode documenté est d'écouter sur l'adresse Tailscale.**
 * Sans cette origine dans la liste, chaque envoi était refusé en 403 dans le
 * seul mode qui reste quand Serve n'est pas disponible — c'est-à-dire quand on
 * en a le plus besoin.
 *
 * ⚠️ Une adresse IPv6 du tailnet commence par `fd7a:` et **doit** être mise
 * entre crochets dans une URL : `http://fd7a:115c:a1e0::1:8791` n'est pas
 * analysable, donc l'origine serait refusée sans que rien ne le dise.
 */
describe("l'hôte d'une adresse d'écoute est mis en forme pour une URL", () => {
  test("une adresse IPv4 reste telle quelle", () => {
    expect(hoteUrl("100.64.0.1")).toBe("100.64.0.1");
  });

  test("une adresse IPv6 est mise entre crochets", () => {
    expect(hoteUrl("fd7a:115c:a1e0::1")).toBe("[fd7a:115c:a1e0::1]");
  });

  test("une adresse déjà entre crochets n'est pas doublée", () => {
    expect(hoteUrl("[fd7a:115c:a1e0::1]")).toBe("[fd7a:115c:a1e0::1]");
  });

  test("le loopback est inchangé", () => {
    expect(hoteUrl("127.0.0.1")).toBe("127.0.0.1");
  });
});
