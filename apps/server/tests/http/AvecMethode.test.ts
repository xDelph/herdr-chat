/**
 * La requête survit à l'ajout de la méthode (correction S02).
 *
 * ⚠️ Ces tests utilisent une **vraie** `Request`. Un objet fabrique à la main
 * aurait des propriétés propres, et le spread aurait fonctionné — c'est
 * exactement la différence que le défaut exploite.
 */
import { describe, expect, test } from "bun:test";
import { avecMethode, avecMethodePourRoutes } from "../../src/http/AvecMethode.ts";
import type { Routes } from "../../src/http/Reply.ts";
import type { RequeteEntrante } from "../../src/http/AvecMethode.ts";

/**
 * Ce que Bun livre : une **vraie** `Request`, plus `params` sur un chemin de
 * motif.
 *
 * ⚠️ Une `Request`-fabrique à la main aurait des propriétés propres, et le
 * spread aurait fonctionné — c'est précisément la différence que le défaut
 * exploite. On construit donc une vraie `Request`, et on n'ajoute que `params`.
 */
const requete = (url: string, params?: Record<string, string | undefined>): RequeteEntrante => {
  const native = new Request(url, { method: "POST" });
  return params === undefined ? native : { ...champsDe(native), params };
};

/** Les champs que nos routes lisent, pris sur la requête native. */
const champsDe = (native: Request): RequeteEntrante => ({
  get headers() {
    return native.headers;
  },
  json: () => native.json(),
  get method() {
    return native.method;
  },
  get url() {
    return native.url;
  },
});

describe("S02 — la requête n'est pas vidée en route", () => {
  test("l'URL reste lisible — c'est elle qui était perdue", () => {
    const r = avecMethode(requete("http://127.0.0.1:8791/api/agents/w2:p1/session?tail=4096"));
    // Avant la correction : `undefined`, et `new URL(undefined)` levait.
    expect(new URL(r.url).searchParams.get("tail")).toBe("4096");
  });

  test("les en-têtes restent lisibles", () => {
    const native = new Request("http://x.test/api/log", { headers: { origin: "http://x.test" } });
    const r = avecMethode(champsDe(native));
    expect(r.headers.get("origin")).toBe("http://x.test");
  });

  test("le corps reste décodable", async () => {
    const native = new Request("http://x.test/api/log", {
      body: JSON.stringify({ message: "coupé" }),
      method: "POST",
    });
    const r = avecMethode(champsDe(native));
    const corps = await r.json();
    expect(corps).toEqual({ message: "coupé" });
    return corps;
  });

  test("les paramètres de motif survivent", () => {
    const r = avecMethode(requete("http://x.test/a", { paneId: "w2:p1" }));
    expect(r.params["paneId"]).toBe("w2:p1");
  });

  test("sans paramètres, un objet vide plutôt qu'un accès qui casse", () => {
    // Une route qui fait `request.params["paneId"]` ne doit pas jeter sur une
    // route à paramètre absent.
    expect(avecMethode(requete("http://x.test/a")).params).toEqual({});
  });
});

describe("S02 — la méthode est disponible, et reste la bonne", () => {
  test("une requête native la conserve", () => {
    expect(avecMethode(requete("http://x.test/a")).method).toBe("POST");
  });

  test("sans méthode — le cas de Bun — elle vaut GET", () => {
    expect(avecMethode(champsDe(new Request("http://x.test/a"))).method).toBe("GET");
  });

  test("toutes les routes sont enveloppées", async () => {
    const vues: string[] = [];
    const routes: Routes = {
      "/api/a": (r) => {
        vues.push(`a:${r.method}:${new URL(r.url).pathname}`);
        return new Response("a");
      },
      "/api/b": (r) => {
        vues.push(`b:${r.method}:${new URL(r.url).pathname}`);
        return new Response("b");
      },
    };
    const enveloppees = avecMethodePourRoutes(routes);
    await enveloppees["/api/a"]?.(requete("http://x.test/a"));
    await enveloppees["/api/b"]?.(requete("http://x.test/b"));
    // Les deux routes ont vu une URL valide : c'est ce qui manquait.
    expect(vues).toEqual(["a:POST:/a", "b:POST:/b"]);
  });

  test("une route qui rejette remonte son erreur, telle quelle", () => {
    // ⚠️ Pas de promessemade(maintenant) : le gestionnaire est **appelé** à la
    // demande, et l'erreur doit rester celle de la route, pas une enveloppe.
    const routes: Routes = {
      "/api/ko": () => {
        throw new Error("cassé");
      },
    };
    const enveloppees = avecMethodePourRoutes(routes);
    expect(() => enveloppees["/api/ko"]?.(champsDe(new Request("http://x.test/ko")))).toThrow(
      "cassé",
    );
  });
});
