/**
 * Les erreurs connues du démon, **en français** — la cause brute reste lisible.
 *
 * ⚠️ Le démon TS répond en anglais (`no usable session path for this agent`),
 * et l'écran affichait la phrase telle quelle au milieu d'une interface
 * française. On traduit ce qu'on reconnaît ; la phrase d'origine suit, sur sa
 * propre ligne (`Cause : …`) — c'est elle qu'on cherche dans le journal. Ce qui
 * n'est pas reconnu passe tel quel : une cause inconnue n'est jamais remplacée
 * par un texte inventé.
 */

const CONNUES: ReadonlyArray<readonly [RegExp, (correspondance: RegExpExecArray) => string]> = [
  [
    /^no usable session path for this agent$/i,
    () => "Herdr n'expose pas de session lisible pour cet agent",
  ],
  [
    /^no Herdr agent in pane (.+)$/i,
    (m) => `Herdr ne connaît pas d'agent dans le pane ${m[1] ?? ""}`,
  ],
  [/^unreadable Herdr snapshot/i, () => "L'état d'Herdr est illisible"],
  [
    /^unreadable (Herdr )?(response|result|send result|launch result)/i,
    () => "Réponse d'Herdr illisible",
  ],
  [/^this project no longer exists$/i, () => "Ce projet n'existe plus dans Herdr"],
  [/^agent type not installed: (.+)$/i, (m) => `Type d'agent non installé : ${m[1] ?? ""}`],
  [/^agent types unavailable/i, () => "Les types d'agents installés sont illisibles"],
  [
    /^the session changed; reload the conversation/i,
    () => "La session a changé : rouvrez la conversation",
  ],
  [
    /^invalid (previous-page )?cursor$/i,
    () => "Repère de lecture périmé : la conversation va être relue",
  ],
  [
    /^(missing origin|unauthorized origin)/i,
    () => "Le démon a refusé la requête (origine non autorisée)",
  ],
  [/^route inconnue$/i, () => "Le démon ne connaît pas cette adresse (version plus ancienne ?)"],
  [/^(Load failed|Failed to fetch|NetworkError)/i, () => "Démon injoignable"],
  [
    /^the server produced a response outside the contract$/i,
    () => "Le démon a produit une réponse hors contrat",
  ],
];

/** Le texte à afficher : la traduction, puis la cause brute sur sa ligne. */
export const erreurLisible = (brut: string): string => {
  const texte = brut.trim();
  for (const [motif, traduit] of CONNUES) {
    const correspondance = motif.exec(texte);
    if (correspondance !== null) return `${traduit(correspondance)}\nCause : ${texte}`;
  }
  return texte;
};
