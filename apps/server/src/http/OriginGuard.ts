/**
 * Garde des requêtes mutantes (S02).
 *
 * **Pourquoi.** Le service n'a aucune authentification applicative : il écoute
 * sur `127.0.0.1` et Tailscale Serve l'expose au tailnet (D018.2). Tout
 * appareil du tailnet peut donc appeler `/api/agents/:paneId/prompt`. Ce n'est
 * pas un défaut — c'est le modèle décidé — mais cela rend le **CSRF** propriété
 * du navigateur : un site tiers peut tenter un POST vers `http://127.0.0.1:8791`
 * depuis le téléphone ou le Mac de l'utilisateur, et le navigateur joindra des
 * cookies implicites.
 *
 * Ce garde ne remplace pas une authentification. Il ferme ce qui peut l'être sans
 * elle : une requête cross-site **n'envoie pas** d'en-tête `Origin` utilisable
 * pour `application/json`, et un formulaire HTML ne peut pas produire un corps
 * JSON. Les deux sont vérifiés ici.
 *
 * Ce qu'il ne fait **pas**, et qu'aucune règle HTTP ne peut faire : distinguer
 * deux appareils légitimes du même tailnet. Cela reste hors périmètre (D02).
 */
import { MAX_JSON_BYTES } from "@herdr-remote/shared";
import type { RouteRequest } from "./Reply.ts";

/** Cause du refus, chacune avec son code HTTP propre. */
export type GuardRejection =
  | "origin-absente"
  | "origin-etrangere"
  | "methode"
  | "content-type"
  | "corps-trop-grand";

export interface GuardVerdict {
  readonly ok: boolean;
  readonly reason?: GuardRejection;
  readonly status?: number;
}

/** Cherche un en-tête sans se fier à sa casse. */
const readHeaderInsensible = (
  headers: { get(name: string): string | null },
  nom: string,
): string | null => {
  // Les noms d'en-tête HTTP sont insensibles à la casse ; un `Headers` réel
  // l'est déjà, mais un adaptateur peut ne pas l'être. On essaie les trois
  // écritures usuelles pour ne jamais laisser filer une limite.
  const variantes = [nom, nom.toLowerCase(), nom.toUpperCase()];
  for (const variante of variantes) {
    const trouve = headers.get(variante);
    if (trouve !== null) return trouve;
  }
  return null;
};

/** Origines autorisées, comparées **exactement**. */
export const isAllowedOrigin = (origin: string | null, expected: string): boolean => {
  // Comparaison de chaîne entière : `https://macbook.ts.net.evil.com` ne doit pas
  // passer pour `https://macbook.ts.net`.
  return origin !== null && origin === expected;
};

/**
 * Vérifie une requête mutante.
 *
 * `expectedOrigin` est l'origine **exacte** de la PWA, tirée de la
 * configuration. Aucun motif, aucune liste blanche laxiste.
 */
export const guardMutation = (
  request: Pick<RouteRequest, "headers" | "json">,
  expectedOrigin: string,
): GuardVerdict => {
  const origin = request.headers.get("origin");

  // 1. Origine. Une requête simple (formulaire, `<img>`, `<script>`) n'en
  //    envoie pas : c'est précisément le vecteur à fermer.
  if (origin === null || origin.length === 0) {
    return { ok: false, reason: "origin-absente", status: 403 };
  }
  if (!isAllowedOrigin(origin, expectedOrigin)) {
    return { ok: false, reason: "origin-etrangere", status: 403 };
  }

  // 2. Type de contenu. Un formulaire HTML ne peut produire que
  //    `application/x-www-form-urlencoded`, `multipart/form-data` ou
  //    `text/plain` : les exiger rend le cross-site impossible.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return { ok: false, reason: "content-type", status: 415 };
  }

  // 3. Taille déclarée. Un corps énorme est refusé **avant** d'être lu : le
  //    lire pour le refuser ensuite consommerait la mémoire pour rien.
  //
  // ⚠️ Les noms d'en-tête HTTP sont **insensibles à la casse**. Un client qui
  // envoie `Content-Length` verrait sa limite ignorée — donc contournée.
  const longueur = Number.parseInt(
    readHeaderInsensible(request.headers, "content-length") ?? "",
    10,
  );
  if (Number.isInteger(longueur) && longueur > MAX_JSON_BYTES) {
    return { ok: false, reason: "corps-trop-grand", status: 413 };
  }

  return { ok: true };
};

/** Message : la cause, jamais un refus muet. */
export const describeGuardRejection = (reason: GuardRejection): string => {
  switch (reason) {
    case "origin-absente":
      return "origine absente : requête cross-site probable";
    case "origin-etrangere":
      return "origine non autorisée";
    case "methode":
      return "méthode non autorisée sur cette route";
    case "content-type":
      return "Content-Type attendu : application/json";
    case "corps-trop-grand":
      return `corps trop grand (maximum ${String(MAX_JSON_BYTES)} octets)`;
    default:
      return "requête refusée";
  }
};

/**
 * Réponse 405 avec `Allow: POST`.
 *
 * ⚠️ `Allow` est obligatoire sur un 405 : sans lui, un client ne sait pas si
 * la route existe ou est interdite, et ne peut pas se corriger.
 */
export const methodNotAllowed = (): Response =>
  new Response(JSON.stringify({ error: describeGuardRejection("methode") }), {
    status: 405,
    headers: { allow: "POST", "content-type": "application/json" },
  });
