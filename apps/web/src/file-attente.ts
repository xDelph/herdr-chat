/**
 * Les demandes qui ATTENDENT dans la file de l'agent (Claude Code), lues dans
 * la session — quelle que soit leur origine (ce téléphone, le Mac).
 *
 * Le démon traduit chaque `queue-operation` de Claude en message `custom`
 * (`customType: "queue-operation"`, `details.operation`, texte) :
 * - `enqueue` : la demande entre dans la file ;
 * - `remove` : elle en sort, par son texte (absorbée en plein tour, ou remise) ;
 * - `dequeue` : la tête de file sort (sans texte), au début d'un tour.
 *
 * Ce qui reste est « en attente ». Rien n'est deviné : sans `enqueue` lu, rien
 * n'est affiché.
 */

export interface DemandeEnFile {
  readonly texte: string;
  readonly depuis: string | null;
}

interface EntreeBrute {
  readonly raw: string;
  readonly timestamp?: string | undefined;
}

const operationDe = (
  raw: string,
): { readonly operation: string; readonly texte: string } | undefined => {
  let valeur: unknown;
  try {
    valeur = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof valeur !== "object" || valeur === null) return undefined;
  const message: unknown = Reflect.get(valeur, "message");
  if (typeof message !== "object" || message === null) return undefined;
  if (Reflect.get(message, "customType") !== "queue-operation") return undefined;
  const details: unknown = Reflect.get(message, "details");
  const operation =
    typeof details === "object" && details !== null ? Reflect.get(details, "operation") : undefined;
  if (typeof operation !== "string") return undefined;
  const contenu: unknown = Reflect.get(message, "content");
  const texte = Array.isArray(contenu)
    ? contenu
        .map((bloc: unknown) =>
          typeof bloc === "object" && bloc !== null ? Reflect.get(bloc, "text") : undefined,
        )
        .filter((morceau): morceau is string => typeof morceau === "string")
        .join("")
    : "";
  return { operation, texte: texte.trim() };
};

/** `true` si l'entrée est une opération de file (à ne pas rendre comme message). */
export const estOperationDeFile = (raw: string): boolean => operationDe(raw) !== undefined;

/** Les demandes encore en file, dans l'ordre d'arrivée. */
export const demandesEnFile = (
  entries: ReadonlyArray<EntreeBrute>,
): ReadonlyArray<DemandeEnFile> => {
  const file: DemandeEnFile[] = [];
  for (const entree of entries) {
    const lue = operationDe(entree.raw);
    if (lue === undefined) continue;
    if (lue.operation === "enqueue" && lue.texte.length > 0) {
      file.push({ depuis: entree.timestamp ?? null, texte: lue.texte });
    } else if (lue.operation === "remove") {
      const index = file.findIndex((demande) => demande.texte === lue.texte);
      if (index >= 0) file.splice(index, 1);
    } else if (lue.operation === "dequeue") {
      file.shift();
    }
  }
  return file;
};
