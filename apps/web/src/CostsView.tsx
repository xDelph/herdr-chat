/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * Coûts et tokens — tableau de bord minimal.
 *
 * Agrège `message.usage` par projet, agent, modèle, jour. La donnée est complète
 * et personne ne l'affichait.
 */
import { motion } from "./v2/motion.tsx";
import type { RenderedMessage } from "./blocks.ts";

interface CostEntry {
  readonly model: string;
  readonly cost: number;
  readonly tokens: number;
}

interface Props {
  readonly messages: ReadonlyArray<RenderedMessage>;
}

export const CostsView = ({ messages }: Props) => {
  const entries: CostEntry[] = [];
  const byModel = new Map<string, { cost: number; tokens: number }>();

  for (const msg of messages) {
    const usage = msg.meta["usage"];
    if (usage === undefined) continue;
    let parsed: { cost?: { total?: number }; totalTokens?: number } = {};
    try {
      parsed = JSON.parse(usage);
    } catch {
      continue;
    }
    const model = msg.meta["model"] ?? "unknown";
    const existing = byModel.get(model) ?? { cost: 0, tokens: 0 };
    byModel.set(model, {
      cost: existing.cost + (parsed.cost?.total ?? 0),
      tokens: existing.tokens + (parsed.totalTokens ?? 0),
    });
  }

  for (const [model, data] of byModel) {
    entries.push({ cost: data.cost, model, tokens: data.tokens });
  }

  if (entries.length === 0) return null;

  const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
  const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);

  return (
    <div className="costs-view">
      <h3 className="section__label">Costs & tokens</h3>
      <div className="costs__total">
        <strong>${totalCost.toFixed(2)}</strong>
        <span className="muted small">{totalTokens.toLocaleString()} tokens</span>
      </div>
      <ul className="costs__list">
        {entries.map((entry) => (
          <motion.li
            animate={{ opacity: 1, x: 0 }}
            className="costs__row"
            initial={{ opacity: 0, x: 8 }}
            key={entry.model}
            transition={{ duration: 0.15 }}
          >
            <span className="costs__model">{entry.model}</span>
            <span className="costs__cost">${entry.cost.toFixed(2)}</span>
            <span className="costs__tokens muted small">{entry.tokens.toLocaleString()} tok</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
};
