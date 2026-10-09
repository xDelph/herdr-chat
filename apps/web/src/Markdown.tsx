/**
 * Rendu Markdown → React.
 *
 * `marked` fait la **tokenisation** ; le rendu en éléments React est fait ici.
 *
 * ⚠️ Aucun `dangerouslySetInnerHTML` : le HTML produit par un modèle est une
 * entrée non fiable. En construisant des éléments React, tout texte est échappé
 * par React lui-même — l'injection n'est pas filtrée, elle est **impossible**.
 *
 * Le HTML brut dans le markdown (`<script>`, `<img onerror=…>`) est donc rendu
 * comme du **texte**, jamais exécuté.
 */
import { Fragment, memo, useMemo, type ReactNode } from "react";
import { marked, type Tokens } from "marked";

/**
 * Garde de type pour un jeton.
 *
 * Les propriétés de `marked` sont typées `any` : plutôt que de les affirmer, on
 * vérifie la forme. Un jeton inattendu est écarté, pas propagé.
 */
const isToken = (value: unknown): value is Tokens.Generic =>
  typeof value === "object" && value !== null && "type" in value;

/** Extrait une liste de jetons, ou une liste vide. */
const tokenList = (value: unknown): Tokens.Generic[] =>
  Array.isArray(value) ? value.filter(isToken) : [];

/**
 * Clé stable dérivée du contenu.
 *
 * Les jetons markdown n'ont pas d'identifiant, et une clé d'index provoque des
 * re-rendus inutiles (et un état de repli qui saute d'un élément à l'autre).
 * Le contenu du jeton, lui, ne change pas quand la liste se recompose.
 */
const stableKey = (token: Tokens.Generic, fallback: string): string => {
  const raw = typeof token["raw"] === "string" ? token["raw"] : "";
  const text = typeof token["text"] === "string" ? token["text"] : "";
  const seed = (raw.length > 0 ? raw : text).slice(0, 40);
  return seed.length > 0 ? `${token.type}:${seed}` : fallback;
};

/**
 * Tokenise du markdown.
 *
 * `marked.lexer` renvoie déjà une liste de jetons typés : aucune assertion n'est
 * nécessaire. En cas d'échec, on rend la source comme un paragraphe unique —
 * un markdown illisible ne doit pas casser la conversation.
 */
const lexer = (source: string): Tokens.Generic[] => {
  try {
    return marked.lexer(source);
  } catch {
    return [{ raw: source, text: source, type: "paragraph" }];
  }
};

/** Rend les marques en ligne (`**gras**`, `` `code` ``, liens) sans HTML. */
const inline = (tokens: Tokens.Generic[] | undefined, keyPrefix: string): ReactNode[] => {
  if (tokens === undefined) return [];
  return tokens.map((token, index) => {
    const key = stableKey(token, `${keyPrefix}-${String(index)}`);
    switch (token.type) {
      case "strong":
        return <strong key={key}>{inline(token["tokens"], key)}</strong>;
      case "em":
        return <em key={key}>{inline(token["tokens"], key)}</em>;
      case "del":
        return <del key={key}>{inline(token["tokens"], key)}</del>;
      case "codespan":
        return (
          <code key={key} className="md-code">
            {String(token["text"])}
          </code>
        );
      case "br":
        return <br key={key} />;
      case "link": {
        const href = String(token["href"] ?? "");
        const safe = /^(https?:\/\/|mailto:)/i.test(href);
        // Un `javascript:` dans un lien est neutralisé : on rend le texte seul.
        return safe ? (
          <a key={key} href={href} rel="noreferrer noopener" target="_blank">
            {inline(token["tokens"], key)}
          </a>
        ) : (
          <span key={key}>{inline(token["tokens"], key)}</span>
        );
      }
      case "escape":
      case "text":
      default:
        return (
          <Fragment key={key}>
            {token["tokens"] === undefined
              ? String(token["text"] ?? token["raw"] ?? "")
              : inline(token["tokens"], key)}
          </Fragment>
        );
    }
  });
};

/** Rend un niveau de blocs. Récursif : listes imbriquées, citations. */
const blocks = (tokens: Tokens.Generic[], keyPrefix: string): ReactNode[] =>
  tokens.map((token, index) => {
    const key = stableKey(token, `${keyPrefix}-${String(index)}`);
    switch (token.type) {
      case "heading": {
        const depth = Number(token["depth"] ?? 1);
        // Les titres restent modestes : dans une bulle de chat, un `h1` de
        // navigateur écrase tout le reste.
        const level = Math.min(Math.max(depth, 3), 6);
        // Un type d'élément construit : on restreint aux niveaux supportés.
        const Tag: "h3" | "h4" | "h5" | "h6" =
          level === 3 ? "h3" : level === 4 ? "h4" : level === 5 ? "h5" : "h6";
        return (
          <Tag key={key} className="md-heading">
            {inline(token["tokens"], key)}
          </Tag>
        );
      }
      case "code":
        return (
          <pre key={key} className="md-pre">
            {token["lang"] ? <span className="md-lang">{String(token["lang"])}</span> : null}
            <code>{String(token["text"] ?? "")}</code>
          </pre>
        );
      case "blockquote":
        return (
          <blockquote key={key} className="md-quote">
            {blocks(tokenList(token["tokens"]), key)}
          </blockquote>
        );
      case "list": {
        const ordered = token["ordered"] === true;
        const items = tokenList(token["items"]);
        const rendered = items.map((item, itemIndex) => (
          <li key={stableKey(item, `${key}-${String(itemIndex)}`)}>
            {inline(item["tokens"], `${key}-${itemIndex}`)}
            {item["tokens"] === undefined ? String(item["text"] ?? "") : null}
          </li>
        ));
        return ordered ? (
          <ol key={key} className="md-list">
            {rendered}
          </ol>
        ) : (
          <ul key={key} className="md-list">
            {rendered}
          </ul>
        );
      }
      case "table": {
        const header = tokenList(token["header"]);
        const rows = tokenList(token["rows"]).map((row) => tokenList(row));
        return (
          <div key={key} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th key={stableKey(cell, `${key}-h-${String(cellIndex)}`)}>
                      {inline(cell["tokens"], key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`row:${JSON.stringify(row).slice(0, 40)}${String(rowIndex)}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={stableKey(cell, `${key}-r-${String(cellIndex)}`)}>
                        {inline(cell["tokens"], key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "hr":
        return <hr key={key} className="md-hr" />;
      case "space":
        return null;
      case "paragraph":
        return (
          <p key={key} className="md-p">
            {inline(token["tokens"], key)}
          </p>
        );
      case "html":
        // HTML brut rendu en TEXTE : jamais interprété. Le modèle ne doit pas
        // pouvoir injecter du balisage dans l'application.
        return (
          <pre key={key} className="md-raw-html">
            <code>{typeof token["raw"] === "string" ? token["raw"] : ""}</code>
          </pre>
        );
      default:
        return (
          <p key={key} className="md-p">
            {inline(token["tokens"] === undefined ? undefined : tokenList(token["tokens"]), key)}
          </p>
        );
    }
  });

/**
 * Rendu markdown, mémoïsé.
 *
 * ⚠️ Sans `useMemo`, `marked.lexer` **re-analysait tout le markdown à chaque
 * rendu**, pour chaque message. Taper un caractère dans le composeur
 * re-décodait donc toute la conversation : le fil principal se bloquait à
 * chaque touche, l'affichage vibrait et le défilement partait en vrille.
 */
export const Markdown = memo(({ source }: { source: string }) => {
  const rendered = useMemo(() => blocks(lexer(source), "md"), [source]);
  return <div className="md">{rendered}</div>;
});
Markdown.displayName = "Markdown";
