/**
 * Les erreurs connues du démon, **expliquées** — la cause brute reste lisible.
 *
 * ⚠️ Le démon répond par une phrase technique (`no usable session path for this
 * agent`). On explique ce qu'on reconnaît, en anglais comme toute l'interface
 * (T072) ; la phrase d'origine suit, sur sa propre ligne (`Cause: …`) — c'est
 * elle qu'on cherche dans le journal. Ce qui n'est pas reconnu passe tel quel :
 * une cause inconnue n'est jamais remplacée par un texte inventé.
 *
 * ⚠️ Le démon Rust a parlé français avant de passer à l'anglais : un motif qui
 * reconnaît une phrase du démon accepte **les deux** formes, pour qu'un démon
 * plus ancien reste compris.
 */

/** Le corps d'un 404 du démon pour une adresse qu'il ne connaît pas. */
const ROUTE_INCONNUE = /^(route inconnue|unknown route)$/i;

/** La route demandée n'existe pas sur ce démon (ancienne ou nouvelle phrase). */
export const estRouteInconnue = (erreur: string): boolean => ROUTE_INCONNUE.test(erreur.trim());

const CONNUES: ReadonlyArray<readonly [RegExp, (correspondance: RegExpExecArray) => string]> = [
  [
    /^no usable session path for this agent$/i,
    () => "Herdr exposes no readable session for this agent",
  ],
  [
    /^no Herdr agent in (?:pane (.+)|this pane)$/i,
    (m) =>
      m[1] === undefined
        ? "Herdr knows no agent in this pane"
        : `Herdr knows no agent in pane ${m[1]}`,
  ],
  [/^unreadable Herdr snapshot/i, () => "Herdr's state is unreadable"],
  [
    /^unreadable (Herdr )?(response|result|send result|launch result)/i,
    () => "Unreadable response from Herdr",
  ],
  [/^this project no longer exists$/i, () => "This project no longer exists in Herdr"],
  [/^agent type not installed: (.+)$/i, (m) => `Agent type not installed: ${m[1] ?? ""}`],
  [/^agent types unavailable/i, () => "The installed agent types are unreadable"],
  [
    /^the session changed; reload the conversation/i,
    () => "The session changed: reopen the conversation",
  ],
  [
    /^invalid (previous-page )?cursor$/i,
    () => "Stale read position: the conversation will be reloaded",
  ],
  // Le démon Rust : « curseur refusé : … » puis « cursor rejected: … ».
  [/^(curseur refusé|cursor rejected)\b/i, () => "The daemon rejected the read position"],
  [
    /^(missing origin|unauthorized origin)/i,
    () => "The daemon rejected the request (origin not allowed)",
  ],
  [ROUTE_INCONNUE, () => "The daemon does not know this address (older version?)"],
  [/^(Load failed|Failed to fetch|NetworkError)/i, () => "Daemon unreachable"],
  [
    /^the server produced a response outside the contract$/i,
    () => "The daemon produced a response outside the contract",
  ],
];

/** Le texte à afficher : la traduction, puis la cause brute sur sa ligne. */
export const erreurLisible = (brut: string): string => {
  const texte = brut.trim();
  for (const [motif, traduit] of CONNUES) {
    const correspondance = motif.exec(texte);
    if (correspondance !== null) return `${traduit(correspondance)}\nCause: ${texte}`;
  }
  return texte;
};
