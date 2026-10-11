/**
 * Route d'événements (SSE).
 *
 * **Déplacement seul (A01)** — aucun changement de comportement.
 *
 * SSE et non WebSocket parce que le flux est **unidirectionnel** (les envois
 * sont des POST) et qu'`EventSource` apporte nativement la reconnexion et
 * l'en-tête `Last-Event-ID` (D009.1). Herdr ne fournit aucun compteur de
 * rattrapage exploitable — son `revision` vaut 0 en permanence et `events.wait`
 * n'implémente pas `pane_output_changed` (E3) — donc le rattrapage est
 * construit ici, sur un journal borné à identifiants monotones.
 *
 * B04 renforcera ce module : un client trop en retard doit recevoir **un seul**
 * `resync`, jamais deux, et jamais un trou silencieux.
 */
import { Effect } from "effect";
import type { EventHubApi } from "../events/EventHub.ts";
import type { RouteRequest } from "./Reply.ts";

export const makeEventRoutes = (hub: EventHubApi) => {
  const events = (request: RouteRequest): Response => {
    const header = request.headers.get("last-event-id");
    const parsed = header === null ? 0 : Number.parseInt(header, 10);
    let cursor = Number.isInteger(parsed) ? parsed : 0;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Signal de vie immédiat : le client sait que le flux est établi.
        controller.enqueue(encoder.encode(`event: ready\ndata: ${JSON.stringify({ cursor })}\n\n`));
        let closed = false;
        // Séquence volontaire : on interroge le journal, on émet, PUIS on
        // attend. Paralléliser n'aurait pas de sens ici — c'est une boucle de
        // scrutation, pas une collecte de promesses indépendantes.
        /* oxlint-disable no-await-in-loop */
        while (!closed) {
          try {
            const catchUp = await Effect.runPromise(hub.since(cursor));
            let buffer = "";
            // ⚠️ **Un seul** resync (B04). Le client trop en retard serait sinon
            // bombardé toutes les 300 ms : la boucle interroge le même
            // point de départ tant que le curseur n'a pas avancé. On avance une fois
            // le curseur à l'ID courant, et le flux continue normalement.
            if (catchUp.resyncRequired) {
              buffer +=
                `id: ${String(catchUp.resumeFrom)}\n` +
                `event: resync\n` +
                `data: ${JSON.stringify({ reason: "journal tronqué", resumeFrom: catchUp.resumeFrom })}\n\n`;
              cursor = catchUp.resumeFrom;
            }
            for (const event of catchUp.events) {
              buffer += `id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event.data)}\n\n`;
            }
            if (catchUp.events.length > 0) {
              cursor = catchUp.events[catchUp.events.length - 1]?.id ?? cursor;
            }
            if (buffer.length > 0) controller.enqueue(encoder.encode(buffer));
            await Bun.sleep(300);
          } catch (cause) {
            closed = true;
            controller.error(cause);
          }
        }
        /* oxlint-enable no-await-in-loop */
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      },
    });
  };

  return { events };
};
