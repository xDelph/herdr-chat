/**
 * Attacher la méthode HTTP sans perdre la requête (S02 — correction).
 *
 * ⚠️ **Pourquoi ce module existe.** `Bun.serve({ routes })` donne un gestionnaire
 * par chemin, et la méthode n'y figure pas. Le correctif naturel est
 * `{ ...request, method: request.method ?? "GET" }` — et il ne fonctionne pas.
 *
 * Sur un `Request`, `url`, `headers` et `json` sont des **accesseurs du
 * prototype**, pas des propriétés propres : un `Request` n'a littéralement
 * aucune clé propre. L'objet obtenu est donc vide, et toute route qui lit l'URL,
 * les en-têtes ou le corps lève une exception.
 *
 * ⚠️ **Ce que ça donnait.** `/api/health` et `/api/overview` ne lisent aucun de
 * ces champs : ils répondaient 200. La session et l'envoi, eux, renvoyaient 500.
 * Une panne qui n'apparaît que sur l'écran qui l'utilise, et qui laisse le
 * reste de l'application sembler sain — le pire endroit possible pour un défaut.
 * Et le serveur tournait depuis la veille : ce code n'avait jamais été exécuté.
 */
import type { RouteRequest, Routes } from "./Reply.ts";

/**
 * Ce que Bun livre réellement au gestionnaire.
 *
 * ⚠️ Ce n'est **pas** un `RouteRequest`. Les paramètres de motif sont absents
 * sur une route exacte, et rien ne garantit que `params` soit là. Le décrire
 * ici évite une transformation de type dans le seul endroit où la requête est
 * reinterpretée.
 */
export interface RequeteEntrante {
  readonly headers: { get(name: string): string | null };
  readonly json: () => Promise<unknown>;
  readonly method?: string;
  readonly params?: Record<string, string | undefined>;
  readonly url: string;
}

/**
 * Recopie la requête en exposant ce que les routes lisent.
 *
 * On ne spread pas : on **décrit** chaque champ, par accesseur, pour que la
 * valeur vienne de la requête d'origine à l'instant de la lecture.
 */
export const avecMethode = (request: RequeteEntrante): RouteRequest => ({
  get headers() {
    return request.headers;
  },
  json: () => request.json(),
  get method() {
    return request.method ?? "GET";
  },
  get params() {
    return request.params ?? {};
  },
  get url() {
    return request.url;
  },
});

/**
 * Les mêmes routes, mais les requêtes requêtes sont celles de Bun.
 *
 * Déclaré à part de `Routes` : le gestionnaire d'entrée reçoit une
 * `RequeteEntrante`, et c'est `avecMethode` qui la rend conforme. Annoter le
 * résultat avec `Routes` ferait croire que Bun livre déjà un `RouteRequest`.
 */
export type RoutesEntree = {
  readonly [chemin: string]: (request: RequeteEntrante) => Response | Promise<Response>;
};

/**
 * Enveloppe chaque route pour que la méthode soit disponible.
 *
 * Sans cela, le 405 serait impossible : le gestionnaire ne sait pas si la
 * requête est un `GET` ou un `POST` (S02).
 */
export const avecMethodePourRoutes = (routes: Routes): RoutesEntree =>
  Object.fromEntries(
    Object.entries(routes).map(([chemin, route]) => [
      chemin,
      (request: RequeteEntrante) => route(avecMethode(request)),
    ]),
  );
