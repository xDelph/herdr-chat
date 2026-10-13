/**
 * Confinement d'un chemin à une racine — **par segments**, après `realpath`.
 *
 * **Pourquoi ce module existe (S03).** Les sessions Pi sont lues depuis le
 * chemin que Herdr annonce dans `agent_session`. Ce chemin vient d'un service
 * externe : rien ne garantit qu'il reste sous `~/.pi/agent/sessions`. Sans
 * contrôle, un `agent_session` pointant vers `/etc/passwd` serait servi
 * comme une session, et `/Users/…/.ssh/id_rsa` lu comme une entrée JSONL.
 *
 * Deux erreurs classiques, et ce module les évite par construction :
 *
 * 1. **Comparer des chaînes.** `"/root/secrets".startsWith("/root")` est vrai
 *    alors que `/root/secrets` est **hors** de `/root`. La comparaison se fait
 *    donc segment par segment, jamais par préfixe de chaîne.
 *
 * 2. **Valider avant de résoudre.** Un lien symbolique est.lisible avant
 *    d'être résolu : vérifier la chaîne puis ouvrir l'original laisse une fenêtre
 *    de course. On `realpath` d'abord, **puis** on compare, **puis** on ouvre.
 *
 * La résolution se fait **avant** l'ouverture, et l'ouverture se fait sur le
 * chemin résolu : ce qui est ouvert est exactement ce qui a été validé.
 */
import { realpath } from "node:fs/promises";
import { sep } from "node:path";

/** Raison du refus. Chaque cause est distincte : « ne pas masquer l'erreur ». */
export type PathRejection = "racine-absente" | "chemin-absent" | "hors-racine" | "lien-sortant";

export interface PathVerdict {
  readonly ok: boolean;
  /** Chemin canonique réellement ouvert. Absent si refus. */
  readonly resolved?: string;
  readonly reason?: PathRejection;
}

/**
 * `true` si `candidate` est `root` lui-même ou l'un de ses descendants.
 *
 * Comparaison **par segments**, avec la racine comparée segment par segment
 * aussi — sinon `/a/b` accepterait `/a/bc`.
 */
export const isWithin = (root: string, candidate: string): boolean => {
  const r = root.endsWith(sep) ? root.slice(0, -1) : root;
  const c = candidate.endsWith(sep) ? candidate.slice(0, -1) : candidate;
  if (c === r) return true;
  return c.startsWith(`${r}${sep}`);
};

/**
 * Résout `candidate` et vérifie qu'il reste sous `root`.
 *
 * La racine est elle aussi résolue : elle peut contenir un lien symbolique
 * (sur macOS, `/tmp` est un lien vers `/private/tmp`, et `mkdtemp` en crée un
 * par dossier). Comparer un chemin résolu à une racine non résolue rejetterait
 * alors **tout** fichier légitime.
 *
 * Ne lève jamais : un refus est une valeur, pas une exception, pour que la
 * route puisse en faire une réponse 403 explicite avec sa cause.
 */
const resolveWithinUn = async (root: string, candidate: string): Promise<PathVerdict> => {
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    // Racine absente : rien n'est lisible, et la cause est distincte de « hors
    // racine » — sinon un typo de configuration se lirait comme une intrusion.
    return { ok: false, reason: "racine-absente" };
  }

  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch {
    // Le fichier peut légitimement ne pas exister encore : Pi crée le JSONL au
    // premier message (cf. `isMissingFile`). On compare donc le **parent**,
    // résolu lui aussi, pour décider si la racine est respectée.
    const parent = candidate.slice(0, candidate.lastIndexOf(sep)) || sep;
    try {
      const realParent = await realpath(parent);
      if (!isWithin(realRoot, realParent) && !isWithin(realRoot, realParent + sep)) {
        return { ok: false, reason: "hors-racine" };
      }
    } catch {
      return { ok: false, reason: "chemin-absent" };
    }
    return { ok: false, reason: "chemin-absent" };
  }

  if (!isWithin(realRoot, realCandidate)) {
    // Deux situations distinctes, et la différence est utile au diagnostic :
    // - le chemin **déclaré** est déjà hors racine (`../`, dossier frère) ;
    // - le chemin déclaré est dedans, mais il **pointe** ailleurs (lien
    //   symbolique). Dans ce cas la cible ne l'est pas, et l'absence de
    //   `realpath` aurait livré le fichier visé.
    const parent = candidate.slice(0, candidate.lastIndexOf(sep)) || sep;
    let declaredInside = false;
    try {
      declaredInside = isWithin(realRoot, await realpath(parent));
    } catch {
      declaredInside = false;
    }
    return { ok: false, reason: declaredInside ? "lien-sortant" : "hors-racine" };
  }

  return { ok: true, resolved: realCandidate };
};

/** Message destiné à l'utilisateur : une cause par refus, jamais générique. */
export const describeRejection = (reason: PathRejection): string => {
  switch (reason) {
    default:
      // Atteignable seulement si une cause est ajoutée au type sans son texte :
      // le dire vaut mieux que rendre `undefined` à l'appelant.
      return "path refused";
    case "racine-absente":
      return "sessions root not found";
    case "chemin-absent":
      return "missing session";
    case "hors-racine":
      return "session path outside the allowed root";
    case "lien-sortant":
      return "symlink escaping the allowed root";
  }
};

/**
 * Résout `candidate` et vérifie qu'il reste sous **l'une** des racines.
 *
 * ⚠️ **Pourquoi plusieurs racines.** Chaque agent a son propre dossier de
 * sessions : `~/.pi/agent/sessions` pour pi, `~/.codex/sessions` pour codex. Un
 * garde à racine unique refusait les sessions codex comme « hors racine » — un
 * refus de sûreté, pris à tort pour un défaut de format. Une racine unique
 * obligerait à choisir un agent.
 *
 * Un refus précis l'emporte sur « racine-absente » : une racine mal configurée
 * ne doit pas masquer une vraie sortie de périmètre.
 */
export const resolveWithin = async (
  roots: string | ReadonlyArray<string>,
  candidate: string,
): Promise<PathVerdict> => {
  const racines = typeof roots === "string" ? [roots] : roots;
  // Les racines sont indépendantes : les résoudre en parallèle évite de payer
  // un `realpath` après l'autre sur le chemin chaud de chaque lecture.
  const verdicts = await Promise.all(racines.map((racine) => resolveWithinUn(racine, candidate)));
  for (const verdict of verdicts) {
    if (verdict.ok) return verdict;
  }
  // Aucune racine ne convient. Un refus précis l'emporte sur « racine-absente » :
  // une racine mal configurée ne doit pas masquer une vraie sortie de périmètre.
  return (
    verdicts.find((verdict) => verdict.reason !== "racine-absente") ?? {
      ok: false,
      reason: "racine-absente",
    }
  );
};
