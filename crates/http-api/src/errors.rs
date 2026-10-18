//! La cartographie des erreurs vers le fil HTTP — **par route**, depuis le
//! registre et CURRENT.md §2 (T010).
//!
//! ⚠️ **Le domaine ne porte aucun statut HTTP** (TECH §5) : [`statut`] est
//! LA table de décision, route par route. Les statuts hors des variantes
//! documentées d'une route restent possibles (CURRENT.md §2 : les défauts
//! non attrapés produisent un 500 d'exécution) — le 500 est le repli nommé,
//! jamais un succès fabriqué.
//!
//! ⚠️ **Les formes atypiques documentées sont conservées** :
//! H09 (catalogue indisponible = **valeur** du 200, pas une panne),
//! H11 (échec Herdr = `focused: false`), H13 (échec = `{ok:false}`),
//! H15 (503 en **texte brut**), H05 (échec = `PromptFailedResponse` à trois
//! états, B05 : jamais « envoyé »).

use contracts::http::catalog::ModelCatalogResponse;
use contracts::http::commands::{
    AgentFocusedResponse, FocusStatus, PromptFailedResponse, SendState,
};
use contracts::http::diagnostics::ClientLogResponse;
use contracts::http::errors::{ApiErrorResponse, ReadCause};
use contracts::presence::Field;
use contracts::registry::RouteId;
use domain::errors::{ErreurDomaine, Nature};

/// Le corps d'erreur générique : message sûr, code diagnostic en indicateur.
#[must_use]
pub fn corps(erreur: &ErreurDomaine) -> ApiErrorResponse {
    ApiErrorResponse {
        cause: Field(None),
        error: erreur.message_sur(),
        hint: Field::de_option(Some(format!(
            "code diagnostic : {}",
            erreur.diagnostic.code
        ))),
    }
}

/// Le corps avec sa cause de lecture **nommée** — invalide ≠ vide ≠ absent
/// ≠ IO (C04) : la cause passe, jamais aplatie.
#[must_use]
pub fn corps_de_lecture(cause: ReadCause, erreur: &ErreurDomaine) -> ApiErrorResponse {
    ApiErrorResponse {
        cause: Field::de_option(Some(cause)),
        error: erreur.message_sur(),
        hint: Field::de_option(Some(format!(
            "code diagnostic : {}",
            erreur.diagnostic.code
        ))),
    }
}

/// Le statut par route — LA table de décision. Chaque bras cite le document
/// (CURRENT.md §2, ligne Hxx) ; le 500 de repli reste nommé (InternalInvariant
/// ou nature hors périmètre documenté).
#[must_use]
pub fn statut(route: RouteId, erreur: &ErreurDomaine) -> u16 {
    let nature = erreur.nature;
    match route {
        // H01 : 503 même schéma (ok:false, reachable:false) ; 500 unreadable.
        RouteId::Sante => match nature {
            Nature::InternalInvariant => 500,
            _ => 503,
        },
        // H02 : 500 par le run générique (échec Herdr/décodage).
        RouteId::Overview => 500,
        // H03 : 503 échec snapshot ; 502 snapshot illisible.
        RouteId::Conversations => match nature {
            Nature::UpstreamUnavailable
            | Nature::Deadline
            | Nature::Overloaded
            | Nature::NoSource => 503,
            Nature::InternalInvariant | Nature::InvalidInput | Nature::PathDenied => 500,
            _ => 502,
        },
        // H04 : 400 curseurs ; 403 chemin refusé ; 404 pas de source ; 409
        // curseur d'historique périmé ; 422 résultat invalide ; 502 lecture
        // ; 503 base SQLite manquante.
        RouteId::SessionAgent => match nature {
            Nature::InvalidInput => 400,
            Nature::PathDenied => 403,
            Nature::NoSource => 404,
            Nature::SourceInvalid => 409,
            Nature::UpstreamMalformed => 422,
            Nature::SourceAbsent => 503,
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H05 : 400 corps malformé ; 502 prompt raté (corps nommé) ; 500.
        // (Le 413 est la garde de taille — avant toute nature.)
        RouteId::Prompt => match nature {
            Nature::InvalidInput => 400,
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H06 : 404 pas d'agent dans le pane ; 502 snapshot/décodage/touches.
        RouteId::Arret => match nature {
            Nature::NoSource => 404,
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H07 : 400 corps invalide/type indisponible ; 503 découverte des
        // types échouée ; 502 validation/tab/lancement ; 500.
        RouteId::Lancement => match nature {
            Nature::InvalidInput | Nature::NoSource => 400,
            Nature::UpstreamUnavailable | Nature::Deadline | Nature::Overloaded => 503,
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H08 : 502 recherche/décodage des intégrations échoué.
        RouteId::TypesInstalles => match nature {
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H09 : **aucune branche non-200 documentée** — le catalogue
        // indisponible est une VALEUR du 200 ([`catalogue_en_valeur`]).
        RouteId::CatalogueModeles => 200,
        // H10 : 400 forme du corps ; 502 échec Herdr ; 500.
        RouteId::ReponseQuestion => match nature {
            Nature::InvalidInput => 400,
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H11 : l'échec Herdr rend `focused:false` — pas une erreur du fil.
        RouteId::Focus => 200,
        // H12 : 400 corps invalide ; 502 échec Herdr ; 500.
        RouteId::Confiance => match nature {
            Nature::InvalidInput => 400,
            Nature::InternalInvariant => 500,
            _ => 502,
        },
        // H13 : documenté 200/400 seulement — un échec serveur rend
        // `{ok:false}` au 200 et passe par le journal diagnostic.
        RouteId::JournalClient => 200,
        // H14 : 503 quand le plafond de flux est atteint ; 500 nommé sinon.
        RouteId::FluxSse => match nature {
            Nature::InternalInvariant => 500,
            _ => 503,
        },
        // H15 : 503 service absent — TEXTE brut ; 500 JSON panne de setup.
        RouteId::CleVapid => match nature {
            Nature::UpstreamUnavailable
            | Nature::Deadline
            | Nature::Overloaded
            | Nature::NoSource => 503,
            _ => 500,
        },
        // H16 : 400 abonnement invalide ; 503 service absent ; 500
        // lecture/écriture/clef.
        RouteId::Abonnements => match nature {
            Nature::InvalidInput => 400,
            Nature::UpstreamUnavailable
            | Nature::Deadline
            | Nature::Overloaded
            | Nature::NoSource => 503,
            _ => 500,
        },
        // H17 : 403 paramètre manquant, fichier refusé/indisponible,
        // recherche échouée ; 500 résultat interne illisible.
        RouteId::Fichier => match nature {
            Nature::InternalInvariant => 500,
            _ => 403,
        },
        // H18 : 502 échec snapshot/balayage.
        RouteId::Images => match nature {
            Nature::InternalInvariant => 500,
            _ => 502,
        },
    }
}

/// La réponse d'erreur **nommée par route** — le germe des enums de réponse
/// explicites de TECH §5 ; les handlers T050+ l'embrassent.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ReponseErreur {
    /// `ApiErrorResponse` — la forme commune.
    Api(ApiErrorResponse),
    /// H05 : l'échec nommé à trois états (B05).
    PromptRate(PromptFailedResponse),
    /// H15 : le 503 est du texte brut.
    TexteBrut(String),
}

/// L'état d'un prompt raté, par nature (B05 : `attente | erreur | inconnu`).
fn etat_de_prompt(nature: Nature) -> SendState {
    match nature {
        // L'amont a refusé : l'envoi a été rejeté, pas perdu.
        Nature::UpstreamRejected => SendState::Erreur,
        // Réponse hors forme ou action partielle : l'état réel est
        // inconnaissable depuis ici.
        Nature::UpstreamMalformed | Nature::PartialAction => SendState::Inconnu,
        // Injoignable, délai dépassé, saturé : Herdr n'a pas tranché —
        // l'utilisateur doit pouvoir renvoyer.
        _ => SendState::Attente,
    }
}

/// La réponse d'erreur pour une route donnée — statut et corps **cohérents
/// par construction** (le handler n'assemble jamais à la main).
#[must_use]
pub fn reponse_erreur(route: RouteId, erreur: &ErreurDomaine) -> (u16, ReponseErreur) {
    let statut = statut(route, erreur);
    let corps = match route {
        // H05 : le 502 porte l'échec nommé à trois états (B05) ; les 400/500
        // restent des gardes — corps Api.
        RouteId::Prompt if statut == 502 => ReponseErreur::PromptRate(PromptFailedResponse {
            detail: erreur.message_sur(),
            state: etat_de_prompt(erreur.nature),
        }),
        RouteId::CleVapid if statut == 503 => ReponseErreur::TexteBrut(erreur.message_sur()),
        _ => ReponseErreur::Api(corps(erreur)),
    };
    (statut, corps)
}

/// H09 : le catalogue indisponible est une **valeur** du 200 — error nommé,
/// listes vides (un vide mesuré, pas une panne silencieuse).
#[must_use]
pub fn catalogue_en_valeur(
    kind: &str,
    source: &str,
    erreur: &ErreurDomaine,
) -> ModelCatalogResponse {
    ModelCatalogResponse {
        error: contracts::presence::Nullable::Valeur(erreur.message_sur()),
        kind: kind.to_string(),
        models: Vec::new(),
        thinking_levels: Vec::new(),
        source: source.to_string(),
    }
}

/// H11 : l'échec Herdr rend `focused: false` — le fait, jamais un succès
/// inventé.
#[must_use]
pub fn focus_sans_effet() -> AgentFocusedResponse {
    AgentFocusedResponse {
        focused: false,
        status: FocusStatus::AgentFocused,
    }
}

/// H13 : l'échec rend `{ok: false}`.
#[must_use]
pub fn journal_sans_effet() -> ClientLogResponse {
    ClientLogResponse { ok: false }
}
