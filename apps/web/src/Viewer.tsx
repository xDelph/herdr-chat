/**
 * Visionneuse de fichier — modal plein écran, dans l'application.
 *
 * **Ce qui n'allait pas.** Le panneau vivait *dans* la colonne du chat : le
 * composeur le recouvrait et il ne restait qu'une bande étroite. Un lien
 * ouvrait un nouvel onglet — sur iPhone, une PWA installée en fait sortir.
 *
 * Ici : plein écran, au-dessus de tout, refermable.
 */
import { useEffect, useMemo, useState } from "react";
import { Option, Schema } from "effect";
import { ApiErrorResponse } from "@herdr-remote/shared";
import { baseName, fileUrl } from "./api.ts";
import { Feuille } from "./Feuille.tsx";
import { Notice } from "./Notice.tsx";

/** Langage déduit de l'extension — sert d'étiquette et d'indice de coloration. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  c: "c",
  cpp: "c++",
  css: "css",
  diff: "diff",
  go: "go",
  h: "c",
  hpp: "c++",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonl: "json",
  jsx: "javascript",
  md: "markdown",
  patch: "diff",
  py: "python",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "texte",
  yaml: "yaml",
  yml: "yaml",
};

export const languageOf = (path: string): string => {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  const extension = match?.[1]?.toLowerCase() ?? "";
  return (LANGUAGE_BY_EXTENSION[extension] ?? extension.length > 0) ? extension : "texte";
};

/** Coloration minimale : chaînes, nombres, commentaires, mots-clés. */
const KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|type|interface|pub|fn|impl|struct|enum|match|def|self|None|null|true|false)\b/g;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Coloration par expressions régulières.
 *
 * Volontairement minimale : quelques familles de jetons, pas d'analyse
 * syntaxique. Un vrai moteur coûterait des centaines de kilo-octets pour un
 * confort marginal sur un téléphone. Le balisage est **échappé avant** d'être
 * coloré, donc rien ne peut être injecté.
 */
export const highlight = (text: string): string => {
  let out = escapeHtml(text);
  out = out.replace(/(&quot;|")([^"\n]*)(")/g, '<span style="color:#a3d977">$1$2$3</span>');
  out = out.replace(/(\/\/[^\n]*|#[^\n]*|--[^\n]*)/g, '<span style="color:#5f7590">$1</span>');
  out = out.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span style="color:#d4a56a">$1</span>');
  out = out.replace(KEYWORDS, '<span style="color:#7ab8ff">$1</span>');
  return out;
};

const MAX_LINES = 4000;

const CodeView = ({ path }: { path: string }) => {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(fileUrl(path));
        if (!response.ok) {
          // Le serveur refuse avec une raison explicite : on l'affiche telle
          // quelle plutôt qu'un « erreur » générique.
          // Décodage plutôt qu'assertion : une forme inattendue donne un
          // message générique, jamais une exception.
          const body: unknown = await response.json().catch(() => undefined);
          const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(ApiErrorResponse)(body));
          if (!cancelled) {
            setError(decoded?.error ?? `Unable to load file (${String(response.status)})`);
          }
          return;
        }
        const raw = await response.text();
        if (!cancelled) setText(raw);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Toutes les hooks restent avant les retours de chargement/erreur : le
  // premier rendu n'a pas encore le texte, mais le suivant garde le même ordre.
  const rows = useMemo(
    () =>
      text === null
        ? []
        : text
            .split("\n")
            .slice(0, MAX_LINES)
            .map((line, index) => ({
              // Balisage échappé dans `highlight`, donc sans injection possible.
              html: { __html: highlight(line) },
              key: `${String(index)}-${line.slice(0, 24)}`,
              number: index + 1,
            })),
    [text],
  );

  if (error !== null) return <Notice ton="erreur">{error}</Notice>;
  if (text === null) return <p className="muted small">Lecture…</p>;

  return (
    <div className="code">
      <div className="code__lang">{languageOf(path)}</div>
      {rows.map((row) => (
        <div key={row.key} className="code__row">
          <span className="code__line-no">{row.number}</span>
          <span className="code__text" dangerouslySetInnerHTML={row.html} />
        </div>
      ))}
      {text.split("\n").length > MAX_LINES ? (
        <p className="blk__hint">Showing the first {MAX_LINES} lines</p>
      ) : null}
    </div>
  );
};

interface ViewerProps {
  readonly path: string;
  readonly onClose: () => void;
  /**
   * Retour à la liste des fichiers.
   *
   * ⚠️ Sans ce bouton, « Fermer » fermait **tout** et renvoyait au chat : on
   * perdait la liste qu'on était en train de parcourir. Il faut pouvoir revenir
   * d'un cran, pas tout quitter.
   */
  readonly onBack?: (() => void) | undefined;
}

/** Modal plein écran : image avec agrandissement, ou fichier colorisé. */
export const FileViewer = ({ path, onClose, onBack }: ViewerProps) => {
  const [zoomed, setZoomed] = useState(false);
  // La cible peut être un **chemin local** ou une **URL** : un agent cite les
  // deux. Le rendu et l'agrandissement sont identiques.
  const isRemote = /^https?:\/\//i.test(path);
  const name = isRemote ? (path.split("/").pop() ?? path) : baseName(path);
  const isImage = /\.(png|jpe?g|gif|webp|avif)$/i.test(path);
  const source = isRemote ? path : fileUrl(path);

  /*
    Plus d'écouteur `Échap` sur `window` : `Feuille` le gère, et il le gère
    mieux. Deux gestionnaires signifiaient que la touche pouvait fermer deux
    fois — la visionneuse, puis la liste de fichiers derrière elle.
  */

  return (
    <Feuille
      ariaLabel={`${name} — viewer`}
      onClose={onClose}
      onRetour={onBack}
      retourLibelle={onBack === undefined ? undefined : "‹ Files"}
      titre={name}
    >
      <p className="file__path mono small">{path}</p>

      {isImage ? (
        <button
          type="button"
          className={zoomed ? "viewer viewer--zoomed" : "viewer"}
          onClick={() => setZoomed((value) => !value)}
        >
          <img className="viewer__image" src={source} alt={name} />
        </button>
      ) : (
        <CodeView path={path} />
      )}
    </Feuille>
  );
};
