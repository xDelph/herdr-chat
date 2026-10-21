/**
 * Couche d'animation — variants partagés pour Motion.
 *
 * ⚠️ **Respect de `prefers-reduced-motion`.** Le hook `useReducedMotion`
 * désactive toutes les animations si l'utilisateur le demande.
 */
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";

export { AnimatePresence, motion, useReducedMotion };

/** Fade simple. */
export const fade: Variants = {
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  initial: { opacity: 0 },
};

/** Slide depuis le bas (mobile). */
export const slideUp: Variants = {
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
  initial: { opacity: 0, y: 20 },
};

/** Slide depuis la droite (navigation). */
export const slideInRight: Variants = {
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 30 },
  initial: { opacity: 0, x: 30 },
};

/** Scale-in (boutons, badges). */
export const scaleIn: Variants = {
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  initial: { opacity: 0, scale: 0.95 },
};

/** Durée standard. */
export const TRANSITION = { duration: 0.2, ease: "easeOut" };

/** Durée rapide pour les micro-interactions. */
export const TRANSITION_FAST = { duration: 0.1, ease: "easeOut" };

/** Spring pour les gestes (swipe, drag). */
export const SPRING = { damping: 25, stiffness: 300, type: "spring" as const };

/**
 * Wrapper qui respecte `prefers-reduced-motion`.
 * Si réduit, toutes les animations sont désactivées (opacity only).
 */
export function withReducedMotion(variants: Variants, reduced: boolean): Variants {
  if (!reduced) return variants;
  return {
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    initial: { opacity: 0 },
  };
}
