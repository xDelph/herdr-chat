/**
 * Le bloc « Working » commence **avec le statut**, pas avec la session.
 *
 * ⚠️ **Pourquoi ce test existe.** Les deux sources de vérité n'ont pas la même
 * latence, et c'est structurel :
 *
 * - le **statut** vient du flux Herdr : c'est un événement, il est immédiat ;
 * - le **contenu** vient du fichier de session JSONL : il faut que l'agent
 *   écrive sa première ligne, puis qu'un tour de rafraîchissement la lise.
 *
 * Entre les deux, l'écran restait muet — on ne savait pas si la demande était
 * arrivée, ni si l'agent avait commencé. Le correctif n'est pas de deviner : il
 * est d'afficher un bloc **vide**, qui dit seulement ce qui est vérifiable (« il
 * travaille ») et se remplit à l'arrivée des vrais appels.
 *
 * ⚠️ **Le risque de ce correctif est d'inventer des chiffres.** Un bloc vide n'a
 * ni horodatage ni jeton : les lui fabriquer afficherait « Working 3 s » mesuré
 * sur l'horloge de l'écran, pas sur le travail de l'agent. Une bonne partie de
 * ce fichier vérifie donc ce qui **n'est pas** affiché.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemsView } from "./Blocks.tsx";
import { avecTravailEnCours, ID_TRAVAIL_EN_COURS, toItems } from "./blocks.ts";
import type { Item, RenderedMessage } from "./blocks.ts";
import { coutDuGroupe, dureeEnMots } from "./actions.ts";

const message = (id: string, role = "assistant"): RenderedMessage => ({
  at: null,
  blocks: [],
  id,
  meta: {},
  role,
  text: "",
});

/** Un message seul, hors de tout travail : le cas d'une réponse déjà écrite. */
const prose = (id: string): Item => ({ kind: "single", message: message(id) });

/**
 * L'identité d'un élément.
 *
 * ⚠️ Les deux formes de `Item` ne portent pas le même champ d'identité — un
 * message a `message.id`, un groupe a `id`. Un test qui lit `item.id` ne compile
 * pas sur l'union, et c'est tant mieux : ça oblige à regarder laquelle on lit.
 */
const idDe = (item: Item | undefined): string =>
  item === undefined ? "" : item.kind === "tools" ? item.id : item.message.id;

/** Un groupe d'outils **déjà** constitué : le travail a commencé pour de bon. */
const groupe = (id: string): Item => ({
  callCount: 1,
  id,
  kind: "tools",
  messages: [message(`${id}:1`)],
  tools: [{ count: 1, name: "bash" }],
});

/**
 * Le dernier élément, exigé.
 *
 * ⚠️ `at(-1)` rend `T | undefined` : passer par une assertion de type ferait
 * taire le compilateur au lieu de vérifier. Ici on exige la présence, et le
 * message le dit.
 */
const dernier = (items: ReadonlyArray<Item>): Item => {
  const item = items.at(-1);
  if (item === undefined) throw new Error("attendu : au moins un élément");
  return item;
};

const rendu = (items: ReadonlyArray<Item>, enCours: boolean): string =>
  renderToStaticMarkup(createElement(ItemsView, { cwd: null, enCours, items }));

describe("le bloc de travail démarre avec le statut", () => {
  test("un agent qui travaille montre un bloc, même sans appel d'outil", () => {
    const items = avecTravailEnCours([prose("m1")], true);

    expect(items.length).toBe(2);
    expect(items.at(-1)?.kind).toBe("tools");
  });

  test("ce bloc se voit à l'écran, sous le nom « Working »", () => {
    // La preuve par le rendu, pas par la structure : c'est ce que l'écran dit.
    const html = rendu(avecTravailEnCours([prose("m1")], true), true);

    expect(html).toContain('class="group__titre">Working<');
  });

  test("un agent au repos n'ajoute rien", () => {
    const items = avecTravailEnCours([prose("m1")], false);

    expect(items.length).toBe(1);
    expect(items.at(-1)?.kind).toBe("single");
  });

  test("un travail déjà commencé n'est pas doublé", () => {
    // Le dernier élément est déjà un groupe d'outils : il porte son « Working ».
    const items = avecTravailEnCours([prose("m1"), groupe("travail:m2")], true);

    expect(items.length).toBe(2);
    expect(idDe(items.at(-1))).toBe("travail:m2");
  });

  test("une conversation vide ne reçoit pas de « Working »", () => {
    // L'état vide dit déjà sa cause ; un « Working » posé dessus le contredirait.
    expect(avecTravailEnCours([], true).length).toBe(0);
  });
});

describe("le bloc vide n'invente aucun chiffre", () => {
  const vide = dernier(avecTravailEnCours([prose("m1")], true));
  const cout = coutDuGroupe([]);

  test("aucun message, donc aucun appel, donc aucun outil", () => {
    expect(vide.kind).toBe("tools");
    if (vide.kind !== "tools") throw new Error("attendu : un groupe d'outils");

    expect(vide.messages.length).toBe(0);
    expect(vide.callCount).toBe(0);
    expect(vide.tools.length).toBe(0);
  });

  test("aucune durée : l'en-tête dit « Working », jamais « Working 0 s »", () => {
    expect(cout.dureeMs ?? 0).toBe(0);
    expect(dureeEnMots(cout.dureeMs ?? 0)).toBe("");

    const html = rendu([prose("m1"), vide], true);
    expect(html).toContain('class="group__titre">Working<');
  });

  test("aucun jeton : le compteur est absent, pas à zéro", () => {
    // « 0 » serait un chiffre, et un chiffre faux : on ne sait pas encore.
    expect(cout.jetons).toBeNull();

    const html = rendu([prose("m1"), vide], true);
    expect(html).not.toContain("group__jetons");
  });

  test("un bloc encore vide n'affiche aucun corps, et aucune phrase d'attente", () => {
    const html = rendu([prose("m1"), vide], true);

    // ⚠️ « No calls yet » s'affichait sous le « Working » du démarrage : un bloc
    // de deux lignes dont une pour dire qu'il n'y avait rien à dire. Un corps
    // vide n'a pas de corps.
    expect(html).not.toContain("group__body");
    expect(html).not.toContain("blk__hint");
    // L'en-tête, lui, est bien là : c'est tout l'objet du bloc.
    expect(html).toContain('class="group__titre">Working<');
  });

  test("un bloc sans contenu ne montre pas de chevron", () => {
    // Un chevron qui n'ouvre rien est un mensonge d'interface : il promet du
    // contenu et n'en donne pas.
    const html = rendu([prose("m1"), vide], true);

    expect(html).not.toContain("group__chevron");
    expect(html).toContain('aria-expanded="false"');
  });

  test("le bloc vide ne se déplie pas, mais reste le dernier élément", () => {
    const html = rendu([prose("m1"), vide], false);

    expect(html).not.toContain("group__body");
    expect(html).not.toContain("blk__hint");
    // ⚠️ Le titre reste « Worked » : c'est la même chose, vue après coup.
    expect(html).toContain('class="group__titre">Worked<');
  });
});

describe("le bloc vide et le premier vrai groupe ne se remplacent pas dans le dos", () => {
  test("l'identifiant est fixe : pas de remontage au premier appel d'outil", () => {
    // Un identifiant variable ferait démonter le bloc à l'arrivée du premier
    // appel : il se replierait et repartirait de zéro sous les yeux de l'utilisateur.
    const a = idDe(avecTravailEnCours([prose("m1")], true).at(-1));
    const b = idDe(avecTravailEnCours([prose("m1")], true).at(-1));

    expect(a).toBe(ID_TRAVAIL_EN_COURS);
    expect(a).toBe(b);
  });

  test("dès qu'un vrai groupe existe, le bloc vide disparaît", () => {
    const avecVide = avecTravailEnCours([prose("m1")], true);
    const avecGroupe = avecTravailEnCours([prose("m1"), groupe("travail:m2")], true);

    expect(avecVide.map(idDe)).toContain(ID_TRAVAIL_EN_COURS);
    expect(avecGroupe.map(idDe)).not.toContain(ID_TRAVAIL_EN_COURS);
  });

  test("le vrai groupe est bien celui que `toItems` produit", () => {
    // On ne suppose pas la forme : on vérifie qu'un tour d'outils se termine bien
    // par un groupe — celui-là même qui rend le bloc vide inutile.
    const items = toItems([message("u1", "user"), message("a1")], true);

    expect(items.at(-1)?.kind).toBe("tools");
    expect(avecTravailEnCours(items, true).length).toBe(items.length);
  });
});
