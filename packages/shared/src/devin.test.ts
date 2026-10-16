/**
 * devin → pi : un `chat_message` par ligne, dans une base SQLite.
 *
 * ⚠️ **Les fixtures sont recopiées de la base réelle**
 * (`~/.local/share/devin/cli/sessions.db`, mesuré le 2026-10-16) : 163 lignes,
 * dont **129 de rôle `system`** — le contexte injecté, largement majoritaire. Un
 * adaptateur qui ne l'écarterait pas ouvrirait chaque conversation devin sur un
 * mur de consignes.
 *
 * ⚠️ **Ce fichier manquait.** L'adaptateur était en place et branché, mais aucun
 * test unitaire ne le couvrait : ses règles n'étaient tenues que par les
 * vérifications faites à la main sur la base. Une relecture ne les aurait pas
 * rattrapées.
 */
import { describe, expect, test } from "bun:test";
import { ligneDevinVersPi } from "./devin.ts";

/** Un `chat_message` tel que la base le stocke, réduit au nécessaire. */
const message = (champs: Record<string, unknown>): unknown => ({
  content: "",
  message_id: "msg-1",
  metadata: { created_at: "2026-10-16T18:00:00.000Z" },
  role: "assistant",
  ...champs,
});

/** Les blocs d'une ligne traduite, sans assertion de type. */
const blocs = (ligne: unknown): ReadonlyArray<Record<string, unknown>> => {
  if (typeof ligne !== "object" || ligne === null) return [];
  const corps = Reflect.get(ligne, "message");
  if (typeof corps !== "object" || corps === null) return [];
  const contenu = Reflect.get(corps, "content");
  if (!Array.isArray(contenu)) return [];
  return contenu.filter(
    (bloc): bloc is Record<string, unknown> => typeof bloc === "object" && bloc !== null,
  );
};

describe("devin — ce qui n'est pas la conversation est écarté", () => {
  test("`system` part en entier — c'est le contexte injecté", () => {
    // 129 lignes sur 163 : c'est la majorité de ce que la base contient.
    expect(ligneDevinVersPi(message({ content: "You are Devin…", role: "system" }), "1")).toBe(
      undefined,
    );
  });

  test("un rôle inconnu ne lève pas", () => {
    expect(ligneDevinVersPi(message({ role: "outil" }), "1")).toBeUndefined();
    expect(ligneDevinVersPi("pas un objet", "1")).toBeUndefined();
    expect(ligneDevinVersPi(null, "1")).toBeUndefined();
  });

  test("un message vide n'est pas un message", () => {
    // On ne fabrique pas de bulle vide — ni pour l'utilisateur, ni pour l'agent.
    expect(ligneDevinVersPi(message({ content: "   ", role: "user" }), "1")).toBeUndefined();
    expect(ligneDevinVersPi(message({ content: "" }), "1")).toBeUndefined();
    expect(ligneDevinVersPi(message({ content: "   " }), "1")).toBeUndefined();
  });
});

describe("devin — la conversation", () => {
  test("une demande de l'utilisateur", () => {
    const ligne = ligneDevinVersPi(
      message({ content: "crée le projet", metadata: undefined, role: "user" }),
      "7",
    );

    expect(ligne?.message.role).toBe("user");
    expect(blocs(ligne)[0]?.["text"]).toBe("crée le projet");
  });

  test("une réponse : la réflexion AVANT la prose", () => {
    const ligne = ligneDevinVersPi(
      message({
        content: "voilà",
        thinking: { signature: "sig", thinking: "je réfléchis" },
      }),
      "8",
    );

    expect(blocs(ligne).map((bloc) => bloc["type"])).toEqual(["thinking", "text"]);
  });

  test("la réflexion est publiée en clair, jamais masquée", () => {
    // Comme opencode, et contrairement à codex : la source la donne lisible.
    const ligne = ligneDevinVersPi(message({ thinking: { thinking: "je réfléchis" } }), "8");

    expect(blocs(ligne)[0]?.["thinking"]).toBe("je réfléchis");
    expect(blocs(ligne)[0]?.["redacted"]).toBe(false);
  });

  test("l'identité et l'horodatage viennent de la ligne", () => {
    const ligne = ligneDevinVersPi(message({ content: "ok" }), "42");

    expect(ligne?.id).toBe("devin:42");
    expect(ligne?.timestamp).toBe("2026-10-16T18:00:00.000Z");
  });

  test("aucun appel d'outil n'est inventé sans `function.name`", () => {
    /*
      ⚠️ Les huit messages `assistant` de la base avaient tous `tool_calls` vide :
      la forme réelle d'un appel n'a **pas** été mesurée. On refuse donc tout ce
      qui n'a pas de nom, plutôt que de fabriquer un appel plausible — un appel
      inventé dans une liste d'actions est pire qu'un appel manquant.
    */
    const ligne = ligneDevinVersPi(
      message({
        content: "ok",
        tool_calls: [{ id: "c1", type: "function", function: { arguments: "{}" } }],
      }),
      "9",
    );

    expect(blocs(ligne).map((bloc) => bloc["type"])).toEqual(["text"]);
  });
});

/**
 * Le modèle, porté par le message lui-même.
 *
 * ⚠️ Mesure du 2026-10-16 : les huit messages `assistant` portent
 * `metadata.generation_model` (`swe-1-6-slow`). Le reste de la session n'en parle
 * jamais — sans cette lecture, un agent devin n'annonçait aucun modèle.
 */
describe("devin — le modèle est sur le message", () => {
  test("`generation_model` est repris tel quel", () => {
    const ligne = ligneDevinVersPi(
      message({
        content: "ok",
        metadata: { created_at: "2026-10-16T18:00:00.000Z", generation_model: "swe-1-6-slow" },
      }),
      "1",
    );

    expect(ligne?.message.model).toBe("swe-1-6-slow");
  });

  test("un substitut entre chevrons n'est pas un modèle", () => {
    const ligne = ligneDevinVersPi(
      message({ content: "ok", metadata: { generation_model: "<unknown>" } }),
      "1",
    );

    expect(ligne?.message.model).toBeUndefined();
  });

  test("sans modèle déclaré, le champ reste ABSENT", () => {
    expect(ligneDevinVersPi(message({ content: "ok" }), "1")?.message.model).toBeUndefined();
  });

  test("le fournisseur et le niveau n'existent pas dans cette source", () => {
    const ligne = ligneDevinVersPi(
      message({ content: "ok", metadata: { generation_model: "swe-1-6-slow" } }),
      "1",
    );

    expect(ligne?.message.provider).toBeUndefined();
    expect(ligne?.message.thinkingLevel).toBeUndefined();
  });
});
