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
    /// La panne de résolution de la clef — `Some` fait échouer la lecture
    /// (une panne de magasin n'est pas « pas de clef »).
    vapid_panne: Option<PortError>,
    remises: Vec<RemiseCapturee>,
    regle: Option<ReglageRemise>,
    /// Les abonnements enregistrés, dans l'ordre — l'endpoint **reçu**.
    abonnes: Vec<String>,
    /// Les désabonnements reçus, dans l'ordre.
    desabonnes: Vec<String>,
    /// Les présences reçues (endpoint, visible), dans l'ordre (H23).
    presences: Vec<(String, bool)>,
    /// La panne d'écriture du magasin d'abonnements (abonner/désabonner).
    abonnement_panne: Option<PortError>,
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
        interieur.vapid_panne = None;
    }

    /// Fait échouer la RÉSOLUTION de la clef — la panne de magasin, qui doit
    /// être un 500 et jamais un « pas de clef » (503).
    pub fn panne_vapid(&self, panne: PortError) {
        let mut interieur = self
            .interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        interieur.vapid_panne = Some(panne);
    }

    /// Fait échouer les écritures d'abonnement.
    pub fn panne_abonnements(&self, panne: PortError) {
        let mut interieur = self
            .interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        interieur.abonnement_panne = Some(panne);
    }

    /// Les endpoints abonnés, dans l'ordre d'arrivée.
    #[must_use]
    pub fn abonnes(&self) -> Vec<String> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .abonnes
            .clone()
    }

    /// Les présences reçues (endpoint, visible), dans l'ordre d'arrivée.
    #[must_use]
    pub fn presences(&self) -> Vec<(String, bool)> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .presences
            .clone()
    }

    /// Les endpoints désabonnés, dans l'ordre d'arrivée.
    #[must_use]
    pub fn desabonnes(&self) -> Vec<String> {
        self.interieur
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .desabonnes
            .clone()
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
    fn vapid_public_key(&self) -> PortFuture<'_, Option<VapidPublicKey>> {
        Box::pin(async move {
            let interieur = self
                .interieur
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            match &interieur.vapid_panne {
                Some(panne) => Err(panne.clone()),
                None => Ok(interieur.vapid.clone()),
            }
        })
    }

    fn subscribe(&self, subscription: BrowserSubscription) -> PortFuture<'_, ()> {
        Box::pin(async move {
            let mut interieur = self
                .interieur
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if let Some(panne) = &interieur.abonnement_panne {
                return Err(panne.clone());
            }
            interieur.abonnes.push(subscription.endpoint);
            Ok(())
        })
    }

    fn presence(&self, endpoint: String, visible: bool) -> PortFuture<'_, ()> {
        Box::pin(async move {
            self.interieur
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .presences
                .push((endpoint, visible));
            Ok(())
        })
    }

    fn unsubscribe(&self, endpoint: String) -> PortFuture<'_, ()> {
        Box::pin(async move {
            let mut interieur = self
                .interieur
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if let Some(panne) = &interieur.abonnement_panne {
                return Err(panne.clone());
            }
            interieur.desabonnes.push(endpoint);
            Ok(())
        })
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
