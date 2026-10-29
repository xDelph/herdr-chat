/**
 * Un élément du fil : une demande, une réponse, ou le travail d'un tour.
 *
 * Mémoïsé **par identité d'élément** : la transcription incrémentale rend les
 * mêmes objets pour les tours inchangés, donc un delta ne redessine que le tour
 * qui bouge (`transcript.ts`).
 */
import { memo, useState } from "react";
import { fileUrl } from "../api.ts";
import {
  estMessageDuHarnais,
  ROLE_LIGNE_IGNOREE,
  type Block,
  type Item,
  type RenderedMessage,
} from "../blocks.ts";
import { heureDe } from "../libelles.ts";
import { Markdown } from "../Markdown.tsx";
import { CarteRapport } from "./CarteRapport.tsx";
import { GroupeOutils } from "./Outils.tsx";
import { pleinEcran } from "../app/services.ts";

const JOURS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** « Today · 13:52 », « Yesterday · 18:04 », « Mon 10/26 · 09:00 ». */
export const repereDe = (iso: string | null, maintenant: number): string | null => {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const heure = heureDe(iso) ?? "";
  const jour = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const auj = new Date(maintenant);
  const aujourdhui = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate()).getTime();
  if (jour === aujourdhui) return `Today · ${heure}`;
  if (aujourdhui - jour === 86_400_000) return `Yesterday · ${heure}`;
  const jj = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${JOURS[date.getDay()] ?? ""} ${mm}/${jj} · ${heure}`;
};

const ImageCitee = ({ source, libelle }: { readonly source: string; readonly libelle: string }) => {
  const [rate, setRate] = useState(false);
  if (rate) return <p className="discret">Image unavailable: {libelle}</p>;
  return (
    <button
      type="button"
      className="fil__vignette"
      onClick={() => pleinEcran.ouvre({ legende: libelle, source })}
    >
      <img src={source} alt={libelle} loading="lazy" onError={() => setRate(true)} />
      <span className="mono">{libelle}</span>
    </button>
  );
};

const BlocProse = ({ block }: { readonly block: Block }) => {
  switch (block.kind) {
    case "text":
      return <Markdown source={block.text} />;
    case "image": {
      const source = `data:${block.mimeType};base64,${block.data}`;
      return (
        <button
          type="button"
          className="fil__vignette"
          onClick={() => pleinEcran.ouvre({ legende: "Attachment", source })}
          aria-label="Show attachment full screen"
        >
          <img src={source} alt="Attachment" />
        </button>
      );
    }
    case "imagePath":
      return <ImageCitee source={fileUrl(block.path)} libelle={block.path} />;
    case "imageUrl":
      return <ImageCitee source={block.url} libelle={block.url} />;
    default:
      return null;
  }
};

const Demande = ({
  message,
  maintenant,
}: {
  readonly message: RenderedMessage;
  readonly maintenant: number;
}) => {
  const repere = repereDe(message.at, maintenant);
  const texte = message.blocks
    .filter((block): block is Extract<Block, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("\n");
  return (
    <>
      {repere === null ? null : <span className="fil__repere">{repere}</span>}
      <div className="moi" data-demande="">
        <p className="moi__texte">{texte}</p>
        {message.meta["pendantTour"] === "1" ? (
          <span className="moi__etat">sent during the turn</span>
        ) : null}
        {message.blocks
          .filter((block) => block.kind !== "text")
          .map((block, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- blocs sans identifiant
            <BlocProse key={index} block={block} />
          ))}
      </div>
    </>
  );
};

export const ElementFil = memo(
  ({
    item,
    enCours,
    cwd,
    maintenant,
    onOuvrirFichier,
  }: {
    readonly item: Item;
    readonly enCours: boolean;
    readonly cwd: string | null;
    /** Pour les repères de jour : arrondi à la minute par l'appelant. */
    readonly maintenant: number;
    readonly onOuvrirFichier: (chemin: string) => void;
  }) => {
    if (item.kind === "tools") {
      return (
        <div className="fil__el">
          <GroupeOutils
            messages={item.messages}
            enCours={enCours}
            cwd={cwd}
            onOuvrirFichier={onOuvrirFichier}
          />
        </div>
      );
    }
    const { message } = item;
    if (estMessageDuHarnais(message)) {
      return (
        <div className="fil__el">
          <CarteRapport message={message} />
        </div>
      );
    }
    if (message.role === ROLE_LIGNE_IGNOREE) {
      // Discret : une note du fil, pas une bulle — mais jamais un trou muet.
      return (
        <div className="fil__el">
          <p className="fil__info">{message.text}</p>
        </div>
      );
    }
    if (message.role === "user") {
      return (
        <div className="fil__el fil__el--moi">
          <Demande message={message} maintenant={maintenant} />
        </div>
      );
    }
    return (
      <div className="fil__el agent">
        {message.blocks.map((block, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- blocs sans identifiant
          <BlocProse key={index} block={block} />
        ))}
      </div>
    );
  },
);
ElementFil.displayName = "ElementFil";
