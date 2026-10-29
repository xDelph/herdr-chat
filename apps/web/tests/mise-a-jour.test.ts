/**
 * C21 — la mise à jour de la PWA n'est jamais destructive : aucune
 * activation de worker ne recharge la page d'elle-même, et l'offre
 * « recharger » n'apparaît qu'à une frontière sûre (ni brouillon, ni envoi
 * en attente). Le test cité par la matrice n'avait jamais existé.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { offreRechargement } from "../src/nouvelle-version.ts";

const RACINE = join(import.meta.dir, "..");

const sources = (dossier: string): ReadonlyArray<string> =>
  readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return sources(chemin);
    return /\.(ts|tsx|js)$/.test(nom) ? [chemin] : [];
  });

describe("mise à jour différée (C21)", () => {
  test("une nouvelle version n'est offerte qu'à une frontière sûre", () => {
    expect(offreRechargement({ brouillon: false, enAttente: false, nouvelle: true })).toBe(true);
    // Une frappe en cours : recharger effacerait le brouillon.
    expect(offreRechargement({ brouillon: true, enAttente: false, nouvelle: true })).toBe(false);
    // Un envoi en file ou à l'issue inconnue : recharger perdrait son état.
    expect(offreRechargement({ brouillon: false, enAttente: true, nouvelle: true })).toBe(false);
    // Rien de neuf : rien à offrir.
    expect(offreRechargement({ brouillon: false, enAttente: false, nouvelle: false })).toBe(false);
  });

  test("aucun changement de worker ne recharge la page tout seul", () => {
    // Le défaut C21 : `controllerchange` → `location.reload()` effaçait les
    // brouillons et l'état des envois en mémoire. Le seul rechargement est le
    // geste explicite de l'offre.
    const fichiers = [...sources(join(RACINE, "src")), join(RACINE, "public", "sw.js")];
    expect(fichiers.length).toBeGreaterThan(50);
    const ecouteurs = fichiers.filter((chemin) =>
      readFileSync(chemin, "utf8").includes("controllerchange"),
    );
    expect(ecouteurs).toEqual([]);
    const rechargements = fichiers.filter((chemin) =>
      /location\.reload\(/.test(readFileSync(chemin, "utf8")),
    );
    expect(rechargements.map((chemin) => chemin.slice(RACINE.length))).toEqual([
      "/src/ui/NouvelleVersion.tsx",
    ]);
  });
});
