//! Faux port de notification : les remises sont **capturées**, pas envoyées.
//!
//! ⚠️ Une remise tentée est notée **même si elle échoue** : un échec non
//! noté serait un état masqué. La règle de réponse se règle entre deux
//! remises — délivrée (empreinte donnée), inconnue (preuve manquante,
//! déclarée comme telle), panne (injectée telle quelle).
//!
//! ⚠️ La clef VAPID est placée par le test ou absente — jamais inventée ni
//! générée ici (c'est l'affaire de `notifications`, T030).

use domain::errors::PortError;
use domain::notifications::{BrowserSubscription, PushPayload, VapidPublicKey};
use domain::ports::{DeliveryOutcome, NotificationPort, PortFuture};
use std::sync::{Mutex, PoisonError};

/// La règle de réponse du puits — réglée avant les remises qu'elle doit
/// produire, persistante jusqu'à la prochaine règle.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ReglageRemise {
    /// `Ok(DeliveryOutcome::Delivered)` avec l'empreinte fournie — même
    /// valeur remise après remise (le puits n'invente pas d'identité ; un
    /// test qui veut des empreintes distinctes change la règle à la main).
    Delivree { empreinte: String },
    /// `Ok(DeliveryOutcome::Unknown)` — la preuve manque, l'état est
    /// déclaré avec son détail, pas effacé.
    Inconnue { detail: String },
    /// `Err(panne)` — la panne injectée, portée telle quelle au port.
    Panne { panne: PortError },
}

/// Une remise tentée, capturée : qui, et quel contenu.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RemiseCapturee {
    /// L'endpoint de l'abonnement visé — l'adresse **tentée**, pas prouvée.
    pub endpoint: String,
    /// Le payload remis au service push (copie conforme).
    pub payload: PushPayload,
}

#[derive(Debug, Default)]
struct Interieur {
    vapid: Option<VapidPublicKey>,
    remises: Vec<RemiseCapturee>,
    regle: Option<ReglageRemise>,
}

/// Le puits : `NotificationPort` qui ne communique avec rien. Partage
/// possible via `Arc` (l'appareil vit, un seul puits).
#[derive(Debug, Default)]
pub struct PuitsPushFaux {
    interieur: Mutex<Interieur>,
}

impl PuitsPushFaux {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// La clef capturée, pour l'assertion.
    #[must_use]
    pub fn cle_vapid(&self) -> Option<VapidPublicKey> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .vapid
            .clone()
    }

    /// Place (ou retire) la clef VAPID publiée aux navigateurs.
    pub fn regle_vapid(&self, cle: Option<VapidPublicKey>) {
        let mut interieur = self
            .interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        interieur.vapid = cle;
    }

    /// Règle la réponse de la prochaine remise — et des suivantes jusqu'à
    /// nouvelle règle.
    pub fn regle_remise(&self, regle: ReglageRemise) {
        let mut interieur = self
            .interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        interieur.regle = Some(regle);
    }

    /// Les remises tentées, dans l'ordre — échecs inclus.
    #[must_use]
    pub fn remises(&self) -> Vec<RemiseCapturee> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remises
            .clone()
    }

    /// Vide la capture — un scénario repart des remises zéro.
    pub fn vider(&self) {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remises
            .clear();
    }
}

impl NotificationPort for PuitsPushFaux {
    fn vapid_public_key(&self) -> Option<VapidPublicKey> {
        self.cle_vapid()
    }

    fn deliver(
        &self,
        subscription: BrowserSubscription,
        payload: PushPayload,
    ) -> PortFuture<'_, DeliveryOutcome> {
        Box::pin(async move {
            let mut interieur = self
                .interieur
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            // La tentative est notée AVANT toute réponse — même une panne.
            interieur.remises.push(RemiseCapturee {
                endpoint: subscription.endpoint.clone(),
                payload,
            });
            match interieur.regle.clone() {
                Some(ReglageRemise::Delivree { empreinte }) => Ok(DeliveryOutcome::Delivered {
                    fingerprint: empreinte.into(),
                }),
                Some(ReglageRemise::Inconnue { detail }) => Ok(DeliveryOutcome::Unknown { detail }),
                Some(ReglageRemise::Panne { panne }) => Err(panne),
                // Sans règle : la remise est déclarée **inconnue** — état
                // honnête par défaut, jamais « envoyé » au hasard.
                None => Ok(DeliveryOutcome::Unknown {
                    detail: String::from("le puits n'a pas de règle : aucune preuve"),
                }),
            }
        })
    }
}
