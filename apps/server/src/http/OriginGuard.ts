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
  /**
   * Ce qui a réellement été trouvé, pour un refus d'origine.
   *
   * ⚠️ « origine non autorisée » sans la valeur reçue est **indiagnosticable** :
   * ni l'utilisateur ni l'opérateur ne peuvent savoir si le problème est une
   * mauvaise configuration ou une requête d'un autre appareil. La cause se dit.
   */
  readonly attendue?: string;
  readonly recue?: string | null;
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

/**
 * Origines autorisées, comparées **exactement** et **entièrement**.
 *
 * `https://macbook.ts.net.evil.com` ne doit pas passer pour
 * `https://macbook.ts.net` : pas de comparaison partielle, pas de motif.
 */
export const isAllowedOrigin = (origin: string | null, expected: ReadonlyArray<string>): boolean =>
  origin !== null && expected.includes(origin);

/**
 * Vérifie une requête mutante.
 *
 * `expectedOrigins` sont les origines **exactes** de la PWA, tirées de la
 * configuration. Aucun motif, aucune liste blanche laxiste : une entrée de trop
 * est une porte ouverte, et une de moins casse l'envoi.
 */
export const guardMutation = (
  request: Pick<RouteRequest, "headers" | "json">,
  expectedOrigins: ReadonlyArray<string>,
): GuardVerdict => {
  const origin = request.headers.get("origin");

  // 1. Origine. Une requête simple (formulaire, `<img>`, `<script>`) n'en
  //    envoie pas : c'est précisément le vecteur à fermer.
  if (origin === null || origin.length === 0) {
    return { ok: false, reason: "origin-absente", status: 403 };
  }
  if (!isAllowedOrigin(origin, expectedOrigins)) {
    // Les deux origines sont rapportées : celles attendues viennent de la
    // configuration, celle reçue vient du navigateur. Les nommer suffit à
    // corriger la configuration sans avoir à reproduire la requête.
    return {
      attendue: expectedOrigins.join(" | "),
      ok: false,
      recue: origin,
      reason: "origin-etrangere",
      status: 403,
    };
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
export const describeGuardRejection = (
  reason: GuardRejection,
  attendue?: string,
  recue?: string | null,
): string => {
  switch (reason) {
    case "origin-absente":
      return "missing origin: likely cross-site request";
    case "origin-etrangere":
      // ⚠️ Les deux origines sont **dites**. Sans elles, l'utilisateur ne peut
      // que deviner entre « mauvaise configuration » et « autre appareil », et la
      // correction demande de reproduire la requête.
      return `unauthorized origin (expected ${attendue ?? "?"}, received ${recue ?? "?"})`;
    case "methode":
      return "method not allowed on this route";
    case "content-type":
      return "Content-Type attendu : application/json";
    case "corps-trop-grand":
      return `corps trop grand (maximum ${String(MAX_JSON_BYTES)} octets)`;
    default:
      return "request refused";
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
