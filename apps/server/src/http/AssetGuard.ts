/**
 * Confinement des assets web à la racine du build (S05).
 *
 * Le serveur sert la PWA compilée et retombe sur `index.html` pour les routes
 * SPA. Ce repli est nécessaire — sans lui, un rechargement sur
 * `#/agent/...` servirait une 404 — mais il rend la fuite facile : un chemin
 *Absent doit tomber sur `index.html`, pas sur le disque entier.
 *
 * Deux erreurs classiques, et ce module les évite :
 *
 * 1. **Comparaison par préfixe de chaîne.** `"/build-evil/x".startsWith("/build")`
 *    est vrai alors que `/build-evil` est un dossier **frère** du build. Le
 *    même piège que dans `PathGuard`, donc la même règle : comparaison par
 *    segments, jamais `startsWith`.
 *
 * 2. **Lien symbolique sortant.** Un build peut contenir un lien vers
 *    `~/.ssh`. Sans résolution, le fichier servi est hors du build. On
 *    résout avant de servir, exactement comme pour les sessions (S03).
 */
import { realpath } from "node:fs/promises";
import { sep } from "node:path";

/** `true` si `candidate` est `root` lui-même ou l'un de ses descendants. */
export const isWithin = (root: string, candidate: string): boolean => {
  const r = root.endsWith(sep) ? root.slice(0, -1) : root;
  const c = candidate.endsWith(sep) ? candidate.slice(0, -1) : candidate;
  if (c === r) return true;
  return c.startsWith(`${r}${sep}`);
};

/**
 * Confine un chemin d'URL à la racine du build.
 *
 * `pathname` est décodé : `%2e%2e%2f` est `../` une fois interprété par le
 * système de fichiers. On normalise **après** décodage, sinon un encodage
 * passe entre les deux.
 *
 * Renvoie `undefined` si le chemin sort de la racine — l'appelant sert alors
 * `index.html`, ce qui ne livre aucun contenu hors du build.
 */
export const resolveAsset = async (root: string, pathname: string): Promise<string | undefined> => {
  // Le décodage peut **lancer** sur un `%` isolé (`/%`). Le handler ne doit
  // pas tomber : un chemin illisible vaut « pas un asset », donc `index.html`.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const joined = joinWithin(root, decoded);
  if (joined === undefined) return undefined;

  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return undefined;
  }

  let realCandidate: string;
  try {
    realCandidate = await realpath(joined);
  } catch {
    // Fichier absent : ce n'est pas un asset, l'appelant sert `index.html`.
    return undefined;
  }

  return isWithin(realRoot, realCandidate) ? realCandidate : undefined;
};

/** `join` canonique, ou `undefined` si la sortie quitte `root`. */
const joinWithin = (root: string, pathname: string): string | undefined => {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const escaped: Array<string> = [];
  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      // Remonter au-delà de la racine n'est jamais légitime pour un asset.
      if (escaped.length === 0) return undefined;
      escaped.pop();
      continue;
    }
    escaped.push(segment);
  }
  const candidate = [root, ...escaped].join(sep);
  return isWithin(root, candidate) ? candidate : undefined;
};
