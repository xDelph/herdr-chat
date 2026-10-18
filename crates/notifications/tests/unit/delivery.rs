//! La livraison push (T045, E09, C14) : file bornée, concurrence bornée,
//! délai par envoi, TTL posé, élagage VERSIONNÉ des expirés, réabonnement
//! pendant l'envoi qui survit, aucune livraison sous lock du store — le
//! tout contre un faux service.

use notifications::delivery::ErreurLivraison;
use notifications::delivery::{
    CONCURRENCE, FILE_LIVRAISON, LivraisonPush, Livreur, TTL_LIVRAISON, TravailLivraison,
};
use notifications::store::{AbonnementPush, ClefsAbonnement, GardienDeStore};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;
use tokio::sync::watch;

fn abonnement(endpoint: &str, auth: &str) -> AbonnementPush {
    AbonnementPush {
        endpoint: String::from(endpoint),
        keys: ClefsAbonnement {
            p256dh: String::from("clé-p256dh"),
            auth: String::from(auth),
        },
    }
}

fn temporaire(prefixe: &str) -> std::path::PathBuf {
    use std::sync::atomic::AtomicU32;
    static NONCE: AtomicU32 = AtomicU32::new(0);
    let base = std::env::temp_dir();
    let pid = std::process::id();
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let chemin = base.join(format!("{prefixe}-{pid}-{nonce}"));
    std::fs::create_dir(&chemin).unwrap_or_else(|cause| panic!("racine temporaire : {cause}"));
    chemin
}

/// Le faux service : des réponses scriptées par endpoint, une porte pour
/// retenir les envois, le pic des envois simultanés, et la trace des envois.
struct FauxService {
    reponses: Mutex<HashMap<String, Result<(), ErreurLivraison>>>,
    envois: Mutex<Vec<(String, String, Duration)>>,
    porte: watch::Sender<bool>,
    porte_recepteur: watch::Receiver<bool>,
    en_vol: AtomicU64,
    pic: Arc<AtomicU64>,
}

impl FauxService {
    fn nouveau() -> Self {
        let (porte, porte_recepteur) = watch::channel(true);
        Self {
            reponses: Mutex::new(HashMap::new()),
            envois: Mutex::new(Vec::new()),
            porte,
            porte_recepteur,
            en_vol: AtomicU64::new(0),
            pic: Arc::new(AtomicU64::new(0)),
        }
    }

    fn qui_expire(&self, endpoint: &str) -> &Self {
        self.reponses
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(String::from(endpoint), Err(ErreurLivraison::Expire));
        self
    }

    fn ferme_la_porte(&self) {
        self.porte.send(false).ok();
    }

    fn ouvre_la_porte(&self) {
        self.porte.send(true).ok();
    }

    fn envois(&self) -> Vec<(String, String, Duration)> {
        self.envois
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn attend_envois(&self, attendus: usize) {
        let debut = std::time::Instant::now();
        while self.envois().len() < attendus {
            if debut.elapsed() > Duration::from_secs(2) {
                panic!("{} envois attendus, {} vus", attendus, self.envois().len());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

impl LivraisonPush for FauxService {
    fn envoie<'a>(
        &'a self,
        abonnement: &'a AbonnementPush,
        payload: &'a str,
        ttl: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<(), ErreurLivraison>> + Send + 'a>> {
        Box::pin(async move {
            self.en_vol.fetch_add(1, Ordering::SeqCst);
            self.pic
                .fetch_max(self.en_vol.load(Ordering::SeqCst), Ordering::SeqCst);
            // La porte : les tests retiennent les envois pour mesurer la
            // concurrence ou réabonner pendant l'envoi.
            let mut porte = self.porte_recepteur.clone();
            while !*porte.borrow() {
                if porte.changed().await.is_err() {
                    break;
                }
            }
            self.en_vol.fetch_sub(1, Ordering::SeqCst);
            self.envois
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push((abonnement.endpoint.clone(), String::from(payload), ttl));
            self.reponses
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(&abonnement.endpoint)
                .cloned()
                .unwrap_or(Ok(()))
        })
    }
}

fn store() -> Arc<GardienDeStore> {
    let atelier = temporaire("herdr-delivery");
    Arc::new(GardienDeStore::nouveau(atelier.join("push.json"), None))
}

fn travail(payload: &str, abonnements: Vec<AbonnementPush>) -> TravailLivraison {
    TravailLivraison {
        payload: String::from(payload),
        abonnements,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn le_livreur_delivre_a_tous_les_abonnes_avec_le_ttl() {
    let service = Arc::new(FauxService::nouveau());
    let livreur = Livreur::nouveau(service.clone(), store());
    let abonnements = vec![
        abonnement("https://push.example/1", "a"),
        abonnement("https://push.example/2", "b"),
        abonnement("https://push.example/3", "c"),
    ];
    livreur
        .enfile(travail("{\"body\":\"fini\"}", abonnements))
        .unwrap_or_else(|_| panic!("place libre"));
    service.attend_envois(3);
    let envois = service.envois();
    assert_eq!(envois.len(), 3, "tous les abonnés servis");
    for (endpoint, payload, ttl) in &envois {
        assert_eq!(payload, "{\"body\":\"fini\"}");
        assert_eq!(*ttl, TTL_LIVRAISON, "TTL 60 s");
        assert!(endpoint.starts_with("https://push.example/"));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn les_expires_sont_elagues_et_les_autres_echecs_non() {
    // E09 : 404/410 → élagué ; une panne du service ≠ expiration.
    let service = Arc::new(FauxService::nouveau());
    service.qui_expire("https://push.example/expire");
    let gardien = store();
    gardien
        .abonne(&abonnement("https://push.example/expire", "a"))
        .unwrap_or_else(|_| panic!("abonnement"));
    gardien
        .abonne(&abonnement("https://push.example/bien", "b"))
        .unwrap_or_else(|_| panic!("abonnement"));
    let livreur = Livreur::nouveau(service.clone(), gardien.clone());
    livreur
        .enfile(travail(
            "{\"body\":\"fini\"}",
            vec![
                abonnement("https://push.example/expire", "a"),
                abonnement("https://push.example/bien", "b"),
            ],
        ))
        .unwrap_or_else(|_| panic!("place libre"));
    service.attend_envois(2);
    // L'attente de l'élagage : l'expiré part, le bien reste.
    let debut = std::time::Instant::now();
    while gardien
        .abonnements()
        .unwrap_or_else(|_| panic!("liste"))
        .len()
        != 1
    {
        if debut.elapsed() > Duration::from_secs(2) {
            panic!("l'élagage n'a pas eu lieu");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let restants = gardien.abonnements().unwrap_or_else(|_| panic!("liste"));
    assert_eq!(restants.len(), 1);
    assert_eq!(restants[0].endpoint, "https://push.example/bien");
    assert_eq!(livreur.elagues(), 1);
    assert_eq!(livreur.echecs(), 0, "aucune panne ici");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn le_reabonnement_pendant_l_envoi_survit_a_l_elagage() {
    // C14 : l'élagage est VERSIONNÉ — un endpoint réabonné (nouvelles clés)
    // pendant l'envoi n'est pas retiré.
    let service = Arc::new(FauxService::nouveau());
    service.qui_expire("https://push.example/endpoint");
    service.ferme_la_porte();
    let gardien = store();
    gardien
        .abonne(&abonnement("https://push.example/endpoint", "ancienne"))
        .unwrap_or_else(|_| panic!("abonnement"));
    let livreur = Livreur::nouveau(service.clone(), gardien.clone());
    livreur
        .enfile(travail(
            "{\"body\":\"fini\"}",
            vec![abonnement("https://push.example/endpoint", "ancienne")],
        ))
        .unwrap_or_else(|_| panic!("place libre"));
    // L'envoi est retenu par la porte : le réabonnement arrive pendant.
    tokio::time::sleep(Duration::from_millis(50)).await;
    gardien
        .abonne(&abonnement("https://push.example/endpoint", "nouvelle"))
        .unwrap_or_else(|_| panic!("réabonnement pendant l'envoi"));
    service.ouvre_la_porte();
    service.attend_envois(1);
    // L'élagage ne retire pas la NOUVELLE version.
    let debut = std::time::Instant::now();
    loop {
        let restants = gardien.abonnements().unwrap_or_else(|_| panic!("liste"));
        if restants.len() == 1 {
            assert_eq!(
                restants[0].keys.auth, "nouvelle",
                "la nouvelle version survit"
            );
            break;
        }
        if debut.elapsed() > Duration::from_secs(2) {
            panic!("l'élagage a retiré la nouvelle version");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    // L'ANCIENNE version n'est plus dans le store (remplacée par l'upsert) :
    // l'élagage versionné ne retire rien — c'est exactement la preuve.
    assert_eq!(
        livreur.elagues(),
        0,
        "rien à retirer : la nouvelle version survit"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn le_delai_tranche_un_envoi_bloque() {
    // E09 : un service qui ne répond pas ne retient pas le worker — le délai
    // (raccourci ici) tranche, et l'échec est compté, pas une expiration.
    let service = Arc::new(FauxService::nouveau());
    service.ferme_la_porte();
    let gardien = store();
    gardien
        .abonne(&abonnement("https://push.example/lent", "a"))
        .unwrap_or_else(|_| panic!("abonnement"));
    let livreur = Livreur::avec_delai(service.clone(), gardien.clone(), Duration::from_millis(80));
    livreur
        .enfile(travail(
            "{\"body\":\"fini\"}",
            vec![abonnement("https://push.example/lent", "a")],
        ))
        .unwrap_or_else(|_| panic!("place libre"));
    // Le délai tranche : l'envoi n'est jamais compté comme réussi.
    let debut = std::time::Instant::now();
    while livreur.echecs() == 0 {
        if debut.elapsed() > Duration::from_secs(2) {
            panic!("le délai n'a pas tranché");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(livreur.echecs(), 1, "le délai est un échec compté");
    // L'abonnement n'est PAS retiré (le délai n'est pas une expiration).
    assert_eq!(
        gardien
            .abonnements()
            .unwrap_or_else(|_| panic!("liste"))
            .len(),
        1
    );
    service.ouvre_la_porte();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn la_file_est_bornee_a_64() {
    // T045 : file de 64 — au-delà, refus compté, les chemins continuent.
    let service = Arc::new(FauxService::nouveau());
    service.ferme_la_porte();
    let livreur = Livreur::nouveau(service.clone(), store());
    // Le premier job entre dans le worker (retenu par la porte) : on attend
    // qu'il soit EN VOL pour rendre le test déterministe.
    livreur
        .enfile(travail(
            "{}",
            vec![abonnement("https://push.example/x", "a")],
        ))
        .unwrap_or_else(|_| panic!("place libre"));
    let debut = std::time::Instant::now();
    while service.en_vol.load(Ordering::SeqCst) == 0 {
        if debut.elapsed() > Duration::from_secs(2) {
            panic!("le worker n'a pas pris le premier job");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    // Le worker tient un job, la file tient 64 : 68 − 64 = 4 refus.
    let mut refuses = 0;
    for _ in 0..(FILE_LIVRAISON + 4) {
        if livreur
            .enfile(travail(
                "{}",
                vec![abonnement("https://push.example/x", "a")],
            ))
            .is_err()
        {
            refuses += 1;
        }
    }
    assert_eq!(
        refuses, 4,
        "la file tient 64 en attente, le reste est refusé"
    );
    assert_eq!(livreur.files_pleines(), 4);
    service.ouvre_la_porte();
    // 69 jobs, 4 refusés : 65 livrés.
    service.attend_envois(FILE_LIVRAISON + 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn la_concurrence_est_bornee_a_quatre() {
    // T045 : au plus 4 envois simultanés — le pic derrière la porte.
    let service = Arc::new(FauxService::nouveau());
    service.ferme_la_porte();
    let pic = service.pic.clone();
    let livreur = Livreur::nouveau(service.clone(), store());
    let abonnements: Vec<_> = (0..8)
        .map(|index| abonnement(&format!("https://push.example/{index}"), "a"))
        .collect();
    livreur
        .enfile(travail("{}", abonnements))
        .unwrap_or_else(|_| panic!("place libre"));
    tokio::time::sleep(Duration::from_millis(100)).await;
    service.ouvre_la_porte();
    service.attend_envois(8);
    let pic = pic.load(Ordering::SeqCst);
    assert!(
        pic <= CONCURRENCE as u64 && pic >= 1,
        "la concurrence plafonne à {CONCURRENCE}, pic = {pic}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn aucune_livraison_sous_lock_du_store() {
    // C14 : pendant un envoi retenu, un abonnement se fait SANS attendre —
    // la porte du store n'est jamais tenue par la livraison.
    let service = Arc::new(FauxService::nouveau());
    service.ferme_la_porte();
    let gardien = store();
    let livreur = Livreur::nouveau(service.clone(), gardien.clone());
    livreur
        .enfile(travail(
            "{}",
            vec![abonnement("https://push.example/lent", "a")],
        ))
        .unwrap_or_else(|_| panic!("place libre"));
    tokio::time::sleep(Duration::from_millis(50)).await;
    // L'envoi est en vol : l'abonnement passe immédiatement.
    let debut = std::time::Instant::now();
    gardien
        .abonne(&abonnement("https://push.example/nouveau", "b"))
        .unwrap_or_else(|_| panic!("abonnement pendant l'envoi"));
    assert!(
        debut.elapsed() < Duration::from_millis(200),
        "aucune attente : la livraison ne tient pas le store"
    );
    service.ouvre_la_porte();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn une_panne_du_service_n_est_pas_une_expiration() {
    // E09 : un échec autre que 404/410 est compté, jamais un endpoint retiré
    // pour une raison inventée.
    let service = Arc::new(FauxService::nouveau());
    service
        .reponses
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(
            String::from("https://push.example/panne"),
            Err(ErreurLivraison::Autre {
                detail: String::from("service injoignable"),
            }),
        );
    let gardien = store();
    gardien
        .abonne(&abonnement("https://push.example/panne", "a"))
        .unwrap_or_else(|_| panic!("abonnement"));
    let livreur = Livreur::nouveau(service.clone(), gardien.clone());
    livreur
        .enfile(travail(
            "{}",
            vec![abonnement("https://push.example/panne", "a")],
        ))
        .unwrap_or_else(|_| panic!("place libre"));
    service.attend_envois(1);
    let debut = std::time::Instant::now();
    while livreur.echecs() == 0 {
        if debut.elapsed() > Duration::from_secs(2) {
            panic!("l'échec doit être compté");
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(livreur.elagues(), 0, "aucun élagage");
    assert_eq!(
        gardien
            .abonnements()
            .unwrap_or_else(|_| panic!("liste"))
            .len(),
        1,
        "l'abonnement reste"
    );
}
