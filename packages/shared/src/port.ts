/**
 * Port du backend — **source unique**.
 *
 * Le port se lit à deux endroits indépendants : le serveur Bun (`config.ts`) et
 * le proxy de développement Vite (`vite.config.ts`). Tant que chacun portait son
 * propre littéral, `/api` en développement partait vers `127.0.0.1:8765`, c'est-à-dire
 * vers `print-cost-report` — un service sans rapport (voir `docs/DECISIONS.md` D010.4).
 * Un point d'entrée mort, lui, ne se voit pas : `tsc` ne relie pas le champ
 * `"main"` d'un `package.json` au fichier réel.
 *
 * Pourquoi `8791` : `tailscale serve` expose `https://…:8790` et le retransmet
 * vers `127.0.0.1:8791`. Le port **local** du backend est donc `8791` ; `8790` n'est
 * que le port HTTPS côté tailnet. Les deux ne doivent jamais être confondus.
 *
 * `8765` reste interdit : il est occupé par `print-cost-report`. `3000` aussi,
 * pris par OrbStack.
 */

/** Port local du backend, tel que visé par `tailscale serve`. */
export const DEFAULT_BACKEND_PORT = 8791;

/** Port HTTPS côté tailnet, servi par Tailscale. Distinct du port local. */
export const DEFAULT_TAILNET_PORT = 8790;

/**
 * Port effectif du backend, lu depuis l'environnement.
 *
 * Destiné aux consommateurs qui n'ont **pas** à rendre une erreur : le proxy de
 * développement. Le serveur ne s'en sert pas — il valide et refuse bruyamment
 * lui-même (`config.ts`), parce qu'un refus de démarrage doit toujours dire
 * pourquoi. Ici, une valeur illisible retombe simplement sur le défaut.
 */
export const backendPort = (env: Record<string, string | undefined>): number => {
  const raw = env["HERDR_REMOTE_PORT"];
  if (raw === undefined || raw === "") {
    return DEFAULT_BACKEND_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return DEFAULT_BACKEND_PORT;
  }
  return parsed;
};
