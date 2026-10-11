/**
 * Limites de ressources — **source unique** (S06).
 *
 * ⚠️ Ces nombres étaient écrits en clair à quatre endroits, et deux ne
 * correspondaient pas au tableau des « Règles déjà tranchées » : la session
 * lisait 256 Kio par défaut là où le contrat en annonce 512, et le plafond
 * `?tail` laissait passer 4 Mio. Un décalage de ce genre ne se voit pas — il se
 * sent sur l'iPhone, quand le chat met deux secondes à s'ouvrir.
 *
 * Toute valeur qui change ici impose de modifier **le même changement** le
 * contrat partagé, les vérifications, et la documentation.
 */

/** Charge utile JSON maximale d'une requête mutante. */
export const MAX_JSON_BYTES = 64 * 1024;

/** Prompt UTF-8 maximal, en octets — pas en caractères. */
export const MAX_PROMPT_BYTES = 32 * 1024;

/** Taille maximale d'un fichier de projet servi. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/** Flux SSE simultanés. Au-delà, on refuse : le Mac ne suivrait pas. */
export const MAX_SSE_STREAMS = 8;

/** Lectures de session simultanées, pour la liste des conversations. */
export const MAX_SESSION_READS = 4;

/**
 * Fenêtre de lecture initiale d'une session.
 *
 * 512 Kio, et non 256 : sur une session réelle de 1,8 Mo, 512 Kio donnent 138
 * messages au premier écran pour 0,02 s de plus que 256 (D013.3). Le plancher
 * vaut pour ce que l'écran affiche, pas pour ce que le disque contient.
 */
export const SESSION_TAIL_BYTES = 512 * 1024;

/** Plafond absolu de `?tail=`. Au-delà, on rabat sur la fenêtre standard. */
export const SESSION_TAIL_HARD_CAP = 512 * 1024;

/** Aperçu d'une ligne de conversation : 64 Kio suffisent largement. */
export const PREVIEW_BYTES = 64 * 1024;

/** Délai d'une commande de catalogue de modèles. */
export const MODEL_CATALOG_TIMEOUT_MS = 20_000;

/** Sortie maximale d'une commande de catalogue. */
export const MODEL_CATALOG_STDOUT_BYTES = 2 * 1024 * 1024;

/** Erreur maximale d'une commande de catalogue. */
export const MODEL_CATALOG_STDERR_BYTES = 64 * 1024;

/** Durée de mise en cache d'un catalogue réussi. */
export const MODEL_CATALOG_CACHE_MS = 60_000;

/** Fenêtre de suppression d'un envoi identique au précédent. */
export const DUPLICATE_WINDOW_MS = 60_000;

/** Taille du tampon de l'en-tête de session. */
export const SESSION_HEADER_BYTES = 64 * 1024;

/** Taille d'une zone tactile, en pixels CSS. */
export const MIN_TAP_TARGET_PX = 44;

/** Contraste minimal du texte normal. */
export const MIN_TEXT_CONTRAST = 4.5;

/** Taille d'un octet en UTF-8 : un emoji en occupe quatre. */
export const byteLengthUtf8 = (text: string): number => Buffer.byteLength(text, "utf8");
