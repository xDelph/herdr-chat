//! La livraison réelle via `web-push` (T045, E09) : le builder VAPID accepte
//! la clé privée brute base64url (les clés Node), le TTL est posé, et les
//! réponses 404/410 deviennent des expirations — jamais une autre cause.
//!
//! ⚠️ Le délai de 15 s est appliqué par le worker (T044/T045) : le client
//! `web-push` ne timeout jamais lui-même.

use crate::delivery::{ErreurLivraison, LivraisonPush};
use crate::store::{AbonnementPush, ClefsVapid};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushError, WebPushMessageBuilder,
};

/// Le client réel — le TTL 60 s du contrat, la clé privée du store.
pub struct LivraisonWebPush {
    client: HyperWebPushClient,
    clefs: ClefsVapid,
}

impl LivraisonWebPush {
    /// Le client sur les clés VAPID du store.
    #[must_use]
    pub fn nouvelle(clefs: ClefsVapid) -> Self {
        Self {
            client: HyperWebPushClient::new(),
            clefs,
        }
    }
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
            let signature = VapidSignatureBuilder::from_base64_no_sub(&self.clefs.private_key)
                .map_err(|cause| ErreurLivraison::Autre {
                    detail: cause.to_string(),
                })?
                .add_sub_info(&info)
                .build()
                .map_err(|cause| ErreurLivraison::Autre {
                    detail: cause.to_string(),
                })?;
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
