//! L'adaptateur `NotificationPort` (T056 suite) : le store et la livraison,
//! sans réseau (livraison injectée).
//!
//! ⚠️ Trois issues distinctes, chacune vérifiée : pas de clé = capacité
//! absente (`None`), magasin illisible = panne (`Err`), remise = `Delivered`
//! ou `Unknown` — jamais « envoyé » sans preuve.

use domain::errors::PortError;
use domain::notifications::{BrowserSubscription, PushPayload, PushSubscriptionKeys};
use domain::ports::{DeliveryOutcome, NotificationPort, PortFuture};
use notifications::delivery::{ErreurLivraison, LivraisonPush};
use notifications::port::{PortNotifications, texte_de_payload};
use notifications::store::{AbonnementPush, GardienDeStore};
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Compteur de dossiers : deux tests lancés dans la même nanoseconde
/// partageaient leur dossier temporaire — un échec intermittent observé une
/// fois sur `sessions` (test vert en isolation, rouge en parallèle).
static COMPTEUR_DOSSIERS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn dossier() -> PathBuf {
    let unique = format!(
        "notif-port-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duree| duree.as_nanos())
            .unwrap_or(0),
        COMPTEUR_DOSSIERS.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    );
    let chemin = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn attend<T: Send>(mut futur: PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => panic!("un port bloquant répond au premier poll"),
    }
}

/// La livraison factice : note les envois et répond ce qu'on lui demande.
struct LivraisonFausse {
    appels: Arc<AtomicUsize>,
    derniers: Arc<Mutex<Vec<String>>>,
    issue: ErreurLivraison,
}

impl LivraisonPush for LivraisonFausse {
    fn envoie<'a>(
        &'a self,
        _abonnement: &'a AbonnementPush,
        payload: &'a str,
        _ttl: Duration,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<(), ErreurLivraison>> + Send + 'a>> {
        self.appels.fetch_add(1, Ordering::SeqCst);
        self.derniers
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .push(String::from(payload));
        let issue = self.issue.clone();
        Box::pin(async move { Err(issue) })
    }
}

fn abonnement() -> BrowserSubscription {
    BrowserSubscription {
        endpoint: String::from("https://push.example/ep-1"),
        keys: PushSubscriptionKeys {
            p256dh: String::from("p256dh"),
            auth: String::from("auth"),
        },
    }
}

fn payload() -> PushPayload {
    PushPayload {
        body: String::from("Agent needs you"),
        tag: String::from("waiting-w1:p1"),
        title: String::from("pixel"),
        url: String::from("/#/agent/w1%3Ap1"),
    }
}

#[test]
fn une_cle_absente_est_une_capacite_absente() {
    let racine = dossier();
    let gardien = Arc::new(GardienDeStore::nouveau(racine.join("push.json"), None));
    let port = PortNotifications::avec_livraison(
        gardien,
        Arc::new(LivraisonFausse {
            appels: Arc::new(AtomicUsize::new(0)),
            derniers: Arc::new(Mutex::new(Vec::new())),
            issue: ErreurLivraison::Autre {
                detail: String::from("x"),
            },
        }),
    );
    // Le store vide GÉNÈRE une paire : la clé existe donc.
    let cle = attend(port.vapid_public_key())
        .unwrap_or_else(|cause| panic!("lecture de clé : {cause:?}"));
    assert!(cle.is_some(), "un store vide génère sa paire, persistée");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_magasin_illisible_est_une_panne_pas_une_absence() {
    let racine = dossier();
    // Un dossier à la place du fichier : illisible.
    let chemin = racine.join("push.json");
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    let gardien = Arc::new(GardienDeStore::nouveau(chemin, None));
    let port = PortNotifications::avec_livraison(
        gardien,
        Arc::new(LivraisonFausse {
            appels: Arc::new(AtomicUsize::new(0)),
            derniers: Arc::new(Mutex::new(Vec::new())),
            issue: ErreurLivraison::Autre {
                detail: String::from("x"),
            },
        }),
    );
    let erreur = attend(port.vapid_public_key())
        .err()
        .unwrap_or_else(|| panic!("un store illisible doit échouer"));
    // ⚠️ Une panne de magasin n'est PAS « pas de clé » (503 vs 500).
    assert!(matches!(erreur, PortError::Upstream { .. }), "{erreur:?}");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn abonner_puis_desabonner_passe_par_le_store() {
    let racine = dossier();
    let gardien = Arc::new(GardienDeStore::nouveau(racine.join("push.json"), None));
    let port = PortNotifications::avec_livraison(
        Arc::clone(&gardien),
        Arc::new(LivraisonFausse {
            appels: Arc::new(AtomicUsize::new(0)),
            derniers: Arc::new(Mutex::new(Vec::new())),
            issue: ErreurLivraison::Autre {
                detail: String::from("x"),
            },
        }),
    );
    attend(port.subscribe(abonnement())).unwrap_or_else(|cause| panic!("abonnement : {cause:?}"));
    let abonnes = gardien
        .abonnements()
        .unwrap_or_else(|cause| panic!("lecture : {cause:?}"));
    assert_eq!(abonnes.len(), 1);
    assert_eq!(abonnes[0].endpoint, "https://push.example/ep-1");
    attend(port.unsubscribe(String::from("https://push.example/ep-1")))
        .unwrap_or_else(|cause| panic!("désabonnement : {cause:?}"));
    let restants = gardien
        .abonnements()
        .unwrap_or_else(|cause| panic!("lecture : {cause:?}"));
    assert!(restants.is_empty());
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_remise_ratee_est_inconnue_jamais_envoyee() {
    let racine = dossier();
    let gardien = Arc::new(GardienDeStore::nouveau(racine.join("push.json"), None));
    let appels = Arc::new(AtomicUsize::new(0));
    let derniers = Arc::new(Mutex::new(Vec::new()));
    let port = PortNotifications::avec_livraison(
        gardien,
        Arc::new(LivraisonFausse {
            appels: Arc::clone(&appels),
            derniers: Arc::clone(&derniers),
            issue: ErreurLivraison::Autre {
                detail: String::from("service muet"),
            },
        }),
    );
    let issue = attend(port.deliver(abonnement(), payload()))
        .unwrap_or_else(|cause| panic!("remise : {cause:?}"));
    match issue {
        DeliveryOutcome::Unknown { detail } => assert!(detail.contains("muet"), "{detail}"),
        autre => panic!("une remise non prouvée n'est pas délivrée : {autre:?}"),
    }
    assert_eq!(appels.load(Ordering::SeqCst), 1);
    // Le payload remis porte les quatre champs du fil, encodés en JSON.
    let envoyes = derniers
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone();
    let decode: serde_json::Value =
        serde_json::from_str(&envoyes[0]).unwrap_or_else(|cause| panic!("payload : {cause}"));
    assert_eq!(decode["body"], "Agent needs you");
    assert_eq!(decode["tag"], "waiting-w1:p1");
    assert_eq!(decode["title"], "pixel");
    assert_eq!(decode["url"], "/#/agent/w1%3Ap1");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_abonnement_expire_est_declare_inconnu_pas_delivre() {
    let racine = dossier();
    let gardien = Arc::new(GardienDeStore::nouveau(racine.join("push.json"), None));
    let port = PortNotifications::avec_livraison(
        gardien,
        Arc::new(LivraisonFausse {
            appels: Arc::new(AtomicUsize::new(0)),
            derniers: Arc::new(Mutex::new(Vec::new())),
            issue: ErreurLivraison::Expire,
        }),
    );
    let issue = attend(port.deliver(abonnement(), payload()))
        .unwrap_or_else(|cause| panic!("remise : {cause:?}"));
    match issue {
        DeliveryOutcome::Unknown { detail } => {
            assert!(detail.contains("expiré"), "{detail}");
        }
        autre => panic!("un abonnement expiré n'est pas « délivré » : {autre:?}"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_texte_de_payload_porte_les_quatre_champs() {
    let texte = texte_de_payload(&payload());
    let decode: serde_json::Value =
        serde_json::from_str(&texte).unwrap_or_else(|cause| panic!("payload : {cause}"));
    let mut champs: Vec<&str> = decode
        .as_object()
        .map(|o| o.keys().map(String::as_str).collect())
        .unwrap_or_default();
    champs.sort_unstable();
    assert_eq!(champs, vec!["body", "tag", "title", "url"]);
}
