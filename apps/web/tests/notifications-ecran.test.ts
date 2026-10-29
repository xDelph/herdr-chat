/** Les notifications d'écran : une erreur reste, le reste part seul. */
import { describe, expect, test } from "bun:test";
import { DUREE_MS, MAX_VISIBLES, creeMagasinNotifications } from "../src/notifications-ecran.ts";

const horloge = () => {
  const taches: Array<{ quand: number; action: () => void; annulee: boolean }> = [];
  let maintenant = 0;
  return {
    avance: (ms: number) => {
      maintenant += ms;
      for (const tache of taches) {
        if (!tache.annulee && tache.quand <= maintenant) {
          tache.annulee = true;
          tache.action();
        }
      }
    },
    planifie: (action: () => void, delai: number) => {
      const tache = { action, annulee: false, quand: maintenant + delai };
      taches.push(tache);
      return () => {
        tache.annulee = true;
      };
    },
  };
};

describe("notifications d'écran", () => {
  test("un succès part seul, une erreur reste jusqu'à ce qu'on la ferme", () => {
    const h = horloge();
    const magasin = creeMagasinNotifications(h.planifie);
    magasin.annonce("ok", "Pane affiché sur le Mac.");
    const erreur = magasin.annonce("erreur", "method not allowed on this route");
    h.avance(DUREE_MS);
    expect(magasin.liste().map((n) => n.ton)).toEqual(["erreur"]);
    h.avance(DUREE_MS * 10);
    expect(magasin.liste()).toHaveLength(1);
    magasin.ferme(erreur);
    expect(magasin.liste()).toHaveLength(0);
  });

  test("une même annonce ne s'empile pas, et l'écran ne se couvre pas", () => {
    const magasin = creeMagasinNotifications(horloge().planifie);
    magasin.annonce("erreur", "refus");
    magasin.annonce("erreur", "refus");
    expect(magasin.liste()).toHaveLength(1);
    for (let n = 0; n < MAX_VISIBLES + 2; n += 1) magasin.annonce("erreur", `cause ${String(n)}`);
    expect(magasin.liste()).toHaveLength(MAX_VISIBLES);
  });
});
