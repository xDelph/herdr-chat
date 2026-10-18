/**
 * La porte de lisibilité (U14).
 *
 * Ces tests exécutent la règle « la PWA ne s'occupe que des agents dont on peut
 * lire la session ». La règle est volontairement **stricte** : un type non
 * vérifié est refusé. Ouvrir un agent muet est pire que de ne pas le proposer.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MESURE_SUR,
  sessionLisible,
  TYPES_A_SESSION_LISIBLE,
  typeLisible,
} from "../../src/agents/Lisibilite.ts";

describe("U14 — une session se lit quand elle a un chemin", () => {
  test("un chemin se lit", () => {
    expect(sessionLisible("/Users/x/.pi/agent/sessions/a.jsonl")).toBe(true);
  });

  test("aucun chemin ne se lit pas", () => {
    expect(sessionLisible(null)).toBe(false);
  });

  test("un chemin vide ne se lit pas", () => {
    // ⚠️ Herdr peut exposer une chaîne vide pour « pas encore de fichier ». La
    // lire produirait une erreur de chemin, pas une session vide.
    expect(sessionLisible("")).toBe(false);
  });

  /*
    Aucun test sur l'extension du fichier, **et c'est délibéré**.

    J'en avais écrit un qui rejetait un chemin sans `.jsonl`. Il était faux :
    Herdr n'expose jamais un dossier, et un agent futur pourrait écrire sa
    session dans un autre format. Filtrer sur l'extension reviendrait à
    deviner le format des autres agents — c'est le piège que Herdr nous épargne
    déjà en ne donnant qu'un chemin.
  */
});

describe("U14 — seuls les types vérifiés sont proposés", () => {
  test("pi est proposé : Herdr expose un fichier JSONL", () => {
    expect(typeLisible("pi")).toBe(true);
    expect(typeLisible("codex")).toBe(true);
  });

  test("opencode est ACCEPTÉ : une base SQLite se lit", () => {
    // ⚠️ Troisième fois que le meme raisonnement se trompait : « sa session est
    // dans une base » n'est pas « sa session est illisible ». Mesure du
    // 2026-10-16 dans `opencode.db` : 1 879 messages lisibles.
    expect(typeLisible("opencode")).toBe(true);
  });

  test("devin est ACCEPTÉ : une base SQLite se lit", () => {
    // ⚠️ QUATRIEME fois que le meme raisonnement se trompait : « un identifiant
    // opaque » n'est pas « pas de session ». Mesure du 2026-10-16 dans
    // `~/.local/share/devin/cli/sessions.db` : 163 messages dans `message_nodes`,
    // et l'identifiant qu'Herdr expose est la cle de `sessions`.
    expect(typeLisible("devin")).toBe(true);
  });

  test("codex est ACCEPTÉ : un identifiant vaut un chemin", () => {
    // ⚠️ Ce test affirmait l'inverse. La mesure de 2026-10-13 l'a démentie :
    // Herdr donne bien à codex un `kind: "id"`, et cet identifiant est celui du
    // fichier `~/.codex/sessions/**/rollout-*.jsonl`. « Pas de chemin » n'est
    // pas « pas de session » — c'était une erreur de lecture du produit.
    expect(typeLisible("codex")).toBe(true);
  });

  test("claude est ACCEPTÉ : un JSONL se lit", () => {
    // ⚠️ CINQUIEME fois. Le produit le classait « non concluant » : la sonde
    // etait tombee sur un ecran de connexion, et personne n'etait alle regarder
    // le disque. Mesure du 2026-10-16 : `~/.claude/projects/<dossier>/<uuid>.jsonl`,
    // treize types de lignes dont deux portent la conversation.
    expect(typeLisible("claude")).toBe(true);
  });

  test("cursor reste refusé : rien n'a été mesuré pour lui", () => {
    expect(typeLisible("cursor")).toBe(false);
  });

  test("un type inconnu est refusé, jamais supposé lisible", () => {
    // ⚠️ Le cas par défaut doit être « non ». Supposer qu'un agent inconnu est
    // lisible, c'est ouvrir un écran vide et appeler ça une conversation.
    expect(typeLisible("inconnu-du-marche")).toBe(false);
    expect(typeLisible("")).toBe(false);
  });

  test("les types refusés le sont tous, sans exception cachée", () => {
    // ⚠️ codex n'est plus dans cette liste, et c'est le seul changement.
    for (const kind of ["cursor", "agy", "gemini"]) {
      expect(typeLisible(kind)).toBe(false);
    }
  });
});

describe("U14 — la mesure est traçable", () => {
  test("la version de Herdr et la date sont notées", () => {
    // Sans elles, une entrée de cette liste est une hypothèse. C'est la seule
    // chose qui distingue « vérifié » de « supposé ».
    expect(MESURE_SUR.herdr).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MESURE_SUR.protocole).toBeGreaterThan(0);
    expect(MESURE_SUR.le).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("la liste n'est pas vide — sinon le produit est mort", () => {
    expect(TYPES_A_SESSION_LISIBLE.size).toBeGreaterThan(0);
  });
});

describe("U14 — la règle est appliquée par les deux chemins", () => {
  /*
    ⚠️ Test **sur la source**, donc fragile. Il est là parce que la version
    fonctionnelle ne l'attrape pas : `composerOverview` était testée et ne
    servait qu'un des deux chemins.

    Le test fonctionnel vérifie que la fonction filtre. Il ne vérifie pas que la
    route l'appelle. `/api/overview` a un chemin rapide (cache du veilleur) et
    un chemin lent (snapshot relu) ; le filtre n'était appliqué qu'au lent, donc
    presque jamais — les agents muets réapparaissaient toutes les 15 secondes.

    C'est la forme exacte du défaut « contrat dupliqué qui diverge » : deux
    chemins, une règle écrite deux fois, la seconde oubliée.
  */
  const api = readFileSync(join(import.meta.dir, "..", "..", "src", "http", "Api.ts"), "utf8");

  test("le chemin rapide compose par la fonction unique", () => {
    expect(api).toContain("composerOverview({");
    // Le cache brut ne doit plus être renvoyé tel quel.
    expect(api).not.toContain("agents: cached,");
    expect(api).not.toContain("toWorkspaceViews(snapshot.workspaces, cached");
  });

  test("aucun chemin ne recompte les agents masqués de son côté", () => {
    // Un second `filter(... sessionPath === null)` serait une deuxième règle.
    expect(api).not.toContain("withoutSession: cached.filter");
  });

  test("le filtre de type est appliqué au menu comme au lancement", () => {
    // B07 : le menu et le refus de lancement doivent porter sur la même liste.
    const occurrences = api.split("typeLisible(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
