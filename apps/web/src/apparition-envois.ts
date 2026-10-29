/**
 * Quand une bulle d'envoi peut-elle disparaître ? Quand la session porte **ce**
 * message — pas un message identique plus ancien.
 *
 * ⚠️ **Le défaut (P1).** La bulle comptait les messages identiques déjà dans
 * l'historique au moment de l'envoi (`baseline`), puis disparaissait dès que la
 * session en portait un de plus. Envoyé avant la première page, l'historique
 * était vide : la bulle partait dès que la page — ou une page plus ancienne
 * chargée en remontant — contenait le même texte, envoyé la veille. Le message
 * n'était pas arrivé, et plus rien ne le montrait.
 *
 * ⚠️ **La règle : seul ce qui est arrivé APRÈS l'envoi compte.**
 *
 * - un message horodaté compte s'il est postérieur à l'envoi (à une petite
 *   tolérance d'horloge près, téléphone et Mac ne sont pas synchronisés à la
 *   milliseconde) ;
 * - un message sans horodatage compte s'il est placé **après** le dernier
 *   message connu à l'envoi — jamais dans l'historique ajouté au-dessus.
 *
 * Chaque message ne vaut que pour un envoi : deux envois identiques attendent
 * deux messages.
 *
 * ⚠️ Un doublon évité (`suppressed`) n'est jamais oublié ici : rien n'est
 * parti, seul l'utilisateur ferme sa bulle.
 */

/** Écart d'horloge toléré entre le téléphone et l'horodatage de la session. */
export const TOLERANCE_HORLOGE_MS = 5_000;

export interface MessageLu {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly at: string | null;
}

export interface EnvoiAttendu {
  readonly id: string;
  readonly text: string;
  readonly state: string;
  /** Instant de l'envoi, horloge du téléphone. */
  readonly creeA: number;
  /** Le dernier message connu à l'envoi, ou `null` s'il n'y en avait aucun. */
  readonly apres: string | null;
}

/** Les envois dont la session porte désormais le message — à oublier. */
export const envoisApparus = (
  messages: ReadonlyArray<MessageLu>,
  envois: ReadonlyArray<EnvoiAttendu>,
): ReadonlyArray<string> => {
  const pris = new Set<number>();
  const apparus: string[] = [];
  for (const envoi of envois) {
    if (envoi.state === "suppressed") continue;
    const indexApres =
      envoi.apres === null ? -1 : messages.findIndex((message) => message.id === envoi.apres);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message === undefined || pris.has(index)) continue;
      if (message.role !== "user" || message.text !== envoi.text) continue;
      const instant = message.at === null ? Number.NaN : Date.parse(message.at);
      const arriveApres = Number.isFinite(instant)
        ? instant >= envoi.creeA - TOLERANCE_HORLOGE_MS
        : // Sans horodatage : la position seule. Un repère disparu (reset) ne
          // prouve rien — on n'oublie pas sur une supposition.
          envoi.apres === null || (indexApres >= 0 && index > indexApres);
      if (!arriveApres) continue;
      pris.add(index);
      apparus.push(envoi.id);
      break;
    }
  }
  return apparus;
};
