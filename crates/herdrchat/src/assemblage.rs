//! L'assemblage : brancher les cinq ports sur les `Services` du routeur.
//!
//! ⚠️ **Trois adaptateurs de plus, et ils sont honnêtes sur leurs limites.**
//! - `ResoutSessionsViaPort` / `LitSessionsViaPort` : la résolution et la page
//!   passent par le `SessionPort` (le contenu vient du fichier ou de la base,
//!   jamais de Herdr). La lecture de liste ne garde que ce que le résumé
//!   consomme : rôle, texte, outil, réglages, horodatage.
//! - `TypesViaCatalogue` : la liste des types lançables vient de
//!   `integration.list`, comme le lancement.
//!
//! ⚠️ **Aucun substitut** : une page illisible devient une `ErreurDeLecture`
//! avec sa cause ; un type absent n'est pas inventé.

use application::commands::launch::ConstructeurArgs;
use application::conversations::{
    EntreeLu, ErreurDeLecture, GenreDeLigne, LitSessions, OutilAppele, RoleDeSession,
};
use application::git::{LanceurGitReel, LecteurBranches};
use application::noyau::{AgentObservation, PaneId, SessionRefKind};
use application::overview::{ResoutSessions, SourceDeSession};
use application::ports::{CatalogPort, SessionPort};
use application::refresh::SourceMaintenant;
use application::sessions_types::{
    ResolvedSource, SessionHint, SessionPageOutcome, SessionPageRequest, SourceKind,
};
use application::types_installes::{ErreurInventaire, InventaireTypes, TypeInstalle};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Le pont résolution : le `SessionPort` répond, l'application lit.
pub struct ResoutSessionsViaPort {
    pub port: Arc<dyn SessionPort>,
}

/// La résolution, **partagée** par les deux adaptateurs : `LitSessions` étend
/// `ResoutSessions`, et c'est SON `source_de` que la liste appelle — un stub
/// y rendait toutes les sessions « absentes » (trouvé en interrogeant le vrai
/// démon).
fn source_de_port(port: &dyn SessionPort, agent: &AgentObservation) -> Option<SourceDeSession> {
    let hint = SessionHint {
        agent: agent.agent.clone(),
        published: agent.session.clone(),
        title: agent.terminal_title.clone(),
        cwd: agent.cwd.clone(),
    };
    // ⚠️ Le port est un futur ; la lecture de liste est synchrone côté
    // application. On l'attend au premier poll (les adaptateurs sont
    // bloquants déguisés) — `Pending` serait un branchement cassé.
    let mut futur = port.resolve(hint);
    let issue = attend_session(&mut futur).ok().flatten()?;
    Some(SourceDeSession {
        kind: match issue.kind {
            SourceKind::File => SessionRefKind::Path,
            SourceKind::Sqlite => SessionRefKind::Id,
        },
        base: Some(issue.base),
        session_id: issue.session_id,
        cwd: None,
        parent: None,
    })
}

impl ResoutSessions for ResoutSessionsViaPort {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        source_de_port(self.port.as_ref(), agent)
    }
}

/// Le pont lecture : une fenêtre bornée, convertie en entrées de résumé.
pub struct LitSessionsViaPort {
    pub port: Arc<dyn SessionPort>,
    /// ⚠️ La **famille** de la source résolue, gardée sous la base :
    /// `SourceDeSession` du résumé ne la porte pas, et la lecture SQLite en a
    /// besoin (opencode ≠ devin). Sans elle, toutes les sessions SQLite
    /// échouaient — constaté sur le vrai démon.
    pub familles: Arc<Mutex<HashMap<String, application::noyau::AgentKind>>>,
}

/// La fenêtre lue pour un résumé — bornée (le résumé n'a pas besoin de tout).
pub const FENETRE_RESUME_OCTETS: u32 = 64 * 1024;

impl ResoutSessions for LitSessionsViaPort {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        let source = source_de_port(self.port.as_ref(), agent)?;
        if let (Some(base), Some(famille)) = (source.base.as_ref(), agent.agent.as_ref()) {
            self.familles
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(base.clone(), famille.clone());
        }
        Some(source)
    }
}

impl LitSessions for LitSessionsViaPort {
    fn fenetre(
        &self,
        _pane: &PaneId,
        source: &SourceDeSession,
    ) -> Result<Vec<EntreeLu>, ErreurDeLecture> {
        let Some(base) = source.base.as_ref() else {
            return Err(ErreurDeLecture {
                benin: true,
                cause: String::from("aucune base de session"),
            });
        };
        let demande = SessionPageRequest {
            source: ResolvedSource {
                kind: match source.kind {
                    SessionRefKind::Path => SourceKind::File,
                    SessionRefKind::Id => SourceKind::Sqlite,
                },
                base: base.clone(),
                session_id: source.session_id.clone(),
                family: self
                    .familles
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .get(base)
                    .cloned(),
            },
            cursor: None,
            previous_cursor: None,
            limit: FENETRE_RESUME_OCTETS,
        };
        let mut futur = self.port.page(demande);
        let issue = attend_session(&mut futur).map_err(|cause| ErreurDeLecture {
            benin: false,
            cause: cause.message_sur(),
        })?;
        match issue {
            SessionPageOutcome::Page(page) | SessionPageOutcome::Vide(page) => {
                Ok(page.entries.iter().map(entree_lue).collect())
            }
            SessionPageOutcome::Absente(_) => Err(ErreurDeLecture {
                benin: true,
                cause: String::from("session absente"),
            }),
            SessionPageOutcome::Invalide { detail } => Err(ErreurDeLecture {
                benin: false,
                cause: detail,
            }),
            SessionPageOutcome::Io { detail } => Err(ErreurDeLecture {
                benin: false,
                cause: detail,
            }),
        }
    }
}

/// Une ligne de session → ce que le résumé consomme.
///
/// ⚠️ **La forme pi est la forme commune** : `message.role`, `message.content`
/// (chaîne ou blocs `text`), `message.toolName` pour un appel d'outil, et
/// `timestamp`. Ce qui n'est pas reconnu reste `Autre` avec son texte brut —
/// on ne devine ni rôle ni contenu.
#[must_use]
pub fn entree_lue(entree: &application::sessions_types::SessionEntry) -> EntreeLu {
    let valeur: serde_json::Value =
        serde_json::from_str(&entree.raw).unwrap_or(serde_json::Value::Null);
    let message = valeur.get("message");
    let role = message
        .and_then(|m| m.get("role"))
        .and_then(serde_json::Value::as_str)
        .map(role_de);
    let genre = match entree.kind.as_str() {
        "message" => GenreDeLigne::Message,
        "model_change" => GenreDeLigne::ChangementModele,
        "thinking_level_change" => GenreDeLigne::ChangementPensee,
        _ => GenreDeLigne::Autre,
    };
    let texte = message
        .and_then(|m| m.get("content"))
        .and_then(texte_de_contenu);
    let outil = message
        .and_then(|m| m.get("toolName"))
        .and_then(serde_json::Value::as_str)
        .map(|nom| OutilAppele {
            nom: nom.to_string(),
            indice: None,
        });
    EntreeLu {
        role: role.unwrap_or(RoleDeSession::Autre),
        genre,
        texte,
        outil,
        modele: message
            .and_then(|m| m.get("model"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        fournisseur: message
            .and_then(|m| m.get("provider"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        niveau_pensee: message
            .and_then(|m| m.get("thinkingLevel"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        horodatage: entree.timestamp.as_deref().and_then(horodatage_ms),
    }
}

fn role_de(role: &str) -> RoleDeSession {
    match role {
        "user" => RoleDeSession::User,
        "assistant" => RoleDeSession::Assistant,
        "system" => RoleDeSession::System,
        "tool" => RoleDeSession::Outil,
        _ => RoleDeSession::Autre,
    }
}

/// Le texte d'un `content` : une chaîne, ou les blocs `text` concaténés.
fn texte_de_contenu(contenu: &serde_json::Value) -> Option<String> {
    if let Some(texte) = contenu.as_str() {
        return (!texte.is_empty()).then(|| texte.to_string());
    }
    let blocs = contenu.as_array()?;
    let texte: String = blocs
        .iter()
        .filter_map(|bloc| bloc.get("text").and_then(serde_json::Value::as_str))
        .collect::<Vec<&str>>()
        .join("");
    (!texte.is_empty()).then_some(texte)
}

/// Un horodatage ISO → millisecondes. Une forme illisible reste **absente**,
/// jamais remplacée par l'heure courante.
fn horodatage_ms(iso: &str) -> Option<u64> {
    // `YYYY-MM-DDTHH:MM:SS(.sss)?Z` — la forme des sessions.
    let (date, reste) = iso.split_once('T')?;
    let mut parts = date.split('-');
    let annee: i64 = parts.next()?.parse().ok()?;
    let mois: i64 = parts.next()?.parse().ok()?;
    let jour: i64 = parts.next()?.parse().ok()?;
    let heure_part = reste.trim_end_matches('Z');
    let mut hms = heure_part.split(':');
    let heures: i64 = hms.next()?.parse().ok()?;
    let minutes: i64 = hms.next()?.parse().ok()?;
    let secondes: f64 = hms.next()?.parse().ok()?;
    // Jours depuis l'époque (algorithme civil inverse).
    let y = annee - i64::from(mois <= 2);
    let epoque = y.div_euclid(400);
    let y_epoque = y - epoque * 400;
    let mois_epoque = if mois > 2 { mois - 3 } else { mois + 9 };
    let jours = epoque * 146_097 + (153 * mois_epoque + 2) / 5 + 365 * y_epoque + y_epoque / 4
        - y_epoque / 100
        + jour
        - 719_468;
    let ms =
        jours * 86_400_000 + heures * 3_600_000 + minutes * 60_000 + (secondes * 1000.0) as i64;
    u64::try_from(ms).ok()
}

/// La liste des types lançables, lue sur le port de catalogues.
pub struct TypesViaCatalogue {
    pub port: Arc<dyn CatalogPort>,
}

impl InventaireTypes for TypesViaCatalogue {
    fn installes(&self) -> Result<Vec<TypeInstalle>, ErreurInventaire> {
        let mut futur = self.port.installed();
        match attend(&mut futur) {
            Ok(types) => Ok(types
                .into_iter()
                .map(|type_installe| TypeInstalle {
                    commande: type_installe.kind.as_str().to_string(),
                    cible: type_installe.kind.as_str().to_string(),
                    installe: true,
                })
                .collect()),
            Err(cause) => Err(ErreurInventaire::Illisible {
                detail: cause.description(),
            }),
        }
    }
}

/// La validation des args : la fonction du catalogue, telle quelle.
#[must_use]
pub fn constructeur_d_args() -> Arc<ConstructeurArgs> {
    Arc::new(Box::new(
        |kind: &str, modele: Option<&str>, thinking: Option<&str>| {
            let issue = catalog::args::construit_args(kind, modele, thinking);
            match issue.erreur {
                Some(erreur) => Err(erreur),
                None => Ok(issue.args),
            }
        },
    ))
}

/// Le lecteur de branches — git, borné, injecté.
#[must_use]
pub fn lecteur_de_branches(maintenant: Arc<dyn SourceMaintenant>) -> LecteurBranches {
    LecteurBranches::nouveau(Box::new(LanceurGitReel), maintenant)
}

/// Attend un port : les adaptateurs sont bloquants déguisés (convention du
/// socle). `Pending` serait un branchement cassé — on le dit.
fn attend<T: Send>(
    futur: &mut application::ports::PortFuture<'_, T>,
) -> Result<T, application::noyau::PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}

/// Attend un port de SESSION : ses erreurs sont des `ErreurDomaine` typées
/// (400/403/404/409/422/502/503), pas des pannes de transport.
fn attend_session<T: Send>(
    futur: &mut application::ports::SessionFuture<'_, T>,
) -> Result<T, application::noyau::ErreurDomaine> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}
