//! Le notifieur (E06–E09) : un payload métier → une livraison ENFILÉE vers
//! tous les abonnements du store.
//!
//! ⚠️ **Ce maillon manquait, et aucune notification ne partait.** Le payload
//! (`payload_de_notification`), le worker borné (`Livreur`) et la livraison
//! Web Push existaient, testés chacun de leur côté — mais rien ne les
//! appelait : la veille n'écrivait que le journal d'événements. Le démon Rust
//! n'envoyait donc **jamais** « Agent finished » ni « Agent needs you ».
//!
//! ⚠️ **Le veilleur ne doit jamais attendre le réseau.** `notifie` lit une
//! PHOTO des abonnements (un petit fichier, sous la porte du store le temps de
//! la lecture) puis **enfile** sans bloquer (`try_send`) : l'envoi, le délai
//! de 15 s, la concurrence et l'élagage 404/410 vivent dans le worker. Une
//! file pleine est un refus compté et nommé, jamais une attente.

use crate::delivery::{LivraisonPush, Livreur, RefusFile, TravailLivraison};
use crate::payload::PayloadNotification;
use crate::presence::PresenceAppareils;
use crate::store::{ErreurStore, GardienDeStore};
use std::sync::Arc;

/// Pourquoi une notification n'a pas pu être enfilée — une cause nommée.
#[derive(Debug)]
pub enum ErreurNotification {
    /// Le store des abonnements est illisible : rien n'est inventé.
    Store(ErreurStore),
    /// La file de livraison est pleine (64) : le refus est compté.
    FilePleine,
}

impl std::fmt::Display for ErreurNotification {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErreurNotification::Store(erreur) => {
                write!(f, "unreadable push subscriptions: {erreur:?}")
            }
            ErreurNotification::FilePleine => {
                f.write_str("push delivery queue full: notification dropped")
            }
        }
    }
}

/// Le texte remis au service push — les quatre champs du payload, le JSON
/// exact que le service worker lit (`title`, `body`, `tag`, `url`).
#[must_use]
pub fn texte_de_notification(payload: &PayloadNotification) -> String {
    serde_json::json!({
        "body": payload.body,
        "tag": payload.tag,
        "title": payload.title,
        "url": payload.url,
    })
    .to_string()
}

/// Le notifieur : le store (la photo des abonnements) et le worker borné.
pub struct Notifieur {
    store: Arc<GardienDeStore>,
    livreur: Livreur,
    /// Les appareils au premier plan : ils ne sont pas notifiés (H23).
    presence: Arc<PresenceAppareils>,
}

impl Notifieur {
    /// Le notifieur sur une livraison (réelle ou fausse) et le store.
    ///
    /// ⚠️ Démarre le worker : à appeler dans un runtime tokio (le démon
    /// l'appelle depuis `main`, les tests depuis `#[tokio::test]`).
    #[must_use]
    pub fn nouveau(livraison: Arc<dyn LivraisonPush>, store: Arc<GardienDeStore>) -> Self {
        let livreur = Livreur::nouveau(livraison, Arc::clone(&store));
        Self {
            store,
            livreur,
            presence: Arc::new(PresenceAppareils::nouvelle()),
        }
    }

    /// Le notifieur sur un livreur déjà composé (délai raccourci des tests).
    #[must_use]
    pub fn avec_livreur(livreur: Livreur, store: Arc<GardienDeStore>) -> Self {
        Self {
            store,
            livreur,
            presence: Arc::new(PresenceAppareils::nouvelle()),
        }
    }

    /// Partage le registre de présence du port (H23) : l'appareil où l'app
    /// est au premier plan n'est pas notifié.
    #[must_use]
    pub fn avec_presence(mut self, presence: Arc<PresenceAppareils>) -> Self {
        self.presence = presence;
        self
    }

    /// Enfile la notification vers les abonnements courants, sauf les
    /// appareils où l'app est au premier plan — rend le nombre d'abonnements
    /// visés (0 : personne à prévenir, rien n'est enfilé). Ne bloque jamais
    /// sur le réseau.
    pub fn notifie(&self, payload: &PayloadNotification) -> Result<usize, ErreurNotification> {
        let maintenant = std::time::Instant::now();
        let abonnements: Vec<_> = self
            .store
            .abonnements()
            .map_err(ErreurNotification::Store)?
            .into_iter()
            // L'appareil qui regarde déjà l'app n'a pas besoin d'être prévenu.
            .filter(|abonnement| !self.presence.est_present(&abonnement.endpoint, maintenant))
            .collect();
        if abonnements.is_empty() {
            return Ok(0);
        }
        let vises = abonnements.len();
        self.livreur
            .enfile(TravailLivraison {
                payload: texte_de_notification(payload),
                abonnements,
            })
            .map_err(|RefusFile::Pleine| ErreurNotification::FilePleine)?;
        Ok(vises)
    }

    /// Le worker — ses mesures (élagués, files pleines, échecs).
    #[must_use]
    pub fn livreur(&self) -> &Livreur {
        &self.livreur
    }
}
