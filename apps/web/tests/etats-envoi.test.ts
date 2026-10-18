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
    expect(e.texte).toContain("may have been sent");
    // L'action distingue ce cas des deux autres : renvoyer, pas retaper.
    expect(e.action).toBe("Retry");
  });

  test("erreur : Herdr a refusé, rien n'est parti, on corrige", () => {
    const e = expliquerEchec("erreur", "prompt trop long");
    expect(e.texte).toContain("Send rejected");
    expect(e.texte).toContain("prompt trop long");
    expect(e.action).toBe("Edit message");
  });

  test("inconnu : ni Herdr n'a dit oui, ni non — et on n'agit pas", () => {
    const e = expliquerEchec("inconnu", "connexion coupée");
    expect(e.texte).toContain("status unknown");
    // ⚠️ Aucune action : renvoyer pourrait doubler le message, et c'est
    // exactement ce que l'écran ne sait pas trancher.
    expect(e.action).toBeNull();
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
    expect(expliquerEnvoi("confirmed").texte).toBe("Sent and confirmed by Herdr");
  });

  test("non confirmé : la nuance reste, et elle se voit", () => {
    const e = expliquerEnvoi("unknown");
    expect(e.texte).toContain("delivery is unconfirmed");
    // Pas de « envoyé » nu : c'est la promesse que rien ne prouve.
    expect(e.texte).not.toBe("Sent");
  });

  test("un double envoi est un état normal, pas une alerte", () => {
    const e = expliquerSuppression("identique au précédent");
    expect(e.texte).toContain("Duplicate send prevented");
    expect(e.action).toBeNull();
  });
});

describe("U08 — « transmise » n'est pas « accordée »", () => {
  test("transmise : la carte reste, et le mot reste", () => {
    const issue = expliquerConfiance("transmise");
    expect(issue.resolue).toBe(false);
    expect(issue.texte).toContain("has not confirmed");
  });

  test("transmise ne se lit jamais comme un accord", () => {
    const issue = expliquerConfiance("transmise");
    // ⚠️ Pas une simple absence du mot : il est présent, **négaté**. Ce qui
    // compte est que la négation le précède — « ce n'est pas accordée » ne peut
    // pas se lire comme un accord, contrairement à un « peut-être accordée ».
    expect(issue.texte).toContain("has not confirmed");
    // Et surtout pas la formule vacillante, qui se lirait comme un accord.
    expect(issue.texte).not.toContain("approved");
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
    expect(expliquerConfiance("refusee").texte).toContain("quit");
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
    expect(libelle.toLowerCase()).toContain("quit");
  });

  test("sans famille connue, il reste lisible plutôt que troué", () => {
    expect(libelleRefus(null)).toBe("Deny and quit the agent");
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
describe("U08 — la décision ne se perd plus en route", () => {
  const api = readFileSync(join(import.meta.dir, "..", "src", "api.ts"), "utf8");
  const carte = readFileSync(join(import.meta.dir, "..", "src", "TrustCard.tsx"), "utf8");

  test("`answerTrust` renvoie l'état lu, pas seulement un booléen", () => {
    expect(api).toContain("state: decoded.state");
  });

  test("une réponse illisible n'est lue ni comme un accord ni comme un refus", () => {
    expect(api).toContain('detail: "réponse illisible", state: "inconnu"');
  });

  test("la carte ne se sépare que d'un état résolu", () => {
    expect(carte).toContain("expliquerConfiance(outcome.state)");
    // L'ancien code disparaissait sur `accepted`, ce qui faisait d'un refus de
    // Herdr un « accord » affiché.
    expect(carte).not.toContain("outcome.accepted");
    expect(carte).not.toContain("else onDone()");
  });

  test("un envoi sans confirmation n'est jamais annoncé comme envoyé", () => {
    const feuille = readFileSync(join(import.meta.dir, "..", "src", "ModelSheet.tsx"), "utf8");
    expect(feuille).toContain("expliquerEnvoi(result.confirmation).texte");
    // Le retour à `échec : …` réaplatirait les trois états d'un coup.
    expect(feuille).not.toContain("`échec : ${result.message}`");
  });
});
