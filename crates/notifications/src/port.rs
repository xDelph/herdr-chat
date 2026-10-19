//! Le port de notifications **réel** : `notifications` → `NotificationPort`.
//!
//! ⚠️ **La clé privée ne sort jamais.** Le port ne rend que la clé publique ;
//! le store la lit, la livraison l'utilise, et rien d'autre n'y a accès.
//!
//! ⚠️ **Trois issues distinctes, jamais confondues** (A02) :
//! - pas de clé configurée → `None` (capacité absente, l'écran l'affiche) ;
//! - magasin illisible → `Err` (panne réelle, l'écran ne la cache pas) ;
//! - remise acceptée → `Delivered`, sans preuve → `Unknown` (jamais « envoyé »).

use crate::delivery::{ErreurLivraison, LivraisonPush, TTL_LIVRAISON};
use crate::store::{AbonnementPush, ClefsAbonnement, ErreurStore, GardienDeStore};
use crate::webpush::LivraisonWebPush;
use domain::errors::PortError;
use domain::notifications::{
    BrowserSubscription, PushPayload, PushSubscriptionKeys, VapidPublicKey,
};
use domain::ports::{DeliveryOutcome, NotificationPort, PortFuture};
use std::sync::Arc;

/// Le port réel : le gardien du magasin et la livraison Web Push.
pub struct PortNotifications {
    store: Arc<GardienDeStore>,
    livraison: Arc<dyn LivraisonPush>,
}

impl PortNotifications {
    /// Compose le port : le magasin (clés + abonnements) et la livraison.
    ///
    /// ⚠️ La livraison a besoin des clés VAPID **privées** : si le magasin ne
    /// peut pas les fournir, le port est composé **sans** livraison possible —
    /// et `deliver` répond `Unknown` avec la cause, jamais un faux succès.
    pub fn nouveau(store: Arc<GardienDeStore>) -> Self {
        // Le client Web Push n'est construit que si les clés existent ; sinon
        // la remise échoue avec la cause réelle (voir `livre`).
        let livraison: Arc<dyn LivraisonPush> = match store.clefs() {
            Ok(clefs) => Arc::new(LivraisonWebPush::nouvelle(clefs)),
            Err(_) => Arc::new(SansLivraison),
        };
        Self { livraison, store }
    }

    /// Compose le port avec une livraison injectée — pour les tests, sans
    /// réseau.
    #[must_use]
    pub fn avec_livraison(store: Arc<GardienDeStore>, livraison: Arc<dyn LivraisonPush>) -> Self {
        Self { livraison, store }
    }
}

/// La livraison quand les clés manquent : elle échoue avec sa cause.
struct SansLivraison;

impl LivraisonPush for SansLivraison {
    fn envoie<'a>(
        &'a self,
        _abonnement: &'a AbonnementPush,
        _payload: &'a str,
        _ttl: std::time::Duration,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), ErreurLivraison>> + Send + 'a>>
    {
        Box::pin(async {
            Err(ErreurLivraison::Autre {
                detail: String::from("clés VAPID indisponibles : envoi impossible"),
            })
        })
    }
}

/// Une erreur de magasin → l'erreur de port (une panne de **source**).
///
/// ⚠️ Jamais `Unsupported` : une panne de magasin n'est pas une capacité
/// absente. Le fil répond 500 pour l'une, 503 pour l'autre — les confondre
/// ferait croire que Web Push n'est pas configuré alors qu'il est cassé.
#[must_use]
pub fn erreur_de_port(erreur: &ErreurStore) -> PortError {
    PortError::Upstream {
        code: String::from("store"),
        message: match erreur {
            ErreurStore::Illisible { chemin, cause } => {
                format!("store illisible ({}): {cause}", chemin.display())
            }
            ErreurStore::Ecriture { chemin, cause } => {
                format!("store non inscriptible ({}): {cause}", chemin.display())
            }
            // Une paire partielle ou incohérente est REFUSÉE, jamais
            // complétée ni régénérée en silence.
            ErreurStore::PaireEnvPartielle => {
                String::from("paire VAPID partielle dans l'environnement")
            }
            ErreurStore::ClefsInvalides { raison } => {
                format!("clés VAPID invalides : {raison}")
            }
        },
    }
}

/// Le payload du domaine → le texte remis au service push (le format du fil :
/// un JSON simple, les quatre champs du payload).
#[must_use]
pub fn texte_de_payload(payload: &PushPayload) -> String {
    serde_json::json!({
        "body": payload.body,
        "tag": payload.tag,
        "title": payload.title,
        "url": payload.url,
    })
    .to_string()
}

impl NotificationPort for PortNotifications {
    fn vapid_public_key(&self) -> PortFuture<'_, Option<VapidPublicKey>> {
        Box::pin(async move {
            match self.store.cle_publique() {
                Ok(cle) => Ok(Some(VapidPublicKey::from(cle))),
                // Un magasin illisible est une PANNE, pas « pas de clé ».
                Err(erreur) => Err(erreur_de_port(&erreur)),
            }
        })
    }

    fn subscribe(&self, subscription: BrowserSubscription) -> PortFuture<'_, ()> {
        Box::pin(async move {
            let abonnement = AbonnementPush {
                endpoint: subscription.endpoint,
                keys: clefs_de(&subscription.keys),
            };
            self.store
                .abonne(&abonnement)
                .map_err(|erreur| erreur_de_port(&erreur))
        })
    }

    fn unsubscribe(&self, endpoint: String) -> PortFuture<'_, ()> {
        Box::pin(async move {
            self.store
                .desabonne(&endpoint)
                .map_err(|erreur| erreur_de_port(&erreur))
        })
    }

    fn deliver(
        &self,
        subscription: BrowserSubscription,
        payload: PushPayload,
    ) -> PortFuture<'_, DeliveryOutcome> {
        let livraison = Arc::clone(&self.livraison);
        Box::pin(async move {
            let abonnement = AbonnementPush {
                endpoint: subscription.endpoint.clone(),
                keys: clefs_de(&subscription.keys),
            };
            let texte = texte_de_payload(&payload);
            match livraison.envoie(&abonnement, &texte, TTL_LIVRAISON).await {
                // Le service push a accusé réception : c'est la seule preuve.
                Ok(()) => Ok(DeliveryOutcome::Delivered {
                    fingerprint: domain::ids::DeliveryFingerprint::from(subscription.endpoint),
                }),
                // Toute incertitude est DÉCLARÉE, jamais « envoyé » (A02).
                Err(ErreurLivraison::Autre { detail }) => Ok(DeliveryOutcome::Unknown { detail }),
                Err(ErreurLivraison::Expire) => Ok(DeliveryOutcome::Unknown {
                    detail: String::from("abonnement expiré (404/410) — à élaguer"),
                }),
            }
        })
    }
}

/// Les clés d'un abonnement du domaine — l'ordre du fil (`p256dh`, `auth`).
#[must_use]
pub fn clefs_de(subscription: &PushSubscriptionKeys) -> ClefsAbonnement {
    ClefsAbonnement {
        p256dh: subscription.p256dh.clone(),
        auth: subscription.auth.clone(),
    }
}
