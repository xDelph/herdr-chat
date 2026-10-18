//! H14 `GET /api/events` — le flux du direct (SSE).
//!
//! ⚠️ **Le journal est l'autorité** (TECH §7, C11) : `Last-Event-ID` rejoue
//! exactement ce qui a été manqué ; si la continuité n'est plus garantie
//! (journal tronqué, curseur d'une autre époque, curseur legacy numérique),
//! un `resync` **unique** est émis avec le curseur de reprise courant —
//! jamais un trou silencieux, jamais deux resyncs.
//!
//! ⚠️ **Pas de `Last-Event-ID` = pas d'historique** : une nouvelle fenêtre
//! repart de la frontière courante (`ready`), elle ne rejoue pas l'historique.
//!
//! ⚠️ **La sonnette est bornée** (T043) : un consommateur lent ne bloque
//! jamais la publication. Si elle a laissé tomber un événement (canal plein),
//! le réveil suivant relit le JOURNAL depuis le dernier curseur émis — la
//! sonnette n'est qu'une porte, le journal est la réponse.
//!
//! ⚠️ **L'abonnement est un RAII** : la coupure de la réponse (client parti)
//! ferme le canal, le travailleur s'arrête, l'abonnement tombe et **rend son
//! permis** — le plafond de 8 flux redescend vraiment.

use crate::publication::APublier;
use crate::services::Services;
use application::events::journal::{EvenementJournal, Rattrapage};
use application::events::subscription::{
    ABONNEMENTS_MAX, Abonnement, RefusAbonnement, ServiceAbonnements,
};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use contracts::events::{Ready, Resync};
use std::convert::Infallible;
use std::sync::Arc;

/// La profondeur de la file entre le travailleur bloquant et la réponse —
/// bornée : un client qui n'écrit plus ne fait pas grossir la mémoire du
/// serveur, et le journal reste la source pour ce qui est perdu.
const FILE_FLUX: usize = 64;

/// Le flux — `Last-Event-ID` en entrée, `text/event-stream` en sortie.
pub async fn flux(
    axum::extract::State(services): axum::extract::State<Arc<Services>>,
    entetes: axum::http::HeaderMap,
) -> Response {
    let curseur = entetes
        .get("last-event-id")
        .and_then(|valeur| valeur.to_str().ok())
        .unwrap_or("")
        .to_string();
    let abonnement = match services.journal.abonne(&curseur) {
        Ok(abonnement) => abonnement,
        // Le 9e flux est refusé — la capacité est DITE, pas promise.
        Err(RefusAbonnement::TropDeFlux) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                axum::Json(serde_json::json!({
                    "error": format!(
                        "trop de flux ouverts (maximum {ABONNEMENTS_MAX}) — réessayez"
                    )
                })),
            )
                .into_response();
        }
    };
    // La file entre le travailleur (bloquant, comme les ports T043) et la
    // réponse (asynchrone) : `blocking_send` côté travailleur, `recv().await`
    // côté flux.
    let (emetteur, recepteur) = tokio::sync::mpsc::channel::<Event>(FILE_FLUX);
    let battement = services.battement_flux;
    tokio::task::spawn_blocking(move || travaille(abonnement, emetteur, battement));
    let flux = futures_util::stream::unfold(recepteur, |mut recepteur| async move {
        let suivant = recepteur.recv().await?;
        Some((Ok::<_, Infallible>(suivant), recepteur))
    });
    Sse::new(flux)
        .keep_alive(
            KeepAlive::new()
                .interval(services.battement_flux)
                .text("keep-alive"),
        )
        .into_response()
}

/// Le travailleur du flux : le préambule (ready/resync/rattrapage), puis le
/// direct et la relecture du journal après une sonnette muette.
///
/// ⚠️ Il s'arrête dès que la réponse est tombée (`send` en échec) : c'est ce
/// qui libère le permis d'abonnement.
fn travaille(
    abonnement: Abonnement,
    emetteur: tokio::sync::mpsc::Sender<Event>,
    battement: std::time::Duration,
) {
    let frontiere = abonnement.dernier_id().map_or(0, |id| id.sequence);
    let mut curseur = frontiere;
    let mut resync_emis = false;
    // 1) `ready` — sans identifiant, immédiatement à l'ouverture.
    if !envoie(
        &emetteur,
        EvenementSse::sans_id("ready", &Ready { cursor: frontiere }),
    ) {
        return;
    }
    // 2) Le rattrapage : un resync UNIQUE, ou les événements retenus.
    let rattrapage = abonnement.rattrapage().clone();
    if rattrapage.resync_requis {
        resync_emis = true;
        curseur = rattrapage.reprendre_de.sequence;
        if !envoie(&emetteur, evenement_de_resync(&rattrapage)) {
            return;
        }
    } else {
        for evenement in &rattrapage.evenements {
            curseur = evenement.id.sequence;
            if !envoie(&emetteur, EvenementSse::du_journal(evenement)) {
                return;
            }
        }
    }
    // 3) Le direct — la sonnette, puis le journal quand elle se tait.
    loop {
        if let Some(evenement) = abonnement.attend(battement) {
            curseur = evenement.id.sequence;
            if !envoie(&emetteur, EvenementSse::du_journal(&evenement)) {
                return;
            }
            continue;
        }
        // La réponse est-elle tombée ? Sans cette garde, un flux muet (journal
        // vide) ne le saurait jamais : le travailleur attendrait en boucle et
        // le client parti laisserait un abonnement vivant pour toujours.
        if emetteur.is_closed() {
            return;
        }
        // La sonnette s'est tue : le journal peut avoir plus que ce qu'une
        // file bornée a laissé passer. On relit depuis le curseur émis.
        let manquants = abonnement.rattrapage_apres(curseur);
        if manquants.resync_requis && !resync_emis {
            resync_emis = true;
            curseur = manquants.reprendre_de.sequence;
            if !envoie(&emetteur, evenement_de_resync(&manquants)) {
                return;
            }
            continue;
        }
        for evenement in &manquants.evenements {
            curseur = evenement.id.sequence;
            if !envoie(&emetteur, EvenementSse::du_journal(evenement)) {
                return;
            }
        }
        // Rien : on n'invente pas d'événement. Le keep-alive d'axum écrit le
        // commentaire `:` qui empêche un proxy de couper une connexion muette.
    }
}

/// Envoie un événement — `false` quand la réponse est tombée (client parti).
fn envoie(emetteur: &tokio::sync::mpsc::Sender<Event>, evenement: EvenementSse) -> bool {
    emetteur.blocking_send(evenement.vers_event()).is_ok()
}

/// L'événement de resynchronisation — le curseur de reprise est celui du
/// journal, jamais un numéro reconstruit.
fn evenement_de_resync(rattrapage: &Rattrapage) -> EvenementSse {
    EvenementSse {
        id: Some(rattrapage.reprendre_de.opaque()),
        genre: String::from("resync"),
        donnees: serde_json::to_vec(&Resync {
            reason: String::from("truncated journal"),
            resume_from: rattrapage.reprendre_de.sequence,
        })
        .unwrap_or_else(|cause| panic!("resync se sérialise : {cause}")),
    }
}

/// Un événement SSE prêt : identifiant optionnel (jamais pour `ready`), nom
/// et charge JSON **telle quelle** (déjà sérialisée par le contrat).
struct EvenementSse {
    id: Option<String>,
    genre: String,
    donnees: Vec<u8>,
}

impl EvenementSse {
    /// Un événement sans identifiant (`ready`) — le fil en émet un à
    /// l'ouverture, et il n'appartient pas au journal.
    fn sans_id<T: serde::Serialize>(genre: &str, charge: &T) -> Self {
        Self {
            id: None,
            genre: String::from(genre),
            donnees: serde_json::to_vec(charge)
                .unwrap_or_else(|cause| panic!("{genre} se serialise : {cause}")),
        }
    }

    /// Un événement du journal — son identifiant est la forme opaque du fil.
    fn du_journal(evenement: &EvenementJournal) -> Self {
        Self {
            id: Some(evenement.id.opaque()),
            genre: evenement.genre.clone(),
            donnees: evenement.donnees.clone(),
        }
    }

    fn vers_event(self) -> Event {
        let mut evenement = Event::default();
        if let Some(id) = self.id {
            evenement = evenement.id(id);
        }
        evenement = evenement.event(self.genre);
        // La charge part TELLE QUELLE : le client la décode contre le
        // contrat, il ne la re-formate pas au passage.
        evenement.data(String::from_utf8_lossy(&self.donnees))
    }
}

/// Publie un lot d'événements dans le journal du direct — l'unique porte des
/// handlers de commande et du veilleur (T041).
///
/// ⚠️ L'échec est **rendu**, pas avalé : un journal plein ne défait pas
/// l'action déjà effectuée (l'envoi a eu lieu), mais l'appelant doit pouvoir
/// le dire. Aujourd'hui les handlers l'ignorent explicitement (`let _ =`),
/// parce que la preuve de l'action ne dépend pas de la trace.
pub fn publie(
    journal: &ServiceAbonnements,
    evenements: &[APublier],
) -> Result<(), application::events::journal::ErreurJournal> {
    for evenement in evenements {
        journal.publie(evenement.genre, evenement.donnees.clone())?;
    }
    Ok(())
}
