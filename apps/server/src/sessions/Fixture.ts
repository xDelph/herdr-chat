/**
 * Fixture de session — **synthétique**, jamais une session réelle (P01).
 *
 * ⚠️ **Pourquoi une fixture et pas une vraie session.** Une mesure de
 * performance faite sur une session de travail contient le travail : texte
 * privé, chemins,et autre. Elle ne peut pas être versionnée, et surtout elle ne
 * peut pas être rejouée par quelqu'un d'autre. Une fixture générée donne la
 * même taille, la même forme et le même nombre d'entrées à chaque exécution.
 *
 * ⚠️ **Déterministe.** Le générateur est amorcé par `graine` : deux executions
 * donnent le même fichier, octet pour octet. Une mesure reproductible exige
 * une entrée reproductible — sinon chaque relevé compare deux conversations
 * différentes.
 *
 * La forme suit le schéma de `blocks.ts` : `message.content` en tableau de
 * blocs, `usage.cost`, `timestamp`. Une fixture qui ne ressemble pas à une
 * ligne réelle mesurerait un chemin que l'application n'emprunte jamais.
 */
import { writeFileSync } from "node:fs";

/** Générateur congruentiel simple : suffisant, et lisible. */
const generer = (graine: number): (() => number) => {
  let etat = graine >>> 0;
  return () => {
    // 1664525 : le multiplicateur de Numerical Recipes. LCG a une période
    // courte, mais une fixture n'a pas besoin de qualité cryptographique —
    // seulement d'être reproductible.
    etat = (Math.imul(1664525, etat) + 1013904223) >>> 0;
    return etat / 0x1_0000_0000;
  };
};

const MOTS = [
  "contrat",
  "lecture",
  "session",
  "curseur",
  "opaque",
  "rafraîchissement",
  "fenêtre",
  "octets",
  "décodage",
  "rendu",
  "accessibilité",
  "focus",
  "feuille",
  "verdict",
  "catalogne",
  "résultat",
  "erreur",
  "cause",
  "vérification",
  "mesure",
  "référence",
  "p95",
  "repli",
  "état",
] as const;

const PHRASES = [
  "Le chemin critique passe par le serveur, jamais par le contenu de la session.",
  "Une mesure sans méthode n'est pas une mesure, c'est une impression.",
  "Le filtre réduit la liste ; il ne choisit rien.",
  "Rien ne part sans avoir été vérifié, et le refus est écrit.",
  "Le composeur reste hors du conteneur défilant, sinon le clavier se bat avec le fil.",
  "Un identifiant interne n'aide jamais personne à comprendre ce qu'il regarde.",
  "La coupure conserve le fil et le brouillon : c'est la règle, pas l'intention.",
  "Un événement nommé prouve que le flux vit ; un `message` seul ne prouve rien.",
  "Le plafond existe pour que la liste reste lisible, pas pour gonfler le nombre.",
  "La zone sûre du bas garde le champ au-dessus de la barre du téléphone.",
  "Un état qu'on ne sait pas nommer doit se voir, pas disparaître en silence.",
  "Le rebond du cycle de focus empêche `Tab` de sortir de la feuille.",
] as const;

const OUTILS = ["read", "edit", "bash", "grep", "webfetch"] as const;

/** Phrase d'une longueur à peu près stable, tirée de la graine. */
const phrase = (hasard: () => number): string => {
  const mots: string[] = [];
  for (let i = 0; i < 18; i += 1) {
    mots.push(MOTS[Math.floor(hasard() * MOTS.length)] ?? "mot");
  }
  return mots.join(" ");
};

/** Un échange complet : demande, réponse de l'agent, appel d'outil, résultat. */
const echange = (index: number, hasard: () => number): readonly unknown[] => {
  const demande = PHRASES[index % PHRASES.length] ?? "travail en cours";
  return [
    {
      content: [{ text: `${demande} (${String(index)})`, type: "text" }],
      id: `msg-${String(index)}-u`,
      role: "user",
      timestamp: `2024-03-05T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
      type: "message",
    },
    {
      message: {
        content: [
          { thinking: phrase(hasard), type: "thinking" },
          { text: `${demande}\n\n${phrase(hasard)}`, type: "text" },
          {
            arguments: { path: `/dev/projets/pixel/src/fichier-${String(index % 12)}.ts` },
            id: `call-${String(index)}`,
            name: OUTILS[index % OUTILS.length] ?? "read",
            type: "toolCall",
          },
        ],
        model: "gpt-5",
        role: "assistant",
        stopReason: "toolUse",
        usage: { cost: { total: 0.01 + (index % 40) / 1000 }, totalTokens: 400 + (index % 900) },
      },
      id: `msg-${String(index)}-a`,
      timestamp: `2024-03-05T08:${String(index % 60).padStart(2, "0")}:02.000Z`,
      type: "message",
    },
    {
      message: {
        content: [
          {
            output: phrase(hasard),
            toolCallId: `call-${String(index)}`,
            toolName: OUTILS[index % OUTILS.length] ?? "read",
          },
        ],
        role: "toolResult",
        toolName: OUTILS[index % OUTILS.length] ?? "read",
      },
      id: `msg-${String(index)}-r`,
      parentId: `msg-${String(index)}-a`,
      timestamp: `2024-03-05T08:${String(index % 60).padStart(2, "0")}:03.000Z`,
      type: "message",
    },
  ];
};

export interface Fixture {
  /** Entrées écrites. */
  readonly entrees: number;
  /** Taille réelle du fichier, en octets. */
  readonly octets: number;
  /** Graine utilisée — à reporter dans le relevé. */
  readonly graine: number;
}

/**
 * Écrit une session synthétique d'au moins `octetsCibles` octets dans `chemin`.
 *
 * On **compte les octets écrits** au lieu de prévoir une taille : une constante
 * « octets par entrée » se désaligne dès qu'un bloc change de forme, et le
 * fichier obtenu dérive de la référence sans que rien ne le signale. Ici l'écart
 * tient à un échange, et `Fixture.test.ts` le vérifie.
 */
export const ecrireFixture = (
  chemin: string,
  octetsCibles: number,
  graine = 20_240_305,
): Fixture => {
  const hasard = generer(graine);
  const lignes: string[] = [];
  let octets = 0;
  for (let i = 0; octets < octetsCibles; i += 1) {
    for (const entree of echange(i, hasard)) {
      const ligne = `${JSON.stringify(entree)}\n`;
      octets += Buffer.byteLength(ligne, "utf8");
      lignes.push(ligne);
    }
  }
  const contenu = lignes.join("");
  writeFileSync(chemin, contenu, "utf8");
  return { entrees: lignes.length, octets, graine };
};

/** Taille de référence du tableau : 1,8 Mo de session réelle. */
export const TAILLE_REFERENCE = 1_800_000;
