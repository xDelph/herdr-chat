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

use crate::agents::{devin, opencode};
use crate::cursor;
use crate::normalisation::Normaliseur;
use crate::path_policy::{VerdictChemin, resolu_sous};
use crate::resolver::{Emplacement, Racines, Resolveur, SourceSession, source_session_de};
use crate::storage::jsonl::framing::{Cadre, prochain_debut_de_ligne};
use crate::storage::jsonl::identity::{CurseurFichier, identite_de};
use crate::storage::jsonl::reader::{ErreurBorne, page_arriere, page_bornee};
use crate::storage::sqlite::worker::{ErreurOuvrier, ReserveOuvriers};
use domain::errors::ErreurDomaine;
use domain::ports::SessionFuture;
use domain::session::{
    ResolvedSource, SessionEntry, SessionHint, SessionMetadata, SessionPage, SessionPageOutcome,
    SessionPageRequest, SourceKind,
};
use std::path::Path;

/// La cible d'une page quand le client ne la borne pas (fenêtre du fil).
pub const LIMITE_PAGE_DEFAUT: u32 = 512 * 1024;

/// Le nombre de lignes d'une page SQLite (opencode/devin) — celui du fil.
///
/// ⚠️ La `limit` d'une demande est une fenêtre en **octets** (celle des
/// JSONL). Elle était passée telle quelle en `LIMIT` SQL : 512 Kio devenaient
/// 524 288 lignes, donc toute la session à chaque ouverture.
pub const LIGNES_PAGE_SQLITE: u32 = 400;

/// Le port réel — les racines connues (les mêmes que le résolveur).
pub struct PortSessions {
    resolveur: Resolveur,
    normaliseur: Normaliseur,
    /// Un ouvrier SQLite long par base, partagé par toutes les lectures.
    ouvriers: ReserveOuvriers,
}

impl PortSessions {
    #[must_use]
    pub fn nouveau(racines: Racines) -> Self {
        Self {
            resolveur: Resolveur::nouveau(racines),
            normaliseur: Normaliseur::standard(),
            ouvriers: ReserveOuvriers::default(),
        }
    }

    /// Les racines où un fichier de session a le droit d'être lu (S03).
    fn racines_de_fichiers(&self) -> [std::path::PathBuf; 3] {
        let racines = &self.resolveur.racines;
        [
            racines.pi_sessions.clone(),
            racines.codex_sessions.clone(),
            racines.claude_projects.clone(),
        ]
    }

    /// Le chemin réellement ouvert — sous une racine autorisée, ou le refus
    /// et sa cause (un chemin annoncé par Herdr n'est jamais lu sans garde).
    fn garde(&self, source: &ResolvedSource) -> Result<ResolvedSource, SessionPageOutcome> {
        match resolu_sous(&self.racines_de_fichiers(), Path::new(&source.base)) {
            VerdictChemin::Autorise { .. } => Ok(source.clone()),
            VerdictChemin::Refuse { raison } => match raison {
                crate::path_policy::RefusChemin::CheminAbsent => {
                    Err(SessionPageOutcome::Absente(SessionPage {
                        session_path: source.base.clone(),
                        entries: Vec::new(),
                        incremental: false,
                        cursor: None,
                        previous_cursor: None,
                        has_more: false,
                        reset: false,
                        rattrape: false,
                    }))
                }
                autre => Err(SessionPageOutcome::Invalide {
                    detail: format!("{} : {}", autre.message(), source.base),
                }),
            },
        }
    }

    /// Combien d'ouvriers SQLite vivent — un par base lue, pas un par page.
    #[must_use]
    pub fn ouvriers_sqlite(&self) -> usize {
        self.ouvriers.nombre()
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

/// Le refus d'un `cursor` (H04 : 400 `invalid cursor`) — la cause réelle
/// (illisible, autre session) part dans le diagnostic.
fn curseur_refuse(cause: &cursor::ErreurCurseur) -> ErreurDomaine {
    ErreurDomaine::entree_invalide("invalid cursor").avec_cause(cause.to_string())
}

/// Le refus d'un `before` (H04 : 400 `invalid previous-page cursor`).
fn avant_refuse(cause: &cursor::ErreurCurseur) -> ErreurDomaine {
    ErreurDomaine::entree_invalide("invalid previous-page cursor").avec_cause(cause.to_string())
}

/// Un curseur d'historique qui ne décrit plus le fichier (remplacé, tronqué,
/// disparu) : H04 409 — le client recharge la conversation.
fn historique_perime(cause: &str) -> ErreurDomaine {
    ErreurDomaine::source_invalide("the session changed; reload the conversation to continue")
        .avec_cause(cause.to_string())
}

/// L'entrée servie pour un cadre : la ligne normalisée — ou, pour une ligne
/// hors plafond, une entrée `unknown` qui **dit** qu'elle a été ignorée
/// (jamais une ligne vide silencieuse, jamais un contenu inventé).
fn entree_de_cadre(
    normaliseur: &Normaliseur,
    famille: Option<&str>,
    cadre: &Cadre,
) -> Option<SessionEntry> {
    if cadre.hors_plafond {
        let raison = format!("line too large ({} bytes) skipped", cadre.consomme);
        return Some(SessionEntry {
            kind: String::from("unknown"),
            id: None,
            parent_id: None,
            raw: serde_json::json!({
                "type": "unknown",
                "ignored": true,
                "bytes": cadre.consomme,
                "reason": raison,
            })
            .to_string(),
            timestamp: None,
        });
    }
    if cadre.brut.trim().is_empty() {
        return None;
    }
    Some(normaliseur.entree(famille, &cadre.brut))
}

/// Le début de la **queue** d'un fichier : `taille - fenêtre`, aligné sur
/// le premier début de ligne (jamais une ligne coupée).
fn debut_de_queue(chemin: &Path, taille: u64, fenetre: u32) -> std::io::Result<u64> {
    let cible = u64::from(fenetre);
    if taille <= cible {
        return Ok(0);
    }
    let mut fichier = std::fs::File::open(chemin)?;
    prochain_debut_de_ligne(&mut fichier, taille - cible)
}

/// Une page de fichier : le JSONL, borné, avec ses quatre clauses.
fn page_fichier(
    normaliseur: &Normaliseur,
    source: &ResolvedSource,
    request: &SessionPageRequest,
) -> Result<SessionPageOutcome, ErreurDomaine> {
    let chemin = Path::new(&source.base);
    let empreinte = empreinte_de_source(source);
    // ⚠️ Le forward est borné par la CIBLE de T025 (2 MiB) dans `page_bornee` ;
    // `request.limit` (la fenêtre demandée) sert à la queue et à l'historique.
    let identite = match identite_de(chemin) {
        Ok(identite) => identite,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SessionPageOutcome::Absente(page_vide_de(source, request)));
        }
        Err(cause) => {
            return Ok(SessionPageOutcome::Io {
                detail: cause.to_string(),
            });
        }
    };
    let queue = || {
        debut_de_queue(chemin, identite.taille, request.limit).map_err(|cause| {
            SessionPageOutcome::Io {
                detail: cause.to_string(),
            }
        })
    };
    // 1) Le curseur : absent = la QUEUE ; présent = décodé, **lié**, et
    //    confronté au fichier mesuré.
    //
    // ⚠️ **Première page d'un GROS fichier = la QUEUE, pas l'origine.** Le banc
    // T065 a mesuré 18 ms pour une fenêtre de 64 Kio demandée sur un fichier de
    // 32 Mio : la lecture partait de l'octet 0.
    //
    // ⚠️ **Rotation et troncature repartent de la QUEUE, et le disent.** Le
    // curseur porte l'identité (dev, ino) du fichier lu : un fichier remplacé
    // au même chemin était lu depuis un offset périmé, et une troncature
    // repartait de l'octet 0 (tout le fichier poussé dans le flux). Un curseur
    // sans identité (émis avant elle) continue comme avant.
    let (position, remplace) = match request.cursor.as_deref() {
        None => match queue() {
            Ok(debut) => (debut, false),
            Err(issue) => return Ok(issue),
        },
        Some(brut) => {
            let lie = cursor::decode(brut)
                .and_then(|curseur| curseur.lie_a(&empreinte, &source.base))
                .map_err(|cause| curseur_refuse(&cause))?;
            let position = u64::try_from(lie.position)
                .map_err(|_| curseur_refuse(&cursor::ErreurCurseur::Illisible))?;
            let autre_fichier = lie.fichier.is_some_and(|(dev, ino)| {
                dev != identite.curseur.dev || ino != identite.curseur.ino
            });
            if autre_fichier || position > identite.taille {
                match queue() {
                    Ok(debut) => (debut, true),
                    Err(issue) => return Ok(issue),
                }
            } else {
                (position, false)
            }
        }
    };
    let curseur = CurseurFichier {
        dev: identite.curseur.dev,
        ino: identite.curseur.ino,
        offset: position,
    };

    // 2) Le fichier : absent = `Absente` (bénin, le JSONL naît au premier
    //    message), illisible = `Io`.
    let page = match page_bornee(chemin, &curseur, true) {
        Ok(page) => page,
        Err(ErreurBorne::Io(cause))
            if cause.contains("No such file") || cause.contains("os error 2") =>
        {
            return Ok(SessionPageOutcome::Absente(page_vide_de(source, request)));
        }
        Err(ErreurBorne::Io(cause)) => return Ok(SessionPageOutcome::Io { detail: cause }),
    };
    // 3) Les entrées, dans l'ordre de lecture — chacune passée par le point
    //    d'entrée unique (forme commune ; brute quand rien ne la traduit).
    let famille = source.family.as_ref().map(|kind| kind.as_str());
    let entries: Vec<SessionEntry> = page
        .cadres
        .iter()
        .filter_map(|cadre| entree_de_cadre(normaliseur, famille, cadre))
        .collect();
    let encode = |offset: u64| {
        cursor::encode_fichier(
            &empreinte,
            &source.base,
            1,
            i64::try_from(offset).unwrap_or(i64::MAX),
            page.curseur.dev,
            page.curseur.ino,
        )
    };
    let debut_page = page
        .cadres
        .first()
        .map_or(curseur.offset, |cadre| cadre.depart);
    let page = SessionPage {
        session_path: source.base.clone(),
        entries,
        incremental: request.cursor.is_some(),
        cursor: Some(encode(page.curseur.offset)),
        /*
          ⚠️ **`previous_cursor` pointe le DÉBUT DE LA PAGE SERVIE, pas zéro.**

          Il était encodé avec l'offset `0` en dur : la PWA demandait donc
          `before=<offset 0>` — une page **vide**, à chaque remontée. Le début
          de la page est `depart` du premier cadre rendu ; sans cadre, c'est la
          position de lecture elle-même (rien n'a été consommé).
        */
        previous_cursor: Some(encode(debut_page)),
        has_more: debut_page > 0,
        // Un reset est dit seulement s'il est PROUVÉ : identité changée,
        // troncature, ou réinitialisation constatée par le lecteur.
        reset: remplace || page.reinitialisee,
        rattrape: page.a_rattrape,
    };
    if page.entries.is_empty() && !page.reset {
        return Ok(SessionPageOutcome::Vide(page));
    }
    Ok(SessionPageOutcome::Page(page))
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
    normaliseur: &Normaliseur,
    source: &ResolvedSource,
    request: &SessionPageRequest,
    avant: &str,
) -> Result<SessionPageOutcome, ErreurDomaine> {
    let empreinte = empreinte_de_source(source);
    let lie = cursor::decode(avant)
        .and_then(|curseur| curseur.lie_a(&empreinte, &source.base))
        .map_err(|cause| avant_refuse(&cause))?;
    let position =
        u64::try_from(lie.position).map_err(|_| avant_refuse(&cursor::ErreurCurseur::Illisible))?;
    // L'identité est mesurée ; le jeton dit quel fichier il décrivait. Un
    // fichier remplacé, tronqué en deçà de la borne ou disparu : la borne ne
    // désigne plus rien — 409, jamais l'historique d'un autre fichier.
    let identite = match identite_de(Path::new(&source.base)) {
        Ok(identite) => identite,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
            return Err(historique_perime("session file disappeared"));
        }
        Err(cause) => {
            return Ok(SessionPageOutcome::Io {
                detail: cause.to_string(),
            });
        }
    };
    if lie
        .fichier
        .is_some_and(|(dev, ino)| dev != identite.curseur.dev || ino != identite.curseur.ino)
    {
        return Err(historique_perime("session file replaced"));
    }
    if position > identite.taille {
        return Err(historique_perime("session file truncated"));
    }
    let curseur = CurseurFichier {
        dev: identite.curseur.dev,
        ino: identite.curseur.ino,
        offset: position,
    };
    let limite = if request.limit == 0 {
        LIMITE_PAGE_DEFAUT
    } else {
        request.limit
    } as usize;
    let arriere = match page_arriere(Path::new(&source.base), &curseur, limite) {
        Ok(arriere) => arriere,
        Err(cause) => {
            return Ok(SessionPageOutcome::Io {
                detail: cause.to_string(),
            });
        }
    };
    let famille = source.family.as_ref().map(|kind| kind.as_str());
    let entries: Vec<SessionEntry> = arriere
        .cadres
        .iter()
        .filter_map(|cadre| entree_de_cadre(normaliseur, famille, cadre))
        .collect();
    let encode = |offset: u64| {
        cursor::encode_fichier(
            &empreinte,
            &source.base,
            1,
            i64::try_from(offset).unwrap_or(i64::MAX),
            arriere.curseur.dev,
            arriere.curseur.ino,
        )
    };
    Ok(SessionPageOutcome::Page(SessionPage {
        cursor: Some(encode(curseur.offset)),
        entries,
        has_more: arriere.curseur.offset > 0,
        incremental: false,
        previous_cursor: Some(encode(arriere.curseur.offset)),
        reset: false,
        rattrape: false,
        session_path: source.base.clone(),
    }))
}

/// Une page SQLite (opencode/devin) : la famille décide de la lecture.
fn page_sqlite(
    reserve: &ReserveOuvriers,
    source: &ResolvedSource,
    request: &SessionPageRequest,
) -> Result<SessionPageOutcome, ErreurDomaine> {
    let Some(identifiant) = source.session_id.as_ref() else {
        return Ok(SessionPageOutcome::Invalide {
            detail: String::from("SQLite source without a session id"),
        });
    };
    // Le curseur SQLite est la position `seq` ; `hc2:` la porte comme les
    // autres, le décodage est le même.
    //
    // ⚠️ **Un curseur refusé est une ERREUR, jamais la dernière page.** Le
    // décodage et la liaison étaient avalés (`.ok()`) : un curseur illisible
    // ou celui d'une AUTRE session rendait la page la plus récente en 200 —
    // dans le flux, un `Last-Event-ID` d'une autre conversation y mêlait ses
    // lignes (C12 : le curseur d'A ne lit jamais B).
    let empreinte = empreinte_de_source(source);
    let position = |brut: &str| -> Result<i64, cursor::ErreurCurseur> {
        cursor::decode(brut)
            .and_then(|curseur| curseur.lie_a(&empreinte, identifiant.as_str()))
            .map(|lie| lie.position)
    };
    let avant = request
        .previous_cursor
        .as_deref()
        .map(position)
        .transpose()
        .map_err(|cause| avant_refuse(&cause))?;
    let depuis = request
        .cursor
        .as_deref()
        .map(position)
        .transpose()
        .map_err(|cause| curseur_refuse(&cause))?;
    // H04/C04 : une base SQLite ABSENTE est une capacité indisponible (503),
    // distincte d'une base présente mais illisible (502) — « l'agent n'a pas
    // encore écrit sa base » n'est pas une panne de lecture.
    if !Path::new(&source.base).exists() {
        return Err(ErreurDomaine::source_absente(format!(
            "SQLite database missing: {}",
            source.base
        )));
    }
    let ouvrier = match reserve.ouvrier(Path::new(&source.base)) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => {
            return Ok(SessionPageOutcome::Io {
                detail: format!("unreadable database: {cause}"),
            });
        }
    };
    let famille = source
        .family
        .as_ref()
        .map(|kind| kind.as_str().to_string())
        .unwrap_or_default();
    // Chaque famille a son lecteur ; la composition avant/depuis/aucun est la
    // même (opencode la porte déjà, devin l'expose en trois fonctions).
    let page = match famille.as_str() {
        "opencode" => opencode::moteur::page_session(
            &ouvrier,
            identifiant.as_str(),
            avant,
            depuis,
            LIGNES_PAGE_SQLITE,
        )
        .map(|page| {
            (
                page.curseur,
                page.previous_seq,
                page.incremental,
                page.has_more,
                page.entrees,
            )
        }),
        "devin" => {
            let lue = match (avant, depuis) {
                (Some(borne), _) => devin::moteur::lire_avant(
                    &ouvrier,
                    identifiant.as_str(),
                    borne,
                    LIGNES_PAGE_SQLITE,
                ),
                (None, Some(borne)) => devin::moteur::lire_depuis(
                    &ouvrier,
                    identifiant.as_str(),
                    borne,
                    LIGNES_PAGE_SQLITE,
                ),
                (None, None) => {
                    devin::moteur::lire_derniere(&ouvrier, identifiant.as_str(), LIGNES_PAGE_SQLITE)
                }
            };
            lue.map(|page| {
                // Le curseur est la dernière ligne LUE ; la page précédente
                // repart de la première ligne RENDUE — les confondre ferait
                // redemander la même page.
                let curseur = avant.unwrap_or(page.dernier_seq);
                let precedent = page.has_more.then_some(page.premier_seq);
                (
                    curseur,
                    precedent,
                    depuis.is_some(),
                    page.has_more,
                    page.entrees,
                )
            })
        }
        _ => {
            return Ok(SessionPageOutcome::Invalide {
                detail: format!("SQLite family not composed: {famille}"),
            });
        }
    };
    let (curseur_lu, previous_seq, incremental, has_more, entrees) = match page {
        Ok(page) => page,
        // ⚠️ La cause réelle est rendue : un verrou, une table absente et un
        // schéma inattendu ne se diagnostiquent pas de la même façon.
        Err(cause) => {
            // Un ouvrier en échec est recréé à la lecture suivante — sauf
            // une file pleine : c'est une surcharge, pas une panne.
            if !cause.contains(&ErreurOuvrier::FilePleine.to_string()) {
                reserve.oublie(Path::new(&source.base), &ouvrier);
            }
            return Ok(SessionPageOutcome::Io {
                detail: format!("SQLite read failed ({famille}): {cause:?}"),
            });
        }
    };
    let entries: Vec<SessionEntry> = entrees
        .iter()
        .map(|entree| SessionEntry {
            kind: entree.genre.clone(),
            id: entree.id.clone(),
            parent_id: entree.parent_id.clone(),
            raw: entree.brut.clone(),
            timestamp: entree.timestamp.clone(),
        })
        .collect();
    let entries_lues = entries.len();
    let curseur = cursor::encode(&empreinte, identifiant.as_str(), 1, curseur_lu);
    let precedent = previous_seq
        .map(|seq| cursor::encode(&empreinte, identifiant.as_str(), 1, seq))
        .unwrap_or_else(|| cursor::encode(&empreinte, identifiant.as_str(), 1, 0));
    let session = SessionPage {
        session_path: source.base.clone(),
        entries,
        incremental,
        cursor: Some(curseur),
        previous_cursor: Some(precedent),
        has_more,
        reset: false,
        // Une page qui n'est pas pleine a tout lu : rien ne reste derrière ce
        // curseur. ⚠️ Sans cela, le flux de session (qui relit tant que la page
        // n'est pas « rattrapée ») bouclait sans fin sur la ligne frontière
        // relue par `seq >=` — 17 713 événements en 10 s, mesuré.
        rattrape: entries_lues < LIGNES_PAGE_SQLITE as usize,
    };
    if session.entries.is_empty() {
        // ⚠️ **Une session que la base ignore n'est pas une session vide.**
        // `session_existe` n'était jamais appelée : un identifiant inconnu
        // s'affichait comme une conversation vide. H04 (CURRENT.md) : une
        // ligne de session absente rend `cause: "absente"` — la session n'a
        // pas encore commencé (devin écrit sa ligne au premier message).
        let existe = match famille.as_str() {
            "opencode" => opencode::moteur::session_existe(&ouvrier, identifiant.as_str()),
            "devin" => devin::moteur::session_existe(&ouvrier, identifiant.as_str()),
            _ => Ok(true),
        };
        return Ok(match existe {
            Ok(true) => SessionPageOutcome::Vide(session),
            Ok(false) => SessionPageOutcome::Absente(SessionPage {
                cursor: Some(cursor::encode(&empreinte, identifiant.as_str(), 1, 0)),
                previous_cursor: None,
                has_more: false,
                ..session
            }),
            Err(cause) => SessionPageOutcome::Io {
                detail: format!("SQLite read failed ({famille}): {cause}"),
            },
        });
    }
    Ok(SessionPageOutcome::Page(session))
}

impl domain::ports::SessionPort for PortSessions {
    fn resolve(&self, hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        let trouve = resout(&self.resolveur, &hint);
        Box::pin(async move { Ok(trouve) })
    }

    fn page(&self, request: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        Box::pin(async move {
            // H04 : `cursor` et `before` sont exclusifs — les deux ensemble ne
            // décrivent aucune lecture (`valide_paire` existait, jamais appelée).
            cursor::valide_paire(
                request.cursor.as_deref(),
                request.previous_cursor.as_deref(),
            )
            .map_err(|cause| avant_refuse(&cause))?;
            match request.source.kind {
                SourceKind::File => match self.garde(&request.source) {
                    // H04/C04 : un chemin publié HORS des racines est un REFUS
                    // (403), pas un résultat invalide (422) — la garde a
                    // décidé, rien n'a été lu.
                    Err(SessionPageOutcome::Invalide { detail }) => {
                        Err(ErreurDomaine::chemin_refuse(detail))
                    }
                    Err(refus) => Ok(refus),
                    Ok(source) => match request.previous_cursor.as_deref() {
                        Some(avant) => {
                            page_fichier_arriere(&self.normaliseur, &source, &request, avant)
                        }
                        None => page_fichier(&self.normaliseur, &source, &request),
                    },
                },
                SourceKind::Sqlite => page_sqlite(&self.ouvriers, &request.source, &request),
            }
        })
    }

    fn metadata(&self, source: ResolvedSource) -> SessionFuture<'_, SessionMetadata> {
        Box::pin(async move {
            // ⚠️ Aucun modèle « par défaut » : ce que le fichier déclare, ou
            // rien. Le réducteur complet (T026) vit dans `metadata` ; ici on
            // lit l'EN-TÊTE — identifiant, dossier, parent — et rien d'autre.
            //
            // ⚠️ **L'en-tête était lu, puis jeté** : la méthode rendait
            // toujours le défaut. Mesuré sur le vrai démon : `sessionCwd` et
            // `sessionCwdMatches` absents pour 13 agents sur 13 (TS : 6/13),
            // `sessionId` d'une session Pi jamais exposé.
            if source.kind != SourceKind::File {
                return Ok(SessionMetadata::default());
            }
            // La même garde que la lecture : un chemin annoncé hors des
            // racines (S03) n'est jamais ouvert, même pour son en-tête.
            let Ok(source) = self.garde(&source) else {
                return Ok(SessionMetadata::default());
            };
            // D09 : un en-tête illisible ou absent n'est pas une panne — les
            // champs restent absents, rien n'est deviné.
            let Ok(Some(en_tete)) =
                crate::storage::jsonl::history::en_tete(Path::new(&source.base))
            else {
                return Ok(SessionMetadata::default());
            };
            Ok(SessionMetadata {
                session_id: en_tete.id,
                cwd: en_tete.cwd,
                parent_session: en_tete.parent_session,
                ..SessionMetadata::default()
            })
        })
    }
}
