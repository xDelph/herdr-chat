/**
 * Squelette de chargement — shimmer subtil.
 *
 * ⚠️ **Centré, pas une ligne en haut.** Un paragraphe gris collé sous l'en-tête
 * ressemble à un message d'erreur. Le squelette occupe la place du contenu et
 * indique visuellement que quelque chose avance.
 */
/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
import { motion, useReducedMotion } from "./v2/motion.tsx";

interface Props {
  readonly lignes?: number;
  readonly hauteur?: number;
}

export const Skeleton = ({ lignes = 3, hauteur = 16 }: Props) => {
  const reduced = useReducedMotion();
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lignes }, (_, i) => i).map((i) => (
        <motion.div
          animate={reduced ? { opacity: 0.6 } : { opacity: [0.4, 0.8, 0.4] }}
          className="skeleton__ligne"
          key={`skeleton-line-${i}`}
          style={{ height: `${hauteur}px`, width: `${100 - i * 10}%` }}
          transition={
            reduced ? { duration: 0 } : { duration: 1.5, ease: "easeInOut", repeat: Infinity }
          }
        />
      ))}
    </div>
  );
};
