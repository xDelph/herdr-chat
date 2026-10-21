/**
 * État consolidé de l'application — un seul `SubscriptionRef<AppState>`.
 *
 * ⚠️ **Un seul propriétaire.** `AppShell` est le seul à écrire ; les composants
 * s'abonnent à des slices via `useSlice`. Un changement dans un champ ne
 * redéclenche le rendu que des composants qui lisent ce champ.
 */
import type { Effect } from "effect";
import { SubscriptionRef } from "effect";
import type { Overview, Health, InstalledKind, AgentView } from "../api.ts";
import type { ConversationSummary } from "@herdr-remote/shared";
import type { Route } from "../routing.ts";
import type { Groupement } from "../preferences.ts";
import type { Ordre } from "../sections.ts";

/** L'état global, immuable par construction. */
export interface AppState {
  readonly route: Route;
  readonly overview: Overview | null;
  readonly health: Health | null;
  readonly conversations: ReadonlyArray<ConversationSummary>;
  readonly error: string | null;
  readonly dernierSucces: number | null;
  readonly chargement: boolean;
  readonly live: "live" | "down";
  readonly kinds: ReadonlyArray<InstalledKind>;
  readonly groupement: Groupement;
  readonly ordre: Ordre;
  readonly memoire: ReadonlyMap<string, AgentView>;
  readonly maintenant: number;
  readonly agePage: number;
  readonly reglagesOuverts: boolean;
}

/** Valeur initiale — aucun état métier dans les composants. */
export const initialState: AppState = {
  agePage: 0,
  chargement: true,
  conversations: [],
  dernierSucces: null,
  error: null,
  groupement: "statut",
  health: null,
  kinds: [],
  live: "down",
  maintenant: Date.now(),
  memoire: new Map(),
  ordre: "recent",
  overview: null,
  reglagesOuverts: false,
  route: { kind: "liste" },
};

/** Crée le ref d'état. À appeler une fois dans `AppShell`. */
export const createStateRef = (): Effect.Effect<SubscriptionRef.SubscriptionRef<AppState>> =>
  SubscriptionRef.make(initialState);
