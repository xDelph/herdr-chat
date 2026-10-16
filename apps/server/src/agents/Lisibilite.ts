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
 * | opencode | oui     | `kind: id` + base SQLite      | **oui**         |
 * | devin    | oui     | `kind: id` + base SQLite      | **oui**         |
 * | codex    | oui     | `kind: id` ×2 (voir ci-dessous) | **oui**        |
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
 * ⚠️ **Correction du 2026-10-13, Herdr 0.9.3, protocole 22.** La première mesure
 * concluait que codex n'exposait « rien ». Elle était **fausse**. Refaite sur un
 * agent codex réellement utilisé, Herdr expose :
 *
 * ```
 * agent_session: { source: "herdr:codex", kind: "id", value: "01a13437-…" }
 * ```
 *
 * Ce n'est pas un `path`, donc l'ancienne lecture l'ignorait — mais cet
 * identifiant est **exactement** celui du nom de fichier de codex
 * (`~/.codex/sessions/<date>/rollout-<horodatage>-<id>.jsonl`). La leçon, et elle
 * vaut au-delà de codex : **« pas de chemin » n'est pas « pas de session »**. Un
 * `kind` inattendu est une question de forme, pas une preuve d'illisibilité, et
 * la seule façon de trancher est d'aller regarder le disque.
 *
 * Pour ajouter un type : démarrer un agent de ce type dans un pane jetable,
 * vérifier **sur le disque** que la session se lit, puis l'ajouter ici **avec la
 * date et la version de Herdr**. Sans ces deux éléments, l'entrée est une
 * hypothèse.
 *
 * ⚠️ **Correction du 2026-10-16, opencode 2.0.23.** La colonne « session
 * lisible » disait `non` pour opencode, au motif que « sa session est dans une
 * base ». C'était la **troisième** fois que le même raisonnement se trompait, et
 * la leçon est la même que pour codex : *« pas de fichier » n'est pas « pas de
 * contenu »*. Mesuré dans `opencode.db` : 1 931 lignes, dont 1 879 messages
 * (`user` 48 + `assistant` 1 831), avec le texte, la réflexion, les appels
 * d'outils et leurs sorties. L'identifiant qu'Herdr expose est **la clé
 * primaire** de `session_v2` — il n'y a rien à déduire, là où codex demandait de
 * retrouver un nom de fichier.
 *
 * ⚠️ Cette liste ne dit pas « le type est installé », elle dit « ce qu'il
 * produit est lisible ». `opencode` y entre parce que la lecture existe
 * (`OpencodeReader`), pas parce qu'on l'espère.
 */

/** Types vérifiés : Herdr expose pour eux un chemin de session que l'on peut lire. */
export const TYPES_A_SESSION_LISIBLE: ReadonlySet<string> = new Set([
  "pi",
  "codex",
  "opencode",
  "devin",
]);

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
