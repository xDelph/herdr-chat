/**
 * Branche git d'un dossier de travail.
 *
 * ⚠️ **Pourquoi une commande.** Herdr n'expose aucune information de branche :
 * ni le snapshot, ni `worktree` (`checkout_path`, `repo_root`, `repo_name`)
 * n'en portent. Il n'y a donc pas d'autre source que git lui-même.
 *
 * ⚠️ **Ce que cette commande n'est pas.** `git rev-parse --abbrev-ref HEAD` est
 * en **lecture seule**, ne touche à aucun index et n'écrit rien. Le dossier est
 * celui du projet, déjà validé par Herdr — jamais un chemin venu du client.
 *
 * Le résultat est mis en cache : une branche change quand on change de branche,
 * pas toutes les quatre secondes, et la liste se rafraîchit à cette cadence.
 */
import { Effect } from "effect";

/** Sortie maximale lue. Une réponse de git tient en quelques dizaines d'octets. */
const MAX_SORTIE = 4096;

/** Délai : un dépôt lent ne doit pas retenir la liste entière. */
const DELAI_MS = 3000;

/** Durée de vie du cache. Une branche ne change pas toutes les 4 s. */
const CACHE_MS = 30_000;

interface Entree {
  readonly lu: number;
  readonly valeur: string | undefined;
}

const cache = new Map<string, Entree>();

/**
 * Branche du dossier, ou `undefined`.
 *
 * `undefined` couvre trois cas qu'on ne cherche pas à distinguer : pas de
 * dépôt, délai dépassé, git absent. Aucun n'est une erreur pour la liste — la
 * troisième ligne affiche simplement moins de choses.
 */
export const brancheDe = (dossier: string): Effect.Effect<string | undefined> =>
  Effect.promise(async () => {
    const maintenant = Date.now();
    const connu = cache.get(dossier);
    if (connu !== undefined && maintenant - connu.lu < CACHE_MS) return connu.valeur;

    const branche = await lire(dossier);
    cache.set(dossier, { lu: maintenant, valeur: branche });
    return branche;
  });

const lire = async (dossier: string): Promise<string | undefined> => {
  try {
    const proc = Bun.spawn(["git", "-C", dossier, "rev-parse", "--abbrev-ref", "HEAD"], {
      stderr: "ignore",
      stdout: "pipe",
    });
    const minuterie = setTimeout(() => proc.kill(), DELAI_MS);
    const sortie = await new Response(proc.stdout).text();
    const code = await proc.exited;
    clearTimeout(minuterie);

    if (code !== 0) return undefined;
    const texte = sortie.trim().slice(0, MAX_SORTIE);
    if (texte.length === 0) return undefined;
    // `HEAD` détaché : git répond « HEAD », qui n'est pas une branche et
    // n'apprend rien.
    return texte === "HEAD" ? undefined : texte;
  } catch {
    // Git absent, dossier disparu, permission refusée : ce ne sont pas des
    // erreurs pour la liste, seulement une ligne plus courte.
    return undefined;
  }
};

/** Vide le cache — réservé aux tests, qui partagent le module. */
export const viderCacheBranches = (): void => {
  cache.clear();
};
