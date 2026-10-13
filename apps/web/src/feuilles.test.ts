/**
 * Filtres, feuilles et retours (U09).
 *
 * Les trois clauses du contrat sont des faits d'**arbre**, pas d'apparence :
 *
 * - filtre ≠ sélection ;
 * - brouillon et position conservés quand une feuille s'ouvre ;
 * - retour d'un fichier vers la liste de fichiers.
 *
 * La matière est en place depuis U06 et U11. Ces tests la verrouillent : sans
 * eux, une réécriture de `ChatScreen` pourrait reintroduire le défaut en
 * déplaçant les feuilles dans une condition qui englobe le fil — et rien ne le
 * verrait tant que personne n'aurait ouvert un fichier en plein milieu d'une
 * conversation.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const chat = readFileSync(join(import.meta.dir, "ChatScreen.tsx"), "utf8");
const model = readFileSync(join(import.meta.dir, "ModelSheet.tsx"), "utf8");

/**
 * Le bloc d'un élément, de sa balise ouvrante à la balise fermante qui lui
 * correspond.
 *
 * On ne peut pas se contenter de l'index de l'attribut : il tombe à l'intérieur
 * de la balise, et le comptage des `<div>` se faux. On recule jusqu'à la balise,
 * puis on descend en comptant l'imbrication.
 */
const blocDe = (source: string, classe: string): string => {
  const attribut = source.indexOf(`className="${classe}"`);
  if (attribut < 0) throw new Error(`élément .${classe} absent`);
  const ouverture = source.lastIndexOf("<", attribut);
  let profondeur = 0;
  for (let i = ouverture; i < source.length; i += 1) {
    if (source.startsWith("<div", i)) profondeur += 1;
    if (source.startsWith("</div>", i)) {
      profondeur -= 1;
      if (profondeur === 0) return source.slice(ouverture, i + 6);
    }
  }
  throw new Error(`bloc .${classe} non fermé`);
};

describe("U09 — filtrer ne choisit pas", () => {
  test("le filtre du modèle ne touche pas la sélection", () => {
    const champ = model.slice(
      model.indexOf("value={filter}"),
      model.indexOf("value={filter}") + 700,
    );
    const fin = champ.indexOf("/>");
    const gestionnaire = fin < 0 ? champ : champ.slice(0, fin);
    expect(gestionnaire).toContain("setFilter");
    expect(gestionnaire).not.toContain("setChosen");
  });

  test("la sélection se fait dans le menu, pas dans le filtre", () => {
    expect(model).toContain("onChange={(event) => choisirModele(event.currentTarget.value)}");
    expect(model).toContain("setModeleChoisi(value)");
  });

  test("le filtre porte sur l'identifiant, en minuscules", () => {
    // Le filtre de la feuille de lancement cherche aussi dans le libellé ; celui
    // d'un agent déjà lancé cherche dans l'identifiant. Deux règles, deux
    // écrans : c'est assumé, et chacune est vérifiée.
    expect(model).toContain("candidate.id.toLowerCase().includes(filter.trim().toLowerCase())");
  });
});

describe("U09 — ouvrir une feuille ne perd ni le fil ni le brouillon", () => {
  /**
   * Le fil n'est placé sous **aucune** condition de feuille.
   *
   * ⚠️ Deux formes sont à éviter, et le test doit couvrir les deux :
   *
   * - la condition **à l'intérieur** du fil (`{showFiles ? … }` dans le bloc) ;
   * - la condition **à l'extérieur**, qui l'enferme (`{showFiles ? null : <div
   *   className="messages">…`).
   *
   * La seconde est celle qui casse le brouillon et la position de défilement, et
   * c'est la seule qui se voie : `{showFiles ?` est forcément juste avant la
   * balise d'ouverture, donc dans les 120 caractères qui la précèdent.
   */
  test("le fil n'est sous aucune condition de feuille", () => {
    const fil = blocDe(chat, "messages");
    for (const drapeau of ["openFile", "showFiles", "showModel"]) {
      expect(fil).not.toContain(drapeau);
      const avant = chat.slice(
        Math.max(0, chat.lastIndexOf("<", chat.indexOf('className="messages"')) - 120),
        chat.indexOf('className="messages"'),
      );
      expect(avant).not.toContain(drapeau);
    }
  });

  test("le composeur non plus", () => {
    const composeur = blocDe(chat, "composer");
    for (const drapeau of ["openFile", "showFiles", "showModel"]) {
      expect(composeur).not.toContain(drapeau);
    }
  });

  test("un envoi optimiste garde le texte visible dans l'historique", () => {
    // Le composeur est vidé après création du message local; son contenu reste
    // visible et annulable dans le fil pendant la confirmation.
    expect(chat).toContain('state: "queued", text');
    expect(chat).toContain("message.text");
    expect(chat).toContain("annulerEnvoi(message)");
  });
});

describe("U09 — le retour d'un fichier mène à la liste", () => {
  test("la visionneuse s'ouvre depuis la liste après sa fermeture animée", () => {
    expect(chat).toContain("onOpenFile={setFichierEnAttente}");
    expect(chat).toContain("fermeture={fichierEnAttente !== null}");
    expect(chat).toContain("setFromFiles(true)");
    expect(chat).toContain("setOpenFile(fichierEnAttente)");
  });

  test("le bouton de retour n'existe que si l'on vient de la liste", () => {
    const retour = chat.slice(
      chat.indexOf("onBack={"),
      chat.indexOf("/>", chat.indexOf("onBack={")),
    );
    expect(retour).toContain("fromFiles");
    expect(retour).toContain("setShowFiles(true)");
  });

  test("fermer la visionneuse ne laisse pas le drapeau levé", () => {
    // Sans cette remise à zéro, l'ouverture suivante par un bloc de la
    // conversation offrirait un retour vers une liste qui n'a jamais été
    // ouverte.
    expect(chat.split("setFromFiles(false)").length - 1).toBeGreaterThanOrEqual(2);
  });
});
