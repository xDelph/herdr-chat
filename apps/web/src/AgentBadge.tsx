/**
 * Marque d'un agent — le signe qui précède le titre d'une conversation.
 *
 * ⚠️ **Ce ne sont pas les logos des éditeurs, et c'est un choix.** Livrer la
 * marque d'un tiers suppose disposer de son fichier officiel. Une imitation
 * dessinée à la main serait deux fois mauvaise : elle ne ressemblerait pas au
 * vrai logo — donc elle tromperait — et elle reprendrait une marque sans droit.
 * On dessine à la place **un signe géométrique par famille**, dans la couleur
 * d'accent du thème.
 *
 * ⚠️ **Le signe est décoratif, et `aria-hidden` le dit.** Le type de l'agent est
 * écrit en toutes lettres sur la ligne juste en dessous
 * (« waiting for input · tab 1 · pi · devcli-private ») : le signe aide à
 * reconnaître d'un coup d'œil, il n'est jamais le seul porteur de l'information.
 * Un lecteur d'écran qui l'annoncerait dirait deux fois la même chose.
 *
 * ⚠️ **Le repli est neutre.** Un type inconnu — un agent qu'on n'a pas encore
 * mesuré — reçoit un disque, jamais le signe d'un autre : emprunter la marque
 * d'un voisin ferait croire à un type qu'on n'a pas vérifié.
 */

/** Un signe par famille. Le repli reste neutre, jamais emprunté. */
const signeDe = (kind: string) => {
  switch (kind) {
    case "pi":
      // Le pi grec : la barre et ses deux jambages. C'est le nom de l'outil.
      return <path d="M4.5 8.2h15M9 8.2V18M15.4 8.2v6.8" />;
    case "codex":
      // Un hexagone ferme : la boite a code, vue de face.
      return <path d="M12 3.6 19.3 7.8v8.4L12 20.4 4.7 16.2V7.8z" />;
    case "claude":
      // Un astérisque a six branches, et rien autour.
      return <path d="M12 3.4v17.2M4.55 7.7l14.9 8.6M19.45 7.7l-14.9 8.6" />;
    case "opencode":
      // L'invite : une fleche, puis le trait qui attend la suite.
      return <path d="M5.5 8.2 9.8 12l-4.3 3.8M12.6 15.8h6" />;
    case "devin":
      // Un losange : le noyau, vu de dessus.
      return <path d="M12 3.4 20.6 12 12 20.6 3.4 12z" />;
    default:
      // Neutre : un disque. On n'emprunte le signe de personne.
      return <circle cx="12" cy="12" r="6.6" />;
  }
};

/**
 * Classe du signe.
 *
 * ⚠️ Le type y est repris **tel que Herdr l'expose**, sans normalisation : c'est
 * ce qui permet de vérifier dans le DOM quel signe a été rendu pour quel type,
 * sans passer par une image.
 */
export const classeDeMarque = (kind: string | null): string => {
  const nom = kind ?? "inconnu";
  return `agent-badge agent-badge--${nom}`;
};

export const AgentBadge = ({ kind }: { readonly kind: string | null }) => (
  <span className={classeDeMarque(kind)} aria-hidden="true">
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
    >
      {signeDe(kind ?? "")}
    </svg>
  </span>
);
