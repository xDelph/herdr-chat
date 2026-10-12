/**
 * Causes de lecture — quatre états **distincts** (B03).
 *
 * ⚠️ Ces quatre cas se ressemblent de loin, et les confondre produit soit une
 * erreur rouge en boucle, soit — pire — une vue qui ment.
 *
 * | Cause            | Sens                                   | HTTP |
 * |------------------|----------------------------------------|------|
 * | `absente`        | le fichier n'existe pas encore          | 200, vide |
 * | `vide`           | le fichier existe, zéro entrée          | 200, vide |
 * | `invalide`       | contenu illisible ou ligne tronquée     | 422 |
 * | `io`             | permission, disque, erreur du système   | 502 |
 *
 * `absente` n'est **pas** une panne : Herdr annonce un `agent_session` valide
 * vers un fichier que Pi n'a pas encore créé (le JSONL naît au premier
 * message). Le traiter comme une erreur faisait échouer l'ouverture de tout
 * nouvel agent, en boucle toutes les deux secondes — c'est le défaut que
 * `isMissingFile` corrige, sans le nommer.
 *
 * Distinguer `absente` de `vide` n'est pas cosmétique : `absente` doit être
 * rejoué sans alarme, `vide` signifie « l'agent n'a rien dit ». Les confondre
 * fait crier une session simplement neuve.
 */
export type ReadCause = "absente" | "vide" | "invalide" | "io";

export interface ReadVerdict {
  readonly cause: ReadCause;
  /** Message destiné à l'utilisateur. Distinct pour chaque cause. */
  readonly message: string;
  /** `true` seulement pour `absente` et `vide` : rien ne va mal. */
  readonly benign: boolean;
}

const VERDICTS: Record<ReadCause, Omit<ReadVerdict, "cause">> = {
  absente: { benign: true, message: "session absente" },
  vide: { benign: true, message: "session vide" },
  invalide: { benign: false, message: "session illisible" },
  io: { benign: false, message: "session inaccessible" },
};

export const verdictOf = (cause: ReadCause): ReadVerdict => ({ cause, ...VERDICTS[cause] });

/** Codes d'E/S qui signifient « le fichier n'existe pas ». */
const MISSING_CODES = new Set(["ENOENT"]);

/** Codes d'E/S qui signifient « le fichier existe mais on ne peut pas le lire ». */
const DENIED_CODES = new Set(["EACCES", "EPERM", "ELOOP"]);

/**
 * Classe une erreur de lecture.
 *
 * La distinction se fait sur le **code** d'E/S quand il existe, et sur le type
 * d'erreur sinon — jamais sur le message, qui varie selon la plateforme.
 */
export const classifyReadFailure = (error: unknown): ReadVerdict => {
  const code = readCode(error);

  // Le fichier n'existe pas encore : ce n'est pas une panne.
  if (code !== undefined && MISSING_CODES.has(code)) {
    return verdictOf("absente");
  }
  // Permission ou boucle de liens : le fichier existe, on ne peut pas le lire.
  if (code !== undefined && DENIED_CODES.has(code)) {
    return verdictOf("io");
  }
  if (code !== undefined) {
    return verdictOf("io");
  }

  // Un refus de chemin (S03) a déjà sa cause et son propre 403 : on ne le
  // requalifie pas ici, sinon la distinction s'effacerait.
  if (isPathRejection(error)) {
    return { benign: false, cause: "io", message: error.detail };
  }

  return verdictOf("io");
};

/**
 * Une session **existante** mais dont on ne peut pas interpréter le contenu.
 *
 * Distinguée de `io` : une ligne tronquée ou un JSON altéré n'est pas une panne
 * du serveur, et le message doit le dire — sinon l'utilisateur croit à une
 * panne réseau et relance inutilement.
 */
export const invalidSession = (detail: string): ReadVerdict => ({
  benign: false,
  cause: "invalide",
  message: `session illisible (${detail})`,
});

const readCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === "string") return nested;
  }
  return undefined;
};

const isPathRejection = (
  error: unknown,
): error is { readonly _tag: "SessionPathRejected"; readonly detail: string } =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: unknown })._tag === "SessionPathRejected";

/** Statut HTTP correspondant : une absence n'est pas une erreur. */
export const statusFor = (cause: ReadCause): number => {
  switch (cause) {
    case "absente":
    case "vide":
      return 200;
    case "invalide":
      return 422;
    case "io":
      return 502;
    default:
      return 502;
  }
};
