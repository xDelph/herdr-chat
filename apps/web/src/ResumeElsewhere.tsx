/* oxlint-disable react-perf/jsx-no-new-object-as-prop */
/**
 * Reprendre ailleurs — bouton utilisant `resume_argv` de Herdr.
 *
 * Affiche la commande native, la copie, ou l'exécute après confirmation.
 * Si `resume_argv` est absent, le bouton n'apparaît pas — pas d'invention.
 */
import { useState } from "react";
import { motion } from "./v2/motion.tsx";

interface Props {
  readonly resumeArgv: ReadonlyArray<string> | null;
}

export const ResumeElsewhere = ({ resumeArgv }: Props) => {
  const [copied, setCopied] = useState(false);

  if (resumeArgv === null || resumeArgv.length === 0) return null;

  const commande = resumeArgv.join(" ");

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(commande);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — show the command for manual copy
    }
  };

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="resume-elsewhere"
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
    >
      <span className="resume-elsewhere__label">Resume on Mac</span>
      <code className="resume-elsewhere__cmd">{commande}</code>
      <button type="button" className="ghost" onClick={() => void copier()}>
        {copied ? "Copied!" : "Copy"}
      </button>
    </motion.div>
  );
};
