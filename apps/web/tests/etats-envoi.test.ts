/**
 * Les états d'envoi et de confiance, un par un (U08).
 *
 * Chaque test vérifie qu'une phrase du contrat tient : états **distincts**,
 * `transmise` **distinct** de « accordée », et aucune action qui promettrait ce
 * que l'écran ne sait pas.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expliquerConfiance,
  expliquerEchec,
  expliquerEnvoi,
  expliquerSuppression,
  libelleRefus,
} from "../src/etats-envoi.ts";

describe("U08 — les trois échecs se distinguent", () => {
  test("attente : le message est peut-être parti, on renvoie", () => {
    const e = expliquerEchec("attente", "aucune réponse en 5 s");
    expect(e.texte).toContain("may have gone through");
    // L'action distingue ce cas des deux autres : renvoyer, pas retaper.
    expect(e.action).toBe("Retry");
  });

  test("erreur : Herdr a refusé, rien n'est parti, on corrige", () => {
    const e = expliquerEchec("erreur", "prompt trop long");
    expect(e.texte).toContain("Send rejected");
    expect(e.texte).toContain("prompt trop long");
    expect(e.action).toBe("Edit message");
  });

  test("inconnu : ni Herdr n'a dit oui, ni non — le renvoi dit son risque", () => {
    const e = expliquerEchec("inconnu", "connexion coupée");
    expect(e.texte).toContain("delivery unknown");
    // ⚠️ Le texte et le bouton disent la même chose : la bulle montrait un
    // bouton pendant que le texte annonçait « aucune action ». Le renvoi existe,
    // et il nomme le doublon possible.
    expect(e.action).toBe("Send again (may arrive twice)");
  });

  test("hors ligne : rien n'est parti, et le texte ne dit pas « à temps »", () => {
    const e = expliquerEchec("hors-ligne", "");
    expect(e.texte).toBe("Offline: nothing was sent.");
    expect(e.texte).not.toContain("may have");
    expect(e.action).toBe("Retry");
  });

  test("les trois textes ne partagent aucun préfixe", () => {
    // Un préfixe commun ferait qu'une capture d'écran ne dise pas lequel des
    // trois cas s'est produit.
    const textes = (["attente", "erreur", "inconnu"] as const).map(
      (etat) => expliquerEchec(etat, "détail").texte,
    );
    for (const un of textes) {
      for (const autre of textes) {
        if (un === autre) continue;
        expect(un.startsWith(autre)).toBe(false);
        expect(autre.startsWith(un)).toBe(false);
      }
    }
  });

  test("les actions sont distinctes là où il y en a une", () => {
    const actions = (["attente", "erreur", "inconnu"] as const).map(
      (etat) => expliquerEchec(etat, "détail").action,
    );
    expect(new Set(actions).size).toBe(3);
  });
});

describe("U08 — aucun envoi n'est annoncé sans preuve", () => {
  test("confirmé : on peut le dire", () => {
    expect(expliquerEnvoi("confirmed").texte).toBe("Sent, delivery confirmed by Herdr");
  });

  test("non confirmé : la nuance reste, et elle se voit", () => {
    const e = expliquerEnvoi("unknown");
    expect(e.texte).toContain("delivery not confirmed");
    // Pas de « envoyé » nu : c'est la promesse que rien ne prouve.
    expect(e.texte).not.toBe("Sent");
  });

  test("un double envoi est un état normal, pas une alerte — et pas un envoi", () => {
    const e = expliquerSuppression("identique au précédent");
    expect(e.texte).toContain("Not sent: identical to a message delivered");
    expect(e.texte).toContain("identique au précédent");
    expect(e.action).toBeNull();
  });
});

describe("U08 — « transmise » n'est pas « accordée »", () => {
  test("transmise : la carte reste, et le mot reste", () => {
    const issue = expliquerConfiance("transmise");
    expect(issue.resolue).toBe(false);
    expect(issue.texte).toContain("has not confirmed it yet");
  });

  test("transmise ne se lit jamais comme un accord", () => {
    const issue = expliquerConfiance("transmise");
    // ⚠️ Pas une simple absence du mot : il est présent, **négaté**. Ce qui
    // compte est que la négation le précède — « ce n'est pas accordée » ne peut
    // pas se lire comme un accord, contrairement à un « peut-être accordée ».
    expect(issue.texte).toContain("has not confirmed it yet");
    // Et surtout pas la formule vacillante, qui se lirait comme un accord.
    expect(issue.texte).not.toContain("granted");
  });

  test("acceptée : seule issue qui libère l'écran", () => {
    expect(expliquerConfiance("acceptee").resolue).toBe(true);
  });

  test("refusée : une décision, pas une panne", () => {
    const issue = expliquerConfiance("refusee");
    expect(issue.resolue).toBe(true);
    expect(issue.texte).toContain("nothing was written");
  });

  /*
    ⚠️ **Refuser arrête l'agent** — les deux familles mesurées l'écrivent :
    codex `2. Quit`, claude `No, exit`. Le texte disait seulement « nothing was
    written » et laissait croire que l'agent restait bloqué.
  */
  test("refusée : le texte dit que l'agent s'arrête", () => {
    expect(expliquerConfiance("refusee").texte).toContain("stopped");
  });

  test("non applicable : rien à demander", () => {
    expect(expliquerConfiance("non-applicable").resolue).toBe(true);
  });

  test("un état inconnu ne vaut jamais un accord", () => {
    const issue = expliquerConfiance("bientot-disponible");
    expect(issue.resolue).toBe(false);
    // La prudence coûte un écran qui reste ouvert ; l'inverse costait une
    // permission permanente supposée donnée.
    expect(issue.texte).toContain("unknown state");
  });

  test("les quatre états connus donnent quatre textes différents", () => {
    const textes = ["acceptee", "refusee", "transmise", "non-applicable"].map(
      (etat) => expliquerConfiance(etat).texte,
    );
    expect(new Set(textes).size).toBe(4);
  });
});

/**
 * Le libellé du refus dit sa conséquence (U08).
 *
 * ⚠️ Le défaut : le bouton disait « Deny », et un commentaire affirmait que
 * l'agent restait bloqué. En réalité l'option de refus **quitte** l'agent dans
 * les deux familles mesurées (`2. Quit`, `No, exit`). Un libellé qui cache un
 * arrêt est un piège.
 */
describe("U08 — le libellé du refus dit ce que le refus fait", () => {
  test("il nomme la famille et l'arrêt", () => {
    const libelle = libelleRefus("claude");
    expect(libelle).toContain("claude");
    expect(libelle.toLowerCase()).toContain("stop");
  });

  test("sans famille connue, il reste lisible plutôt que troué", () => {
    expect(libelleRefus(null)).toBe("Deny and stop the agent");
  });
});

/**
 * Le câblage, vérifié sur sa source (U08).
 *
 * ⚠️ Le défaut n'était pas dans ces fonctions : il était dans `api.ts`, qui
 * **décodait** `state` depuis la réponse du serveur puis **le jetait**. Ces
 * tests ferment cette porte-là : sans eux, la prochaine refonte du client
 * pourrait rendre `transmise` de nouveau invisible.
 */
const lire = (...chemin: string[]) =>
  readFileSync(join(import.meta.dir, "..", "src", ...chemin), "utf8");

describe("U08 — la décision ne se perd plus en route", () => {
  const api = lire("api.ts");
  const gestes = lire("app", "gestes.ts");

  test("`answerTrust` renvoie l'état lu, pas seulement un booléen", () => {
    expect(api).toContain("state: decoded.state");
  });

  test("une réponse illisible n'est lue ni comme un accord ni comme un refus", () => {
    expect(api).toContain('detail: "unreadable response", state: "inconnu"');
  });

  test("l'issue d'une confiance passe par `expliquerConfiance`, jamais par `accepted`", () => {
    expect(gestes).toContain("expliquerConfiance(resultat.state)");
    // L'ancien code se fiait à `accepted`, ce qui faisait d'un refus de Herdr
    // un « accord » affiché.
    expect(gestes).not.toContain("resultat.accepted");
  });

  test("un envoi sans confirmation n'est jamais annoncé comme envoyé", () => {
    const feuille = lire("feuilles", "Modele.tsx");
    expect(feuille).toContain("expliquerEnvoi(resultat.confirmation).texte");
    expect(feuille).toContain("expliquerEchec(resultat.state, resultat.message).texte");
  });
});
