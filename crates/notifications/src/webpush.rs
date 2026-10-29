//! La livraison réelle via `web-push` (T045, E09) : le builder VAPID accepte
//! la clé privée brute base64url (les clés Node), le TTL est posé, et les
//! réponses 404/410 deviennent des expirations — jamais une autre cause.
//!
//! ⚠️ Le délai de 15 s est appliqué par le worker (T044/T045) : le client
//! `web-push` ne timeout jamais lui-même.
//!
//! ⚠️ **Le `sub` du JWT est celui de la configuration**, jamais celui du
//! crate. Sans `sub` explicite, `web-push` signe avec
//! `mailto:example@example.com` : un sujet que personne n'a choisi, et que
//! le service push d'Apple est en droit de refuser (`BadJwtToken`). Le fil
//! résolvait le sujet (`HERDR_REMOTE_VAPID_SUBJECT`, puis la première origine
//! HTTPS configurée, puis `mailto:herdr-remote@example.com`, CURRENT §6) et
//! le passait à `setVapidDetails` : on fait de même.

use crate::delivery::{ErreurLivraison, LivraisonPush};
use crate::store::{AbonnementPush, ClefsVapid};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignature, VapidSignatureBuilder,
    WebPushClient, WebPushError, WebPushMessageBuilder,
};

/// Le sujet VAPID par défaut — celui du fil, quand ni le sujet explicite ni
/// une origine HTTPS configurée n'existent.
pub const SUJET_PAR_DEFAUT: &str = "mailto:herdr-remote@example.com";

/// Le client réel — le TTL 60 s du contrat, la clé privée du store, le sujet
/// de la configuration.
pub struct LivraisonWebPush {
    client: HyperWebPushClient,
    clefs: ClefsVapid,
    sujet: String,
}

impl LivraisonWebPush {
    /// Le client sur les clés VAPID du store et le sujet (`sub`) résolu par
    /// la configuration.
    #[must_use]
    pub fn nouvelle(clefs: ClefsVapid, sujet: String) -> Self {
        Self {
            client: HyperWebPushClient::new(),
            clefs,
            sujet,
        }
    }
}

/// La signature VAPID d'un envoi : la clé privée brute (forme Node), le
/// `sub` EXPLICITE — le JWT porte toujours le sujet configuré.
pub fn signature_vapid(
    clefs: &ClefsVapid,
    sujet: &str,
    info: &SubscriptionInfo,
) -> Result<VapidSignature, ErreurLivraison> {
    let mut builder = VapidSignatureBuilder::from_base64_no_sub(&clefs.private_key)
        .map_err(|cause| ErreurLivraison::Autre {
            detail: cause.to_string(),
        })?
        .add_sub_info(info);
    builder.add_claim("sub", sujet);
    builder.build().map_err(|cause| ErreurLivraison::Autre {
        detail: cause.to_string(),
    })
}

impl LivraisonPush for LivraisonWebPush {
    fn envoie<'a>(
        &'a self,
        abonnement: &'a AbonnementPush,
        payload: &'a str,
        ttl: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<(), ErreurLivraison>> + Send + 'a>> {
        Box::pin(async move {
            let info = SubscriptionInfo::new(
                &abonnement.endpoint,
                &abonnement.keys.p256dh,
                &abonnement.keys.auth,
            );
            let signature = signature_vapid(&self.clefs, &self.sujet, &info)?;
            let mut builder = WebPushMessageBuilder::new(&info);
            builder.set_ttl(ttl.as_secs() as u32);
            builder.set_vapid_signature(signature);
            builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
            let message = builder.build().map_err(|cause| ErreurLivraison::Autre {
                detail: cause.to_string(),
            })?;
            self.client
                .send(message)
                .await
                .map_err(|cause| match cause {
                    // 410 : l'endpoint n'est plus valide ; 404 : il n'existe plus.
                    WebPushError::EndpointNotValid(_) | WebPushError::EndpointNotFound(_) => {
                        ErreurLivraison::Expire
                    }
                    autre => ErreurLivraison::Autre {
                        detail: autre.to_string(),
                    },
                })
        })
    }
}
