/**
 * Choix de lancement — **vérifiés avant la requête** (U06).
 *
 * Ce module ne connaît ni React ni le réseau : il dit si un choix est
 * envoyable, et pourquoi pas. L'interface ne fait que le montrer. C'est ce
 * qui rend la règle testable : « un choix incompatible bloque l'envoi » est une
 * phrase qu'on peut exécuter, pas une intention.
 *
 * ⚠️ **Filtrer n'est pas sélectionner.** C'était le défaut principal : le champ
 * de recherche écrivait dans l'état du modèle, donc taper « gpt » sélectionnait
 * un modèle qui s'appelait « gpt ». Ici le filtre et la sélection sont deux
 * valeurs distinctes, et `modelesVisibles` ne fait que lire le filtre.
 *
 * ⚠️ **Rien n'est vérifié par déduction.** Un niveau de raisonnement sans
 * modèle ne peut pas être validé — on ne sait pas ce que le modèle accepte. Le
 * verdict est alors « non », avec la cause, plutôt qu'un choix plausible envoyé
 * à un agent qui le refusera.
 */
import type { AgentModel, ModelCatalog } from "./api.ts";

/** Au-delà, la liste déroulante devient inutilisable à la main. */
export const MAX_MODELES_AFFICHES = 200;

/** Au-delà, un champ de filtre devient nécessaire. */
export const SEUIL_FILTRE = 80;

/**
 * Modèle et niveau de raisonnement choisis au lancement.
 *
 * Les deux propriétés sont **facultatives et sans valeur nulle** : une chaîne
 * vide aurait un autre sens et briserait la distinction « non choisi » contre
 * « choisi mais vide ». Le serveur fait la même lecture.
 */
export interface LaunchChoice {
  readonly model?: string;
  readonly thinking?: string;
}

/**
 * Verdict de validation.
 *
 * Union **fermée** : impossible d'oublier un troisième cas, et impossible
 * d'ignorer `raison` quand l'envoi est refusé. Un booléen nu
 * (`peutLancer: boolean`) ferait écran à l'explication.
 */
export type VerdictLancement =
  | { readonly envoyable: true; readonly choix: LaunchChoice }
  | { readonly envoyable: false; readonly raison: string };

/** Libellé lisible d'un niveau de raisonnement. */
export const levelLabel = (level: string): string => {
  switch (level) {
    case "off":
      return "off";
    case "minimal":
      return "minimal";
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "extra high";
    case "max":
      return "maximum";
    case "ultra":
      return "ultra";
    default:
      return level;
  }
};

/**
 * Modèles correspondant à un filtre — **sans toucher à la sélection**.
 *
 * La recherche porte sur l'identifiant *et* le libellé : la liste affiche
 * « libellé · identifiant », donc chercher sur l'un seulement laisserait
 * invisibles des modèles présents à l'écran.
 *
 * Insensible à la casse et aux espaces de bord : « GPT » et « gpt » sont le
 * même modèle, et une espace finale ne doit pas vider la liste.
 */
export const modelesVisibles = (
  catalog: ModelCatalog,
  filtre: string,
): ReadonlyArray<AgentModel> => {
  const recherche = filtre.trim().toLowerCase();
  if (recherche.length === 0) return catalog.models;
  return catalog.models.filter(
    (modele) =>
      modele.id.toLowerCase().includes(recherche) ||
      (modele.label ?? "").toLowerCase().includes(recherche),
  );
};

/** Faut-il un champ de filtre ? Au-delà du seuil, la liste est inutilisable. */
export const filtreUtile = (catalog: ModelCatalog): boolean => catalog.models.length > SEUIL_FILTRE;

/**
 * Le choix est-il vérifiable, et donc envoyable ?
 *
 * Trois refus, tous dans le même sens : **on n'envoie pas ce qu'on n'a pas pu
 * vérifier**.
 *
 * 1. un niveau de raisonnement sans modèle — les niveaux acceptés dépendent du
 *    modèle, il n'y a donc rien à quoi comparer ;
 * 2. un modèle sans catalogue lisible — l'agent refusera un identifiant
 *    inventé, et le serveur répondrait 400 sans dire lequel ;
 * 3. un modèle ou un niveau absent du catalogue — c'est le cas du filtre mal
 *    utilisé comme sélection, et d'un agent qui a changé de catalogue entre
 *    deux ouvertures.
 */
export const verifierLancement = ({
  catalog,
  kind,
  model,
  thinking,
}: {
  /** `null` tant que le catalogue n'est pas lu, ou s'il n'a pas pu l'être. */
  readonly catalog: ModelCatalog | null;
  /** Type d'agent affiché, pour que le refus nomme ce qu'il refuse. */
  readonly kind: string;
  readonly model: string;
  readonly thinking: string;
}): VerdictLancement => {
  const choix: LaunchChoice = {
    ...(model.length > 0 ? { model } : {}),
    ...(thinking.length > 0 ? { thinking } : {}),
  };

  // Rien choisi : l'agent part avec ses propres valeurs. C'est un choix, pas
  // une absence de vérification.
  if (model.length === 0 && thinking.length === 0) {
    return { envoyable: true, choix: {} };
  }

  if (thinking.length > 0 && model.length === 0) {
    return {
      envoyable: false,
      raison:
        "Thinking level requires a model because supported levels depend on the selected model.",
    };
  }

  if (catalog === null) {
    return {
      envoyable: false,
      raison: `unreadable ${kind} catalog: “${model}” cannot be verified.`,
    };
  }

  const nombre = catalog.models.length;
  const trouve = catalog.models.find((candidat) => candidat.id === model);
  if (trouve === undefined) {
    return {
      envoyable: false,
      raison:
        nombre === 0
          ? `no verified model for ${catalog.kind}: “${model}” cannot be confirmed.`
          : `“${model}” is not among the ${nombre} verified models of ${catalog.kind}.`,
    };
  }

  if (thinking.length > 0 && !trouve.thinkingLevels.includes(thinking)) {
    const acceptes = trouve.thinkingLevels;
    return {
      envoyable: false,
      raison:
        acceptes.length === 0
          ? `“${model}” declares no reasoning level.`
          : `« ${thinking} » n'est pas un niveau de « ${model} » (${acceptes.join(", ")}).`,
    };
  }

  return { envoyable: true, choix };
};
