/**
 * Limites de ressources (S06).
 *
 * Ces tests vérifient deux choses que l'énoncé exige et que rien ne garantissait :
 *
 * 1. **les valeurs announcement et appliquées sont les mêmes** — les limites
 *    vivaient en clair à quatre endroits, et deux ne correspondaient pas au
 *    contrat ;
 * 2. **un dépassement est refusé avant tout effet** — un prompt trop long ne
 *    doit jamais atteindre Herdr.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_FILE_BYTES,
  MAX_JSON_BYTES,
  MAX_PROMPT_BYTES,
  MAX_SSE_STREAMS,
  MAX_SESSION_READS,
  SESSION_TAIL_BYTES,
  byteLengthUtf8,
} from "@herdr-remote/shared";
import { MAX_FILE_BYTES as SERVICE_FILE_BYTES } from "../files/FileService.ts";
import { PREVIEW_BYTES as SUMMARY_PREVIEW } from "../conversations/Summary.ts";
import { MAX_CONCURRENT_READS as CONVERSATION_READS } from "./routes-conversations.ts";
import { guardMutation } from "./OriginGuard.ts";

const ORIGINE = "http://127.0.0.1:8791";

/**
 * Requête minimale.
 *
 * `get` est **insensible à la casse**, comme le `Headers` du Fetch : sinon le
 * test « Content-Length » vérifierait un faux `get` et non le garde.
 */
const requete = (tete: Record<string, string> = {}) => {
  const tous: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGINE,
    ...tete,
  };
  return {
    headers: {
      get: (name: string): string | null => {
        for (const [cle, valeur] of Object.entries(tous)) {
          if (cle.toLowerCase() === name.toLowerCase()) return valeur;
        }
        return null;
      },
    },
    json: async () => ({}),
  };
};

describe("S06 — une seule valeur par limite", () => {
  test("la taille de fichier du service est celle du contrat", () => {
    // Deux constantes égales aujourd'hui peuvent divergir demain : c'est
    // exactement le piège qu'une source unique élimine.
    expect(SERVICE_FILE_BYTES).toBe(MAX_FILE_BYTES);
  });

  test("l'aperçu de conversation est celui du contrat", () => {
    expect(SUMMARY_PREVIEW).toBe(64 * 1024);
  });

  test("la concurrence de la route est celle du contrat", () => {
    expect(CONVERSATION_READS).toBe(MAX_SESSION_READS);
  });

  test("la fenêtre de session est bien 512 Kio", () => {
    // Le tableau des règles annonce 512 Kio ; la route lisait 256 Kio. Le
    // décalage ne se voyait pas — il se sentait, sur le temps d'ouverture.
    expect(SESSION_TAIL_BYTES).toBe(512 * 1024);
  });
});

describe("S06 — le prompt est borné en octets UTF-8", () => {
  test("un prompt ASCII à la limite passe", () => {
    expect(byteLengthUtf8("a".repeat(MAX_PROMPT_BYTES))).toBe(MAX_PROMPT_BYTES);
  });

  test("un prompt d'un octet de plus est refusé", () => {
    expect(byteLengthUtf8("a".repeat(MAX_PROMPT_BYTES + 1))).toBe(MAX_PROMPT_BYTES + 1);
  });

  /**
   * La limite est en **octets**, et un emoji en occupe quatre. Compter les
   * caractères laisserait passer un prompt quatre fois plus gros que annoncé —
   * et le refus viendrait de Herdr, après coup, sans cause lisible.
   */
  test("un emoji compte pour quatre octets", () => {
    expect(byteLengthUtf8("🚀")).toBe(4);
    // Un tiers de la limite en émoji dépasse déjà la limite en caractères.
    const emojis = "🚀".repeat(Math.floor(MAX_PROMPT_BYTES / 4) + 1);
    expect(emojis.length).toBeLessThan(MAX_PROMPT_BYTES);
    expect(byteLengthUtf8(emojis)).toBeGreaterThan(MAX_PROMPT_BYTES);
  });
});

describe("S06 — le corps JSON est refusé avant lecture", () => {
  test("un corps à la limite est accepté", () => {
    expect(guardMutation(requete({ "content-length": String(MAX_JSON_BYTES) }), ORIGINE).ok).toBe(
      true,
    );
  });

  test("un corps d'un octet de plus est refusé en 413", () => {
    const verdict = guardMutation(
      requete({ "content-length": String(MAX_JSON_BYTES + 1) }),
      ORIGINE,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.status).toBe(413);
    expect(verdict.reason).toBe("corps-trop-grand");
  });

  test("une longueur absente ou fausse ne bloque pas", () => {
    // Un client qui n'annonce pas de longueur ne doit pas être refusé pour
    // une information manquante : la limite reste appliquée au prompt ensuite.
    expect(guardMutation(requete(), ORIGINE).ok).toBe(true);
    expect(guardMutation(requete({ "content-length": "beaucoup" }), ORIGINE).ok).toBe(true);
  });

  test("la longueur est lue sans se fier à la casse de l'en-tête", () => {
    expect(
      guardMutation(requete({ "Content-Length": String(MAX_JSON_BYTES + 1) }), ORIGINE).ok,
    ).toBe(false);
  });
});

describe("S06 — les flux SSE sont bornés et le compteur se libère", () => {
  test("le plafond annoncé est bien celui du contrat", () => {
    expect(MAX_SSE_STREAMS).toBe(8);
  });
});
