/**
 * La mise à jour de la PWA, **différée et explicite** (C21, T060).
 *
 * ⚠️ **Le défaut mesuré.** `controllerchange` rechargeait la page tout seul :
 * un brouillon en cours de frappe disparaissait, un envoi « incertain »
 * cessait d'être affiché. Recharger est destructeur, donc ça ne peut pas être
 * une surprise.
 *
 * Ces tests portent sur la **règle** (qui peut attendre et pourquoi) et sur le
 * **geste** (un seul worker, un seul `SKIP_WAITING`, un rechargement seulement
 * quand nous l'avons demandé). Aucun navigateur : la `registration` est un faux
 * de trois lignes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  appliquerMiseAJour,
  blocageDeMiseAJour,
  doitRecharger,
  miseAJourEnAttente,
  oublieMiseAJour,
  peutAppliquer,
  signaleMiseAJour,
  souscrireMiseAJour,
  texteDeMiseAJour,
} from "../src/mise-a-jour.ts";

/**
 * Ce que le store utilise d'une registration : **le worker en attente**.
 *
 * ⚠️ On ne fabrique pas une fausse `ServiceWorkerRegistration` complète : un
 * `as` sur un objet partiel est exactement le genre d'assertion que le lint
 * refuse (et qui masque une évolution du DOM). Le faux expose la seule forme
 * lue, et le store accepte cette forme structurelle.
 */
type RegistrationMinimale = Pick<ServiceWorkerRegistration, "waiting" | "installing">;

const workerFaux = (): { registration: RegistrationMinimale; recus: unknown[] } => {
  const recus: unknown[] = [];
  const worker = {
    postMessage: (message: unknown) => {
      recus.push(message);
    },
  };
  return { recus, registration: { waiting: worker } };
};

afterEach(() => {
  oublieMiseAJour();
});

describe("la règle : on ne recharge pas en perdant quelque chose", () => {
  test("sans brouillon ni envoi, la mise à jour peut s'appliquer", () => {
    expect(blocageDeMiseAJour({ brouillon: false, envoi: false })).toBe("aucune");
    expect(peutAppliquer({ brouillon: false, envoi: false })).toBe(true);
  });

  test("un brouillon bloque, et la phrase dit pourquoi", () => {
    expect(blocageDeMiseAJour({ brouillon: true, envoi: false })).toBe("brouillon");
    expect(peutAppliquer({ brouillon: true, envoi: false })).toBe(false);
    expect(texteDeMiseAJour("brouillon")).toContain("draft");
  });

  test("un envoi non résolu bloque PLUS qu'un brouillon", () => {
    // Le premier est peut-être parti, le second n'est pas parti du tout :
    // l'ordre est celui de la gravité, et il est explicite.
    expect(blocageDeMiseAJour({ brouillon: true, envoi: true })).toBe("envoi");
    expect(texteDeMiseAJour("envoi")).toContain("being sent");
  });
});

describe("le geste : un worker, un message, un rechargement demandé", () => {
  test("sans worker en attente, rien ne s'applique", () => {
    expect(miseAJourEnAttente()).toBe(false);
    expect(appliquerMiseAJour({ brouillon: false, envoi: false })).toBe(false);
    expect(doitRecharger()).toBe(false);
  });

  test("un brouillon présent : l'action est REFUSÉE, aucun message ne part", () => {
    const { recus, registration } = workerFaux();
    signaleMiseAJour(registration);
    expect(miseAJourEnAttente()).toBe(true);
    expect(appliquerMiseAJour({ brouillon: true, envoi: false })).toBe(false);
    expect(recus).toHaveLength(0);
    // Le worker reste en attente : on pourra réessayer une fois le brouillon
    // vidé — la mise à jour n'est pas perdue.
    expect(miseAJourEnAttente()).toBe(true);
    expect(doitRecharger()).toBe(false);
  });

  test("sans brouillon : SKIP_WAITING part, et le rechargement est demandé", () => {
    const { recus, registration } = workerFaux();
    signaleMiseAJour(registration);
    expect(appliquerMiseAJour({ brouillon: false, envoi: false })).toBe(true);
    expect(recus).toEqual([{ type: "SKIP_WAITING" }]);
    // ⚠️ `doitRecharger()` passe à vrai UNIQUEMENT ici : un `controllerchange`
    // subi ne rechargera pas.
    expect(doitRecharger()).toBe(true);
    expect(miseAJourEnAttente()).toBe(false);
  });

  test("le store notifie ses abonnés, et le désabonnement coupe", () => {
    let notifications = 0;
    const desabonner = souscrireMiseAJour(() => {
      notifications += 1;
    });
    const { registration } = workerFaux();
    signaleMiseAJour(registration);
    expect(notifications).toBe(1);
    desabonner();
    oublieMiseAJour();
    expect(notifications).toBe(1);
  });

  test("une registration sans worker en attente n'annonce rien", () => {
    // `waiting` null : ce n'est pas une mise à jour, il n'y a rien à proposer.
    signaleMiseAJour({ waiting: null, installing: null });
    expect(miseAJourEnAttente()).toBe(false);
  });
});
