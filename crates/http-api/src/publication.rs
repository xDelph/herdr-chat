//! La publication des événements du direct (T053) — le pont entre les
//! valeurs de l'application et les charges **du contrat**, puis le journal.
//!
//! ⚠️ **Pourquoi ici et pas dans `application`** : le contrat (`contracts`)
//! dépend du domaine, et `application` est en amont — il ne peut pas le
//! nommer (graphe). Le handler HTTP, lui, a les deux : c'est donc lui qui
//! sérialise, et une fonction par genre évite que deux publications
//! divergent.
//!
//! ⚠️ **Ce qui n'est pas publié ne doit pas être inventé** : `session_changed`
//! est le SEUL événement ajouté par la migration (C26). Il naît de
//! l'observation de la SOURCE (`Changement::source_change`), jamais d'une
//! lecture de messages — Herdr n'expose aucun compteur de messages.

use application::events::watcher::{Changement, CibleDeChangement, GenreDeChangement};
use contracts::events::{
    AgentLaunched, AgentStatusChanged, ChangeKind, Confirmation, PromptDelivered, PromptStatus,
    PromptSuppressed, SessionChanged,
};
use contracts::presence::Nullable;
use domain::ids::AgentKind;

/// Le nom d'événement du fil pour un état changé (`agent_status`, avec son
/// soulignement mesuré).
pub const GENRE_AGENT_STATUS: &str = "agent_status";
/// Le nom d'événement du prompt livré.
pub const GENRE_PROMPT: &str = "prompt";
/// Le nom d'événement du double envoi supprimé.
pub const GENRE_PROMPT_SUPPRESSED: &str = "prompt-suppressed";
/// Le nom d'événement du lancement.
pub const GENRE_AGENT_LAUNCHED: &str = "agent-launched";
/// Le nom d'événement **ajouté** (C26) : la source de session a changé.
pub const GENRE_SESSION_CHANGED: &str = "session_changed";

/// Un événement prêt à publier : le genre et la charge JSON déjà encodée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct APublier {
    pub genre: &'static str,
    pub donnees: Vec<u8>,
}

/// Les événements d'un changement de veille : `agent_status`, et
/// `session_changed` **si et seulement si** la source a changé.
///
/// ⚠️ Un changement de source sans changement d'état (le cas courant quand
/// Herdr publie enfin le chemin de session) produit un `session_changed`
/// **seul** — l'inverse serait un `agent_status` inventé.
#[must_use]
pub fn evenements_de_changement(changement: &Changement) -> Vec<APublier> {
    let mut evenements = vec![APublier {
        genre: GENRE_AGENT_STATUS,
        donnees: serialise(&AgentStatusChanged {
            from: match changement.de {
                Some(statut) => Nullable::Valeur(statut.to_string()),
                // L'agent APPARAÎT : aucun état antérieur — un null mesuré.
                None => Nullable::Nulle,
            },
            kind: match changement.genre {
                GenreDeChangement::Apparu => ChangeKind::Appeared,
                GenreDeChangement::Statut => ChangeKind::Status,
                GenreDeChangement::Disparu => ChangeKind::Disappeared,
            },
            pane_id: changement.pane_id.as_str().to_string(),
            // Le fil tel quel : `gone` pour un agent disparu (pas un état).
            to: match changement.a {
                CibleDeChangement::Statut(statut) => statut.to_string(),
                CibleDeChangement::Disparu => String::from("gone"),
            },
        }),
    }];
    if changement.source_change() {
        evenements.push(APublier {
            genre: GENRE_SESSION_CHANGED,
            donnees: serialise(&SessionChanged {
                path: match &changement.source_apres {
                    Some(chemin) => Nullable::Valeur(chemin.clone()),
                    None => Nullable::Nulle,
                },
                pane_id: changement.pane_id.as_str().to_string(),
            }),
        });
    }
    evenements
}

/// L'événement d'un prompt envoyé — la confirmation vient de la PREUVE, pas
/// de l'intention (A02).
#[must_use]
pub fn evenement_de_prompt(pane_id: &str, empreinte: &str, confirme: bool) -> APublier {
    APublier {
        genre: GENRE_PROMPT,
        donnees: serialise(&PromptDelivered {
            pane_id: String::from(pane_id),
            confirmation: if confirme {
                Confirmation::Confirmed
            } else {
                Confirmation::Unknown
            },
            fingerprint: String::from(empreinte),
            status: PromptStatus::Sent,
        }),
    }
}

/// L'événement d'un double envoi supprimé — le motif mesuré du fil.
#[must_use]
pub fn evenement_de_prompt_supprime(pane_id: &str) -> APublier {
    APublier {
        genre: GENRE_PROMPT_SUPPRESSED,
        donnees: serialise(&PromptSuppressed {
            pane_id: String::from(pane_id),
            reason: String::from("consecutive identical send"),
        }),
    }
}

/// L'événement d'un lancement réussi — l'agent ET son projet, jamais un
/// identifiant nu.
#[must_use]
pub fn evenement_de_lancement(kind: &AgentKind, pane_id: &str, workspace_id: &str) -> APublier {
    APublier {
        genre: GENRE_AGENT_LAUNCHED,
        donnees: serialise(&AgentLaunched {
            kind: kind.as_str().to_string(),
            pane_id: String::from(pane_id),
            workspace_id: String::from(workspace_id),
        }),
    }
}

/// Sérialise une charge du contrat — un échec serait un défaut de contrat,
/// pas une valeur : ces structures ont des champs simples, l'échec ne peut
/// pas arriver, et le dire bruyamment vaut mieux que publier un `[]`.
fn serialise<T: serde::Serialize>(valeur: &T) -> Vec<u8> {
    serde_json::to_vec(valeur).unwrap_or_else(|cause| {
        panic!("une charge de contrat doit se sérialiser ({cause}) — défaut de contrat")
    })
}
