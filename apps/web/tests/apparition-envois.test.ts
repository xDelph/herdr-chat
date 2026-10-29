/**
 * Une bulle d'envoi ne disparaît que sur CE message — arrivé après l'envoi —,
 * jamais sur un message identique de l'historique (P1).
 */
import { describe, expect, test } from "bun:test";
import {
  envoisApparus,
  type EnvoiAttendu,
  type MessageLu,
  TOLERANCE_HORLOGE_MS,
} from "../src/apparition-envois.ts";

const ENVOI_A = Date.parse("2026-10-29T10:00:00Z");

const moi = (id: string, text: string, at: string | null): MessageLu => ({
  at,
  id,
  role: "user",
  text,
});

const envoi = (changement: Partial<EnvoiAttendu> = {}): EnvoiAttendu => ({
  apres: null,
  creeA: ENVOI_A,
  id: "local-1",
  state: "delivered",
  text: "lance les tests",
  ...changement,
});

describe("seul un message arrivé APRÈS l'envoi le prouve", () => {
  test("un message identique d'hier, dans l'historique remonté : la bulle reste", () => {
    const messages = [moi("u0", "lance les tests", "2026-10-28T09:00:00Z")];
    expect(envoisApparus(messages, [envoi()])).toEqual([]);
  });

  test("le message horodaté après l'envoi : la bulle part", () => {
    const messages = [
      moi("u0", "lance les tests", "2026-10-28T09:00:00Z"),
      moi("u1", "lance les tests", "2026-10-29T10:00:03Z"),
    ];
    expect(envoisApparus(messages, [envoi()])).toEqual(["local-1"]);
  });

  test("une horloge du Mac un peu en retard est tolérée", () => {
    const at = new Date(ENVOI_A - TOLERANCE_HORLOGE_MS + 1).toISOString();
    expect(envoisApparus([moi("u1", "lance les tests", at)], [envoi()])).toEqual(["local-1"]);
  });

  test("sans horodatage : seulement APRÈS le dernier message connu à l'envoi", () => {
    const avant = [moi("u0", "lance les tests", null), moi("a0", "ok", null)];
    // Historique ajouté au-dessus : même texte, mais AVANT le repère.
    const envoiRepere = envoi({ apres: "a0" });
    expect(envoisApparus([moi("vieux", "lance les tests", null), ...avant], [envoiRepere])).toEqual(
      [],
    );
    expect(envoisApparus([...avant, moi("u1", "lance les tests", null)], [envoiRepere])).toEqual([
      "local-1",
    ]);
  });

  test("deux envois identiques attendent deux messages", () => {
    const deux = [envoi({ id: "local-1" }), envoi({ id: "local-2" })];
    const un = [moi("u1", "lance les tests", "2026-10-29T10:00:05Z")];
    expect(envoisApparus(un, deux)).toEqual(["local-1"]);
    const deuxMessages = [...un, moi("u2", "lance les tests", "2026-10-29T10:00:06Z")];
    expect(envoisApparus(deuxMessages, deux)).toEqual(["local-1", "local-2"]);
  });

  test("un doublon évité n'est jamais oublié automatiquement", () => {
    const messages = [moi("u1", "lance les tests", "2026-10-29T10:00:05Z")];
    expect(envoisApparus(messages, [envoi({ state: "suppressed" })])).toEqual([]);
  });

  test("une réponse de l'agent au même texte ne compte pas", () => {
    const messages: MessageLu[] = [
      { at: "2026-10-29T10:00:05Z", id: "a1", role: "assistant", text: "lance les tests" },
    ];
    expect(envoisApparus(messages, [envoi()])).toEqual([]);
  });
});
