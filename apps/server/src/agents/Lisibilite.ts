/**
 * Ce que la PWA sait faire d'un agent — et seulement cela (U14).
 *
 * ⚠️ **Pourquoi cette porte existe.** Une conversation se lit dans un **fichier**
 * JSONL. Le lecteur n'a qu'un moyen d'y accéder : le chemin que Herdr expose. Un
 * agent qui n'expose pas de chemin n'est donc pas « moins bien supporté » — il
 * est **hors du produit**. L'ouvrir produirait un écran vide, ou une erreur
 * rouge, pour une conversation qui existe pourtant.
 *
 * Ce qui a été **mesuré** sur cette machine, avec un agent réellement démarré
 * dans un pane jetable pour chacun (Herdr 0.9.3, protocole 22) :
 *
 * | type     | démarre | ce qu'expose Herdr            | session lisible |
 * |----------|---------|-------------------------------|-----------------|
 * | pi       | oui     | `kind: path`, fichier `.jsonl` | **oui**          |
 * | opencode | oui     | `kind: id` + base SQLite      | non             |
 * | devin    | oui     | `kind: id` (`heavenly-…`)     | non             |
 * | codex    | oui     | rien, même après avoir        | non             |
 * |          |         | travaillé (`completion_seq`)  |                 |
 * | cursor   | oui     | rien                         | non             |
 * | claude   | écran de connexion — non concluant | — | inconnu |
 * | agy      | démarrage refusé         | —                             | inconnu         |
 *
 * ⚠️ **Ce n'est pas un inventaire, c'est une capacité vérifiée.** B07 avait
 * écrit une liste de onze types dont neuf n'étaient pas installés : le menu
 * proposait des agents inexistants. Ici la liste répond à une seule question —
 * « la session est-elle lisible ? » — et la réponse a été obtenue en lançant
 * l'agent, pas en supposant. Un type qui n'y figure pas n'est **pas déclaré
 * inexistant** : il est simplement non vérifié, et l'honnêteté consiste à ne pas
 * le proposer.
 *
 * Pour ajouter un type : démarrer un agent de ce type dans un pane jetable,
 * vérifier qu'Herdr expose un chemin, puis l'ajouter ici **avec la date et la
 * version de Herdr**. Sans ces deux éléments, l'entrée est une hypothèse.
 */

/** Types vérifiés : Herdr expose pour eux un chemin de session que l'on peut lire. */
export const TYPES_A_SESSION_LISIBLE: ReadonlySet<string> = new Set(["pi"]);

/** Herdr testé le jour de la mesure, et la version du protocole. */
export const MESURE_SUR = { herdr: "0.9.3", protocole: 22, le: "2026-10-12" } as const;

/**
 * Cette session est-elle lisible ?
 *
 * Un chemin vide ne compte pas : Herdr peut exposer une chaîne vide pour
 * « pas encore de fichier ». La distinction est dans le type, et c'est ce que la
 * lecture utilise.
 */
export const sessionLisible = (chemin: string | null): boolean =>
  chemin !== null && chemin.length > 0;

/**
 * Ce type d'agent est-il utilisable depuis la PWA ?
 *
 * Un type **installé** ne suffit pas : installé veut dire « le binaire est là »,
 * pas « on peut lire ce qu'il produit ». Les deux confondus, c'est promettre un
 * écran de conversation pour un agent qui n'en a pas.
 */
export const typeLisible = (kind: string): boolean => TYPES_A_SESSION_LISIBLE.has(kind);
