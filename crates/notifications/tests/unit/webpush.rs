//! La livraison Web Push RÉELLE contre un **faux service push local** : le
//! JWT VAPID porte le `sub` configuré, et un 410 devient une expiration.
//!
//! ⚠️ Aucun service push réel, aucun abonnement réel : le service est un
//! écouteur TCP sur un port éphémère de la boucle locale, qui note la
//! requête et répond le statut scripté. Les clés sont générées par le test.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use notifications::delivery::{ErreurLivraison, LivraisonPush};
use notifications::store::{AbonnementPush, ClefsAbonnement};
use notifications::vapid::genere_clefs_vapid;
use notifications::webpush::{LivraisonWebPush, signature_vapid};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Le faux service : répond `statut` à chaque requête, note les en-têtes.
async fn faux_service(statut: &'static str) -> (String, Arc<Mutex<Vec<String>>>) {
    let ecouteur = TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap_or_else(|cause| panic!("écoute locale : {cause}"));
    let adresse = ecouteur
        .local_addr()
        .unwrap_or_else(|cause| panic!("adresse locale : {cause}"));
    let requetes = Arc::new(Mutex::new(Vec::new()));
    let notees = Arc::clone(&requetes);
    tokio::spawn(async move {
        while let Ok((mut flux, _)) = ecouteur.accept().await {
            let mut brut = Vec::new();
            let mut tampon = [0_u8; 4096];
            // Les en-têtes, puis le corps annoncé — rien de plus.
            loop {
                let Ok(lus) = flux.read(&mut tampon).await else {
                    break;
                };
                if lus == 0 {
                    break;
                }
                brut.extend_from_slice(&tampon[..lus]);
                let texte = String::from_utf8_lossy(&brut).to_string();
                if let Some(fin) = texte.find("\r\n\r\n") {
                    let longueur = texte[..fin]
                        .lines()
                        .find_map(|ligne| {
                            let (nom, valeur) = ligne.split_once(':')?;
                            nom.eq_ignore_ascii_case("content-length")
                                .then(|| valeur.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    if brut.len() >= fin + 4 + longueur {
                        break;
                    }
                }
            }
            let texte = String::from_utf8_lossy(&brut).to_string();
            notees
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(texte);
            let reponse =
                format!("HTTP/1.1 {statut}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            let _ = flux.write_all(reponse.as_bytes()).await;
            let _ = flux.shutdown().await;
        }
    });
    (
        format!("http://{adresse}/push/abonnement-de-test"),
        requetes,
    )
}

/// Un abonnement de test : un point P-256 valide (généré), un `auth` de
/// 16 octets — de quoi chiffrer, rien de réel.
fn abonnement(endpoint: &str) -> AbonnementPush {
    AbonnementPush {
        endpoint: String::from(endpoint),
        keys: ClefsAbonnement {
            p256dh: genere_clefs_vapid().public_key,
            auth: URL_SAFE_NO_PAD.encode([7_u8; 16]),
        },
    }
}

/// Les revendications d'un JWT (le segment du milieu, base64url).
fn revendications(jwt: &str) -> serde_json::Value {
    let milieu = jwt
        .split('.')
        .nth(1)
        .unwrap_or_else(|| panic!("JWT sans charge : {jwt}"));
    let octets = URL_SAFE_NO_PAD
        .decode(milieu)
        .unwrap_or_else(|cause| panic!("charge JWT illisible : {cause}"));
    serde_json::from_slice(&octets).unwrap_or_else(|cause| panic!("charge JWT non JSON : {cause}"))
}

/// Le JWT de l'en-tête `Authorization: vapid t=<jwt>, k=<clé>`.
fn jwt_de_la_requete(requete: &str) -> String {
    let ligne = requete
        .lines()
        .find(|ligne| ligne.to_ascii_lowercase().starts_with("authorization:"))
        .unwrap_or_else(|| panic!("aucun en-tête Authorization : {requete}"));
    let apres = ligne
        .split("t=")
        .nth(1)
        .unwrap_or_else(|| panic!("Authorization sans t= : {ligne}"));
    apres
        .split(',')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[test]
fn le_jwt_porte_le_sujet_configure() {
    let clefs = genere_clefs_vapid();
    let info = web_push::SubscriptionInfo::new(
        "https://push.example.test/abonnement",
        &genere_clefs_vapid().public_key,
        &URL_SAFE_NO_PAD.encode([7_u8; 16]),
    );
    let signature = signature_vapid(&clefs, "mailto:moi@exemple.test", &info)
        .unwrap_or_else(|erreur| panic!("signature : {erreur:?}"));
    let charge = revendications(&signature.auth_t);
    // Le sujet est CELUI DE LA CONFIGURATION — pas le défaut du crate.
    assert_eq!(charge["sub"], "mailto:moi@exemple.test");
    assert_eq!(charge["aud"], "https://push.example.test");
}

#[tokio::test(flavor = "multi_thread")]
async fn un_envoi_accepte_porte_le_sub_dans_l_en_tete_vapid() {
    let (endpoint, requetes) = faux_service("201 Created").await;
    let livraison = LivraisonWebPush::nouvelle(
        genere_clefs_vapid(),
        String::from("https://herdr.exemple.ts.net"),
    );
    let abonne = abonnement(&endpoint);
    let issue = tokio::time::timeout(
        Duration::from_secs(10),
        livraison.envoie(
            &abonne,
            "{\"title\":\"Agent finished\"}",
            Duration::from_secs(60),
        ),
    )
    .await
    .unwrap_or_else(|_| panic!("le faux service n'a pas répondu"));
    assert_eq!(issue, Ok(()));
    let notees = requetes
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    assert_eq!(notees.len(), 1, "une seule requête au service push");
    let charge = revendications(&jwt_de_la_requete(&notees[0]));
    assert_eq!(charge["sub"], "https://herdr.exemple.ts.net");
    // Le TTL du contrat (60 s) est posé.
    assert!(
        notees[0].to_ascii_lowercase().contains("ttl: 60"),
        "TTL absent : {}",
        notees[0]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn un_410_est_une_expiration() {
    let (endpoint, _requetes) = faux_service("410 Gone").await;
    let livraison = LivraisonWebPush::nouvelle(
        genere_clefs_vapid(),
        String::from("mailto:herdr-remote@example.com"),
    );
    let abonne = abonnement(&endpoint);
    let issue = tokio::time::timeout(
        Duration::from_secs(10),
        livraison.envoie(&abonne, "{}", Duration::from_secs(60)),
    )
    .await
    .unwrap_or_else(|_| panic!("le faux service n'a pas répondu"));
    assert_eq!(issue, Err(ErreurLivraison::Expire));
}

#[tokio::test(flavor = "multi_thread")]
async fn un_500_n_est_pas_une_expiration() {
    let (endpoint, _requetes) = faux_service("500 Internal Server Error").await;
    let livraison = LivraisonWebPush::nouvelle(
        genere_clefs_vapid(),
        String::from("mailto:herdr-remote@example.com"),
    );
    let abonne = abonnement(&endpoint);
    let issue = tokio::time::timeout(
        Duration::from_secs(10),
        livraison.envoie(&abonne, "{}", Duration::from_secs(60)),
    )
    .await
    .unwrap_or_else(|_| panic!("le faux service n'a pas répondu"));
    // Une panne du service n'est JAMAIS une expiration inventée.
    assert!(
        matches!(issue, Err(ErreurLivraison::Autre { .. })),
        "{issue:?}"
    );
}
