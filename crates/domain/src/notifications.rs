//! Valeurs du service de notification push.
//!
//! ⚠️ **L'état affiché est celui qu'on a vérifié.** Une remise push acceptée
//! par le service amont = délivrée ; une réponse sans preuve = inconnue,
//! jamais « envoyé » (A02/C06).

use crate::ids::PaneId;
use serde::{Deserialize, Serialize};

/// Clef publique VAPID, exposée au navigateur pour qu'il s'abonne.
///
/// Aucune clef n'est inventée ici : la résolution (variables d'environnement
/// ou magasin) et la génération appartiennent à la crate `notifications`
/// (T030) — le domaine n'accepte qu'une clef déjà vérifiée.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VapidPublicKey(String);

impl VapidPublicKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for VapidPublicKey {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// Les deux clefs d'identité d'un abonnement navigateur, exactement celles
/// du niveau application-push (`keys.p256dh`, `keys.auth`).
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSubscriptionKeys {
    #[serde(rename = "p256dh")]
    pub p256dh: String,
    pub auth: String,
}

/// Un abonnement d'un navigateur, tel qu'il a été reçu et retenu.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSubscription {
    pub endpoint: String,
    pub keys: PushSubscriptionKeys,
}

/// L'identité retournée par la souscription côté application — opaque.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PushEndpoint(String);

impl PushEndpoint {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for PushEndpoint {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// Le contenu d'une notification, tel que le navigateur le reçoit.
///
/// ⚠️ `tag` est la clef de groupage du pane : deux notifications du même
/// pane se remplacent au lieu de s'empiler. La composition du texte —
/// étiquettes D04, jamais « a terminé son travail » pour un agent disparu —
/// est l'affaire du service (T030) ; ici, la valeur va telle quelle.
#[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    /// Clef de groupage (le pane) — Herdr ne la fournit pas, elle se déduit
    /// de ce qu'on a.
    pub tag: String,
    /// La cible ouverte par un clic sur la notification.
    pub url: String,
}

/// Un événement d'attention : un agent a besoin qu'on le regarde.
///
/// ⚠️ L'événement porte les **faits**, pas un verdict : qui, où, quel état
/// publié. Le filtrage d'affichage et le libellé final restent l'affaire du
/// service de notification (T030). L'état ici est la chaîne **publiée** :
/// `gone` n'est pas un `AgentStatus` — un agent disparu n'a pas « fini », on
/// ne dit jamais pourquoi (Herdr porte `pane.exited` sans raison vérifiée).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct AgentAttentionEvent {
    pub pane: PaneId,
    pub name: Option<crate::ids::AgentName>,
    pub status: Option<String>,
}
