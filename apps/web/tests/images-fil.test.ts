/**
 * Les images d'une conversation s'affichent : une capture collée dans une
 * demande, et une image lue par un outil — dans la forme commune que le démon
 * sert (`{type:"image", data, mimeType}`).
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toItems, toMessages } from "../src/blocks.ts";
import { ElementFil } from "../src/chat/Elements.tsx";

const rien = () => undefined;

const rendu = (raws: ReadonlyArray<string>): string => {
  const items = toItems(
    toMessages(raws.map((raw, index) => ({ id: `e${String(index)}`, raw, type: "message" }))),
  );
  return items
    .map((item) =>
      renderToStaticMarkup(
        createElement(ElementFil, {
          cwd: null,
          enCours: false,
          item,
          maintenant: 0,
          onOuvrirFichier: rien,
        }),
      ),
    )
    .join("");
};

describe("images du fil", () => {
  test("une capture collée dans une demande", () => {
    const html = rendu([
      JSON.stringify({
        message: {
          content: [
            { text: "j'ai toujours le flou", type: "text" },
            { data: "QUJD", mimeType: "image/jpeg", type: "image" },
          ],
          role: "user",
        },
        type: "message",
      }),
    ]);
    expect(html).toContain("data:image/jpeg;base64,QUJD");
  });

  test("une image lue par un outil", () => {
    const html = rendu([
      JSON.stringify({
        message: {
          content: [
            { arguments: { file_path: "/tmp/x.png" }, id: "t1", name: "Read", type: "toolCall" },
          ],
          role: "assistant",
        },
        type: "message",
      }),
      JSON.stringify({
        message: {
          content: [
            { text: "", type: "text" },
            { data: "UE5H", mimeType: "image/png", type: "image" },
          ],
          role: "toolResult",
          toolName: "outil",
        },
        type: "message",
      }),
    ]);
    expect(html).toContain("data:image/png;base64,UE5H");
  });
});
