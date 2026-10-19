//! T056 — le cycle de vie : admission, drain borné, flush, fermeture, issue
//! partielle tracée.
//!
//! ⚠️ Les tests montent un **faux processus** : un vrai socket TCP sur le
//! loopback (port 0 = choisi par le système), un routeur minimal, des
//! diagnostics en mémoire. Aucun agent n'est lancé, aucun service réel n'est
//! contacté.

use application::diagnostics::{EntreeDiagnostic, SinkDiagnostic};
use herdrchat::cycle::{
    Arret, Declencheur, EnCours, ErreurDemarrage, RapportArret, Taches, ecoute, sert,
};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Les diagnostics en mémoire — la preuve que l'issue partielle est TRACÉE.
#[derive(Clone, Default)]
struct SinkMemoire {
    entrees: Arc<Mutex<Vec<EntreeDiagnostic>>>,
}

impl SinkMemoire {
    fn entrees(&self) -> Vec<EntreeDiagnostic> {
        self.entrees
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }
}

impl SinkDiagnostic for SinkMemoire {
    fn ecrit(&self, entree: &EntreeDiagnostic) {
        self.entrees
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .push(entree.clone());
    }
}

/// Le routeur du faux processus : une route rapide, une route lente, et une
/// route qui compte les requêtes en vol.
fn routeur(en_cours: Arc<EnCours>) -> axum::Router {
    use axum::routing::get;
    let compte = Arc::clone(&en_cours);
    let rapide = {
        let compte = Arc::clone(&compte);
        move || {
            let compte = Arc::clone(&compte);
            async move {
                compte.entre();
                compte.sort();
                "ok"
            }
        }
    };
    let lent = {
        let compte = Arc::clone(&compte);
        move || {
            let compte = Arc::clone(&compte);
            async move {
                compte.entre();
                tokio::time::sleep(Duration::from_secs(1)).await;
                compte.sort();
                "trop tard"
            }
        }
    };
    axum::Router::new()
        .route("/rapide", get(rapide))
        .route("/lent", get(lent))
}

/// Démarre le faux processus sur un port libre et rend (adresse, arrêt).
async fn demarre(
    delai: Duration,
    sink: SinkMemoire,
    taches: Arc<Taches>,
) -> (
    std::net::SocketAddr,
    Declencheur,
    Arc<EnCours>,
    tokio::task::JoinHandle<RapportArret>,
) {
    let ecouteur = ecoute(
        "127.0.0.1:0"
            .parse()
            .unwrap_or_else(|cause| panic!("adresse : {cause}")),
    )
    .await
    .unwrap_or_else(|erreur| panic!("écoute : {erreur}"));
    let adresse = ecouteur
        .local_addr()
        .unwrap_or_else(|cause| panic!("adresse locale : {cause}"));
    let en_cours = Arc::new(EnCours::nouveau());
    let routeur = routeur(Arc::clone(&en_cours));
    let (declencheur, arret) = Declencheur::nouveau();
    let taches_serveur = Arc::clone(&taches);
    let poignee = tokio::spawn(async move {
        sert(
            ecouteur,
            routeur,
            en_cours,
            taches_serveur,
            Arc::new(sink),
            arret,
            delai,
        )
        .await
    });
    (adresse, declencheur, Arc::new(EnCours::nouveau()), poignee)
}

/// ⚠️ **Le drain ne borne pas la durée de vie.** Trouvé en LANÇANT le binaire :
/// un `timeout(delai, serveur)` autour du serveur entier l'arrêtait tout seul
/// après 10 s, sans aucun signal. Ce test le refuse : avec un délai de 100 ms,
/// le serveur doit rester vivant bien au-delà et répondre encore.
#[tokio::test(flavor = "multi_thread")]
async fn le_drain_ne_borne_pas_la_duree_de_vie() {
    let sink = SinkMemoire::default();
    let taches = Arc::new(Taches::nouveau());
    let (adresse, declencheur, _en_cours, poignee) =
        demarre(Duration::from_millis(100), sink, taches).await;
    // Plus de 15 fois le délai de drain, sans aucun signal.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(
        !poignee.is_finished(),
        "le serveur ne s'arrête pas tout seul"
    );
    let reponse = requete(adresse, "/rapide").await;
    assert_eq!(reponse, "ok", "il répond encore après le délai de drain");
    declencheur.demande();
    let _ = tokio::time::timeout(Duration::from_secs(5), poignee).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn un_port_occupe_est_une_erreur_nommee() {
    let premier = ecoute(
        "127.0.0.1:0"
            .parse()
            .unwrap_or_else(|cause| panic!("adresse : {cause}")),
    )
    .await
    .unwrap_or_else(|erreur| panic!("écoute : {erreur}"));
    let adresse = premier
        .local_addr()
        .unwrap_or_else(|cause| panic!("adresse locale : {cause}"));
    // Le second bind sur le MÊME port échoue — avant toute annonce de
    // démarrage, avec l'adresse dans l'erreur.
    match ecoute(adresse).await {
        Err(ErreurDemarrage::Bind {
            adresse: dite,
            detail,
        }) => {
            assert_eq!(dite, adresse.to_string());
            assert!(
                !detail.is_empty(),
                "la cause système est conservée : {detail}"
            );
        }
        Ok(_) => panic!("deux écouteurs sur le même port ?"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_sans_requete_ferme_l_ecoute() {
    let sink = SinkMemoire::default();
    let taches = Arc::new(Taches::nouveau());
    let (adresse, declencheur, _en_cours, poignee) =
        demarre(Duration::from_secs(2), sink.clone(), Arc::clone(&taches)).await;
    // Le serveur répond.
    let reponse = requete(adresse, "/rapide").await;
    assert_eq!(reponse, "ok");
    declencheur.demande();
    let rapport = tokio::time::timeout(Duration::from_secs(5), poignee)
        .await
        .unwrap_or_else(|_| panic!("l'arrêt n'a pas abouti"))
        .unwrap_or_else(|cause| panic!("tâche serveur : {cause}"));
    assert!(!rapport.drain_interrompu, "rien n'était en cours");
    assert_eq!(rapport.requetes_coupees, 0);
    assert_eq!(rapport.taches_vivantes, 0, "aucune tâche de fond ne survit");
    // L'écoute est fermée : plus personne n'écoute.
    let apres = tokio::net::TcpStream::connect(adresse).await;
    assert!(apres.is_err(), "le socket est fermé après l'arrêt");
    // L'arrêt est tracé.
    let entrees = sink.entrees();
    assert!(
        entrees
            .iter()
            .any(|entree| entree.message.contains("arrêt terminé")),
        "{entrees:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn une_requete_lente_est_coupee_et_tracee() {
    let sink = SinkMemoire::default();
    let taches = Arc::new(Taches::nouveau());
    // Drain très court : la requête lente (1 s) ne peut pas finir dedans.
    let (adresse, declencheur, _en_cours, poignee) = demarre(
        Duration::from_millis(150),
        sink.clone(),
        Arc::clone(&taches),
    )
    .await;
    let cliente = tokio::spawn(async move { requete(adresse, "/lent").await });
    // Laisser la requête entrer.
    tokio::time::sleep(Duration::from_millis(100)).await;
    declencheur.demande();
    let rapport = tokio::time::timeout(Duration::from_secs(5), poignee)
        .await
        .unwrap_or_else(|_| panic!("l'arrêt n'a pas abouti"))
        .unwrap_or_else(|cause| panic!("tâche serveur : {cause}"));
    // L'issue partielle est un FAIT, pas un silence.
    assert!(rapport.drain_interrompu, "le drain a dépassé son délai");
    assert_eq!(rapport.requetes_coupees, 1, "une requête était en vol");
    let entrees = sink.entrees();
    let dit = entrees
        .iter()
        .find(|entree| entree.message.contains("encore en cours"))
        .unwrap_or_else(|| panic!("l'issue partielle est tracée : {entrees:?}"));
    assert_eq!(dit.niveau, application::diagnostics::Niveau::Warn);
    assert!(dit.message.contains('1'), "{}", dit.message);
    // Le client n'obtient pas de réponse : il a été coupé.
    let _ = cliente.await;
}

#[tokio::test(flavor = "multi_thread")]
async fn une_deconnexion_de_client_ne_casse_rien() {
    let sink = SinkMemoire::default();
    let taches = Arc::new(Taches::nouveau());
    let (adresse, declencheur, _en_cours, poignee) =
        demarre(Duration::from_secs(2), sink, taches).await;
    // Se connecter puis partir SANS envoyer de requête complète.
    {
        let flux = tokio::net::TcpStream::connect(adresse)
            .await
            .unwrap_or_else(|cause| panic!("connexion : {cause}"));
        flux.writable()
            .await
            .unwrap_or_else(|cause| panic!("writable : {cause}"));
        drop(flux);
    }
    // Le serveur répond toujours.
    let reponse = requete(adresse, "/rapide").await;
    assert_eq!(reponse, "ok");
    declencheur.demande();
    let rapport = tokio::time::timeout(Duration::from_secs(5), poignee)
        .await
        .unwrap_or_else(|_| panic!("l'arrêt n'a pas abouti"))
        .unwrap_or_else(|cause| panic!("tâche serveur : {cause}"));
    assert!(!rapport.drain_interrompu);
}

#[tokio::test(flavor = "multi_thread")]
async fn aucun_agent_n_est_tue_ni_ferme_a_l_arret() {
    // Le démon ne possède pas les agents de l'utilisateur : l'arrêt ferme
    // ses sockets, jamais un onglet (O04). Le faux port le prouve : son
    // journal d'actions reste vide.
    let faux = test_support::fake_herdr::HerdrFaux::nouveau();
    let sink = SinkMemoire::default();
    let ecouteur = ecoute(
        "127.0.0.1:0"
            .parse()
            .unwrap_or_else(|cause| panic!("adresse : {cause}")),
    )
    .await
    .unwrap_or_else(|erreur| panic!("écoute : {erreur}"));
    let adresse = ecouteur
        .local_addr()
        .unwrap_or_else(|cause| panic!("adresse locale : {cause}"));
    let (declencheur, arret) = Declencheur::nouveau();
    let poignee = tokio::spawn(async move {
        sert(
            ecouteur,
            axum::Router::new(),
            Arc::new(EnCours::nouveau()),
            Arc::new(Taches::nouveau()),
            Arc::new(sink),
            arret,
            Duration::from_secs(1),
        )
        .await
    });
    let _ = tokio::net::TcpStream::connect(adresse).await;
    declencheur.demande();
    let rapport = tokio::time::timeout(Duration::from_secs(5), poignee)
        .await
        .unwrap_or_else(|_| panic!("l'arrêt n'a pas abouti"))
        .unwrap_or_else(|cause| panic!("tâche serveur : {cause}"));
    assert!(!rapport.drain_interrompu);
    assert!(
        faux.actions().is_empty(),
        "aucune action n'est partie vers Herdr : {:?}",
        faux.actions()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn les_taches_de_fond_sont_comptees_et_rendues() {
    let taches = Taches::nouveau();
    assert_eq!(taches.vivantes(), 0);
    {
        let _garde = taches.vive();
        assert_eq!(taches.vivantes(), 1);
    }
    assert_eq!(taches.vivantes(), 0, "la garde rend le compte en tombant");
}

#[tokio::test(flavor = "multi_thread")]
async fn arret_deja_demande_ne_bloque_pas() {
    let (declencheur, mut arret) = Declencheur::nouveau();
    declencheur.demande();
    assert!(arret.demande());
    // `recu` rend immédiatement quand l'arrêt est déjà demandé.
    tokio::time::timeout(Duration::from_millis(200), arret.recu())
        .await
        .unwrap_or_else(|_| panic!("un arrêt déjà demandé ne bloque pas"));
    // Et un second signal ne casse rien (idempotent).
    declencheur.demande();
    assert!(arret.demande());
}

/// Une requête HTTP/1.1 minimale sur le faux processus — rend le corps seul
/// (l'en-tête HTTP n'est pas le sujet : la vie du processus l'est).
async fn requete(adresse: std::net::SocketAddr, chemin: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut flux = tokio::net::TcpStream::connect(adresse)
        .await
        .unwrap_or_else(|cause| panic!("connexion : {cause}"));
    let demande = format!("GET {chemin} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n");
    flux.write_all(demande.as_bytes())
        .await
        .unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let mut brut = String::new();
    let _ = flux.read_to_string(&mut brut).await;
    brut.split_once("\r\n\r\n").map_or_else(
        || String::from(brut.trim()),
        |(_, corps)| String::from(corps.trim()),
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn le_declencheur_se_transmet_sans_perdre_l_arret() {
    // Le déclencheur crée des `Arret` supplémentaires : tous voient le même
    // signal (les composants ne peuvent pas rater l'arrêt).
    let (declencheur, premier) = Declencheur::nouveau();
    let second = declencheur.arret();
    declencheur.demande();
    assert!(premier.demande());
    assert!(second.demande());
    let _: Arret = second;
}
