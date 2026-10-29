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
 * Une cellule de tableau, qui **n'est pas un jeton**.
 *
 * ⚠️ **C'est le defaut qui vidait les tableaux.** `marked` decrit une cellule par
 * `{ text, tokens, header, align }` — **sans `type`**. `tokenList`, qui filtre sur
 * `type` pour ecarter les formes inattendues, les ecartait donc TOUTES : le
 * tableau se rendait avec un en-tete et un corps **vides**, un cadre sans texte.
 *
 * Mesure sur la reponse finale d'un agent codex : un tableau de sept lignes
 * s'affichait comme un cadre vide, alors que le texte etait bien dans la session
 * (et codex l'avait releve lui-meme : « Markdown tables render empty »).
 *
 * On ne relache pas `isToken` pour autant : elargir la garde des jetons ferait
 * passer n'importe quel objet. La cellule a sa propre forme, donc sa propre
 * garde.
 */
const cellList = (value: unknown): Tokens.Generic[] =>
  Array.isArray(value)
    ? value.filter(
        (cell): cell is Tokens.Generic =>
          typeof cell === "object" && cell !== null && "tokens" in cell,
      )
    : [];

/**
 * Les lignes d'un tableau : un tableau de tableaux de cellules.
 *
 * ⚠️ Une **ligne** est un tableau, pas une cellule : lui appliquer la garde des
 * cellules la rejetterait (un tableau n'a pas de `tokens`), et le corps du
 * tableau sortirait vide alors que l'en-tête serait rempli. C'est exactement le
 * défaut voisin de celui des cellules, et il se voit sur un tableau à une seule
 * ligne de données.
 */
const lignesDeTableau = (value: unknown): ReadonlyArray<Tokens.Generic[]> => {
  if (!Array.isArray(value)) return [];
  const lignes: Tokens.Generic[][] = [];
  for (const ligne of value) {
    if (Array.isArray(ligne)) lignes.push(cellList(ligne));
  }
  return lignes;
};

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
    // Le contenu seul n'est pas unique : deux jetons `text` adjacents peuvent
    // avoir exactement la même valeur. L'index distingue ces frères dans une
    // même liste et évite les clés React dupliquées.
    const key = `${stableKey(token, `${keyPrefix}-${String(index)}`)}:${String(index)}`;
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
    const key = `${stableKey(token, `${keyPrefix}-${String(index)}`)}:${String(index)}`;
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
          <li key={`${stableKey(item, `${key}-${String(itemIndex)}`)}:${String(itemIndex)}`}>
            {/* ⚠️ Un élément de liste peut contenir des BLOCS (sous-liste, code) :
                les rendre en ligne imprimait « - Faire la bascule » en texte brut. */}
            {item["tokens"] === undefined
              ? String(item["text"] ?? "")
              : blocks(tokenList(item["tokens"]), `${key}-${String(itemIndex)}`)}
          </li>
        ));
        const debut = typeof token["start"] === "number" ? token["start"] : undefined;
        return ordered ? (
          <ol key={key} className="md-list" start={debut}>
            {rendered}
          </ol>
        ) : (
          <ul key={key} className="md-list">
            {rendered}
          </ul>
        );
      }
      case "table": {
        const header = cellList(token["header"]);
        const rows = lignesDeTableau(token["rows"]);
        return (
          <div key={key} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th
                      key={`${stableKey(cell, `${key}-h-${String(cellIndex)}`)}:${String(cellIndex)}`}
                    >
                      {inline(cell["tokens"], key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`row:${JSON.stringify(row).slice(0, 40)}${String(rowIndex)}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${stableKey(cell, `${key}-r-${String(cellIndex)}`)}:${String(cellIndex)}`}
                      >
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
      case "text":
        // Texte nu d'un élément de liste serrée : en ligne, sans paragraphe.
        return (
          <Fragment key={key}>
            {token["tokens"] === undefined
              ? String(token["text"] ?? "")
              : inline(tokenList(token["tokens"]), key)}
          </Fragment>
        );
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
