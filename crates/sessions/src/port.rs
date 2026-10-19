//! Le port de sessions **réel** : résolution, pages, métadonnées.
//!
//! ⚠️ **Le contenu ne vient jamais d'Herdr** : il vient du fichier JSONL ou
//! de la base SQLite de l'agent. Herdr dit seulement **où** regarder (D008.1).
//!
//! ⚠️ **Un curseur est opaque et LIÉ à sa source** (`hc2:` : empreinte de la
//! source + session + génération + position). Un curseur d'une autre source,
//! ou d'un fichier remplacé (dev/ino changés), ne peut pas servir : la page
//! revient `reset: true` et le client **remplace** sa vue au lieu d'y ajouter.
//!
//! ⚠️ **Rien n'est complété.** Une source absente donne `Absente`, une source
//! vide `Vide`, un contenu tronqué `Invalide`, une panne d'accès `Io` — quatre
//! causes distinctes, jamais un 502 indifférencié.

use crate::agents::opencode;
use crate::cursor;
use crate::resolver::{Emplacement, Racines, Resolveur, SourceSession, source_session_de};
use crate::storage::jsonl::identity::{CurseurFichier, identite_de};
use crate::storage::jsonl::reader::{ErreurBorne, page_arriere, page_bornee};
use crate::storage::sqlite::worker::Ouvrier;
use domain::ports::SessionFuture;
use domain::session::{
    ResolvedSource, SessionEntry, SessionHint, SessionMetadata, SessionPage, SessionPageOutcome,
    SessionPageRequest, SourceKind,
};
use std::path::Path;

/// La cible d'une page quand le client ne la borne pas (fenêtre du fil).
pub const LIMITE_PAGE_DEFAUT: u32 = 512 * 1024;

/// Le port réel — les racines connues (les mêmes que le résolveur).
pub struct PortSessions {
    resolveur: Resolveur,
}

impl PortSessions {
    #[must_use]
    pub fn nouveau(racines: Racines) -> Self {
        Self {
            resolveur: Resolveur::nouveau(racines),
        }
    }

    /// Les racines utilisées — pour les tests et la composition.
    #[must_use]
    pub fn racines(&self) -> &Racines {
        &self.resolveur.racines
    }
}

/// L'empreinte d'une source : ce à quoi un curseur est **lié**.
#[must_use]
pub fn empreinte_de_source(source: &ResolvedSource) -> String {
    use sha2::Digest;
    let mut hacheur = sha2::Sha256::new();
    hacheur.update(source.base.as_bytes());
    if let Some(identifiant) = &source.session_id {
        hacheur.update([0]);
        hacheur.update(identifiant.as_str().as_bytes());
    }
    hacheur
        .finalize()
        .iter()
        .take(8)
        .map(|octet| format!("{octet:02x}"))
        .collect()
}

/// La source résolue depuis ce que Herdr publie : `None` quand **rien ne
/// prouve** une session (une valeur, pas une panne).
#[must_use]
pub fn resout(resolveur: &Resolveur, hint: &SessionHint) -> Option<ResolvedSource> {
    let emplacement = hint.published.as_ref().map(|publie| {
        Emplacement::nouveau(
            match publie.kind {
                domain::observation::SessionRefKind::Path => "path",
                domain::observation::SessionRefKind::Id => "id",
            },
            &publie.value,
        )
    });
    let kind = hint.agent.as_ref().map(|kind| kind.as_str().to_string());
    let source = source_session_de(
        resolveur,
        kind.as_deref(),
        emplacement.as_ref(),
        hint.title.as_deref(),
        hint.cwd.as_deref(),
    )?;
    Some(match source {
        SourceSession::Fichier { base } => ResolvedSource {
            kind: SourceKind::File,
            base: base.display().to_string(),
            session_id: None,
            family: hint.agent.clone(),
        },
        SourceSession::Sqlite {
            base,
            session_id,
            magasin,
        } => ResolvedSource {
            kind: SourceKind::Sqlite,
            base: base.display().to_string(),
            session_id: Some(domain::ids::SessionId::from(session_id)),
            family: Some(domain::ids::AgentKind::from(String::from(match magasin {
                crate::resolver::Magasin::Opencode => "opencode",
                crate::resolver::Magasin::Devin => "devin",
            }))),
        },
    })
}

/// Une page de fichier : le JSONL, borné, avec ses quatre clauses.
fn page_fichier(source: &ResolvedSource, request: &SessionPageRequest) -> SessionPageOutcome {
    let chemin = Path::new(&source.base);
    let empreinte = empreinte_de_source(source);
    // ⚠️ Le forward est borné par la CIBLE de T025 (2 MiB) dans `page_bornee` ;
    // `request.limit` (la fenêtre demandée) sert à l'historique, où le client
    // choisit combien il remonte.
    // 1) Le curseur : absent = première page (depuis le début) ; présent =
    //    décode `hc2:` et **lie** le curseur à cette source.
    let position: u64 = match request.cursor.as_deref() {
        None => 0,
        Some(brut) => {
            // ⚠️ `lie_a` fait les deux choses : il **valide** que le curseur
            // appartient à cette source et à cette session, et il recolle un
            // curseur LEGACY (qui n'en portait pas) — c'est le reset legacy.
            let lie =
                cursor::decode(brut).and_then(|curseur| curseur.lie_a(&empreinte, &source.base));
            match lie {
                Ok(lie) => u64::try_from(lie.position).unwrap_or(0),
                Err(cause) => {
                    return SessionPageOutcome::Invalide {
                        detail: format!("curseur refusé : {cause}"),
                    };
                }
            }
        }
    };

    // ⚠️ **L'identité du fichier est MESURÉE, pas portée par le curseur** : le
    // format `hc2:` ne transporte que source/session/génération/position.
    // Le seul reset qu'on puisse PROUVER sans dev/ino dans le jeton est une
    // **troncature** (position au-delà de la taille) — et il est dit.
    let identite = match identite_de(chemin) {
        Ok(identite) => identite,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
            return SessionPageOutcome::Absente(page_vide_de(source, request));
        }
        Err(cause) => {
            return SessionPageOutcome::Io {
                detail: cause.to_string(),
            };
        }
    };
    let tronque = position > identite.taille;
    let curseur = CurseurFichier {
        dev: identite.curseur.dev,
        ino: identite.curseur.ino,
        offset: if tronque { 0 } else { position },
    };

    // 2) Le fichier : absent = `Absente` (bénin, le JSONL naît au premier
    //    message), illisible = `Io`.
    let page = match page_bornee(chemin, &curseur, true) {
        Ok(page) => page,
        Err(ErreurBorne::RecordHorsPlafond { taille }) => {
            return SessionPageOutcome::Invalide {
                detail: format!("record de {taille} octets au-delà du plafond absolu"),
            };
        }
        Err(ErreurBorne::Io(cause))
            if cause.contains("No such file") || cause.contains("os error 2") =>
        {
            return SessionPageOutcome::Absente(page_vide_de(source, request));
        }
        Err(ErreurBorne::Io(cause)) => return SessionPageOutcome::Io { detail: cause },
    };
    let _ = &page;

    // 3) Les entrées, dans l'ordre de lecture — le brut est conservé.
    let entries: Vec<SessionEntry> = page
        .cadres
        .iter()
        .map(|cadre| entree_de_cadre(&cadre.brut))
        .collect();
    let nouveau_curseur = cursor::encode(
        &empreinte,
        &source.base,
        1,
        i64::try_from(page.curseur.offset).unwrap_or(0),
    );
    let page = SessionPage {
        session_path: source.base.clone(),
        entries,
        incremental: request.cursor.is_some(),
        cursor: Some(nouveau_curseur),
        // Une page arrière n'est pas demandée ici : le client la demande par
        // `previous_cursor`, et la présence d'historique est calculée par le
        // lecteur (`has_more` historique du fil).
        previous_cursor: Some(cursor::encode(&empreinte, &source.base, 1, 0)),
        has_more: page.curseur.offset > 0,
        // Un reset est dit seulement s'il est PROUVÉ : troncature, ou
        // réinitialisation constatée par le lecteur.
        reset: tronque || page.reinitialisee,
        rattrape: page.a_rattrape,
    };
    if page.entries.is_empty() && !page.reset {
        return SessionPageOutcome::Vide(page);
    }
    SessionPageOutcome::Page(page)
}

/// La page vide d'une source absente — le contexte de réponse (incrémental,
/// reset) est celui de la demande, jamais inventé.
fn page_vide_de(source: &ResolvedSource, request: &SessionPageRequest) -> SessionPage {
    SessionPage {
        session_path: source.base.clone(),
        entries: Vec::new(),
        incremental: request.cursor.is_some(),
        cursor: None,
        previous_cursor: None,
        has_more: false,
        reset: false,
        rattrape: false,
    }
}

/// Une page **arrière** : `previous_cursor` demande l'historique avant lui.
fn page_fichier_arriere(
    source: &ResolvedSource,
    request: &SessionPageRequest,
    avant: &str,
) -> SessionPageOutcome {
    let empreinte = empreinte_de_source(source);
    let lie = cursor::decode(avant).and_then(|curseur| curseur.lie_a(&empreinte, &source.base));
    let Ok(lie) = lie else {
        return SessionPageOutcome::Invalide {
            detail: String::from("curseur d'historique refusé"),
        };
    };
    // Même règle qu'en avant : l'identité est mesurée, la position vient du
    // jeton. Sans cela, `continuite` échouait et la page arrière rendait la
    // FIN du fichier au lieu de l'historique demandé.
    let identite = match identite_de(Path::new(&source.base)) {
        Ok(identite) => identite,
        Err(cause) => {
            return SessionPageOutcome::Io {
                detail: cause.to_string(),
            };
        }
    };
    let curseur = CurseurFichier {
        dev: identite.curseur.dev,
        ino: identite.curseur.ino,
        offset: u64::try_from(lie.position).unwrap_or(0),
    };
    let limite = if request.limit == 0 {
        LIMITE_PAGE_DEFAUT
    } else {
        request.limit
    } as usize;
    match page_arriere(Path::new(&source.base), &curseur, limite) {
        Ok(arriere) => {
            let entries: Vec<SessionEntry> = arriere
                .cadres
                .iter()
                .map(|cadre| entree_de_cadre(&cadre.brut))
                .collect();
            SessionPageOutcome::Page(SessionPage {
                cursor: Some(cursor::encode(
                    &empreinte,
                    &source.base,
                    1,
                    i64::try_from(curseur.offset).unwrap_or(0),
                )),
                entries,
                has_more: arriere.curseur.offset > 0,
                incremental: false,
                previous_cursor: Some(cursor::encode(
                    &empreinte,
                    &source.base,
                    1,
                    i64::try_from(arriere.curseur.offset).unwrap_or(0),
                )),
                reset: false,
                rattrape: false,
                session_path: source.base.clone(),
            })
        }
        Err(cause) => SessionPageOutcome::Io {
            detail: cause.to_string(),
        },
    }
}

/// Une entrée de session : le brut **tel quel**, et les trois champs de
/// position quand la ligne les porte.
#[must_use]
pub fn entree_de_cadre(brut: &str) -> SessionEntry {
    let valeur: serde_json::Value = serde_json::from_str(brut).unwrap_or(serde_json::Value::Null);
    SessionEntry {
        kind: valeur
            .get("type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("ligne")
            .to_string(),
        id: valeur
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        parent_id: valeur
            .get("parentId")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        raw: brut.to_string(),
        timestamp: valeur
            .get("timestamp")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    }
}

/// Une page SQLite (opencode/devin) : la famille décide de la lecture.
fn page_sqlite(source: &ResolvedSource, request: &SessionPageRequest) -> SessionPageOutcome {
    let Some(identifiant) = source.session_id.as_ref() else {
        return SessionPageOutcome::Invalide {
            detail: String::from("source SQLite sans identifiant de session"),
        };
    };
    let ouvrier = match Ouvrier::nouveau(Path::new(&source.base)) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => {
            return SessionPageOutcome::Io {
                detail: format!("base illisible : {cause}"),
            };
        }
    };
    // Le curseur SQLite est la position `seq` ; `hc2:` la porte comme les
    // autres, le décodage est le même.
    let empreinte = empreinte_de_source(source);
    let position = |brut: &str| -> Option<i64> {
        cursor::decode(brut)
            .ok()
            .and_then(|curseur| curseur.lie_a(&empreinte, identifiant.as_str()).ok())
            .map(|lie| lie.position)
    };
    let avant = request.previous_cursor.as_deref().and_then(position);
    let depuis = request.cursor.as_deref().and_then(position);
    let famille = source
        .family
        .as_ref()
        .map(|kind| kind.as_str().to_string())
        .unwrap_or_default();
    let reponse = match famille.as_str() {
        "opencode" => opencode::moteur::page_session(
            &ouvrier,
            identifiant.as_str(),
            avant,
            depuis,
            request.limit,
        ),
        _ => {
            return SessionPageOutcome::Invalide {
                detail: format!("famille SQLite non composée : {famille}"),
            };
        }
    };
    let Ok(page) = reponse else {
        return SessionPageOutcome::Io {
            detail: String::from("lecture SQLite échouée"),
        };
    };
    let entries: Vec<SessionEntry> = page
        .entrees
        .iter()
        .map(|entree| SessionEntry {
            kind: entree.genre.clone(),
            id: entree.id.clone(),
            parent_id: entree.parent_id.clone(),
            raw: entree.brut.clone(),
            timestamp: entree.timestamp.clone(),
        })
        .collect();
    let curseur = cursor::encode(&empreinte, identifiant.as_str(), 1, page.curseur);
    let precedent = page
        .previous_seq
        .map(|seq| cursor::encode(&empreinte, identifiant.as_str(), 1, seq))
        .unwrap_or_else(|| cursor::encode(&empreinte, identifiant.as_str(), 1, 0));
    let session = SessionPage {
        session_path: source.base.clone(),
        entries,
        incremental: page.incremental,
        cursor: Some(curseur),
        previous_cursor: Some(precedent),
        has_more: page.has_more,
        reset: false,
        rattrape: false,
    };
    if session.entries.is_empty() {
        return SessionPageOutcome::Vide(session);
    }
    SessionPageOutcome::Page(session)
}

impl domain::ports::SessionPort for PortSessions {
    fn resolve(&self, hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        let trouve = resout(&self.resolveur, &hint);
        Box::pin(async move { Ok(trouve) })
    }

    fn page(&self, request: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        Box::pin(async move {
            let issue = match request.source.kind {
                SourceKind::File => match request.previous_cursor.as_deref() {
                    Some(avant) => page_fichier_arriere(&request.source, &request, avant),
                    None => page_fichier(&request.source, &request),
                },
                SourceKind::Sqlite => page_sqlite(&request.source, &request),
            };
            Ok(issue)
        })
    }

    fn metadata(&self, source: ResolvedSource) -> SessionFuture<'_, SessionMetadata> {
        Box::pin(async move {
            // ⚠️ Aucun modèle « par défaut » : ce que le fichier déclare, ou
            // rien. Le réducteur complet (T026) vit dans `metadata` ; ici on
            // lit l'en-tête et on laisse le reste absent.
            if source.kind != SourceKind::File {
                return Ok(SessionMetadata::default());
            }
            let Ok(Some(en_tete)) =
                crate::storage::jsonl::history::en_tete(Path::new(&source.base))
            else {
                return Ok(SessionMetadata::default());
            };
            let _ = en_tete;
            Ok(SessionMetadata::default())
        })
    }
}
