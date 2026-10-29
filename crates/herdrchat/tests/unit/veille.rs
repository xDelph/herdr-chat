//! La veille de production : ce qu'elle publie, et ce qu'elle ne publie pas.
//!
//! ⚠️ **Ce fichier existe parce que la veille n'était branchée nulle part.**
//! `evenements_de_changement` n'avait aucun appelant hors de ses propres tests :
//! le démon ne publiait donc jamais `agent_status` ni `session_changed`, et la
//! PWA ne se mettait à jour que par son filet de 30 s. Un test qui exécute la
//! boucle réelle est la seule preuve que le câblage existe.

use application::events::journal::Journal;
use application::events::subscription::ServiceAbonnements;
use application::events::watcher::{
    BoucleDeVeille, Changement, CibleDeChangement, GenreDeChangement, PublicateurDeChangements,
    SourceDeVues, Veilleur,
};
use application::noyau::AgentView;
use application::refresh::MaintenantReelle;
use herdrchat::veille::PublieDansLeJournal;
use std::sync::{Arc, Mutex};

/// Une source qui rend un parc fixé par le test.
struct SourceFixe {
    vues: Mutex<Vec<AgentView>>,
}

impl SourceDeVues for SourceFixe {
    fn vues(&self) -> Result<Vec<AgentView>, String> {
        Ok(self
            .vues
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone())
    }
}

fn une_vue(statut: application::noyau::AgentStatus) -> AgentView {
    AgentView {
        pane_id: application::noyau::PaneId::from(String::from("w1:p1")),
        tab_id: application::noyau::TabId::from(String::from("w1:t1")),
        workspace_id: application::noyau::WorkspaceId::from(String::from("w1")),
        agent: None,
        status: statut,
        focused: false,
        name: None,
        title: Some(String::from("un agent")),
        cwd: Some(String::from("/tmp")),
        tab_label: None,
        tab_number: Some(1),
        workspace_label: None,
        pane_rank: None,
        tab_pane_count: 1,
        session_kind: None,
        session_path: None,
        session_id: None,
        session_cwd: None,
        parent_session: None,
        session_cwd_matches: application::noyau::CwdMatch::Unverifiable,
    }
}

#[test]
fn un_changement_de_statut_est_publie_sur_le_fil() {
    use application::noyau::AgentStatus;

    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    // ⚠️ L'abonnement est pris AVANT la publication : un abonné qui arrive après
    // ne rejoue pas le passé, et le test conclurait « rien n'a été publié ».
    let abonnement = journal
        .abonne("")
        .unwrap_or_else(|refus| panic!("abonnement refusé : {refus:?}"));
    let source = Arc::new(SourceFixe {
        vues: Mutex::new(vec![une_vue(AgentStatus::Idle)]),
    });
    let boucle = BoucleDeVeille::nouvelle(
        source.clone(),
        Arc::new(Veilleur::nouveau()),
        Arc::new(PublieDansLeJournal::nouveau(Arc::clone(&journal))),
        Arc::new(MaintenantReelle),
    );

    // Premier tour : aucun événement pour un parc déjà là (E03).
    let premier = boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));
    assert!(premier.changements.is_empty());

    // L'agent passe en travail : un `agent_status` doit sortir.
    *source
        .vues
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = vec![une_vue(AgentStatus::Working)];
    let second = boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(second.changements.len(), 1);
    assert_eq!(second.changements[0].genre, GenreDeChangement::Statut);
    assert_eq!(
        second.changements[0].a,
        CibleDeChangement::Statut(AgentStatus::Working)
    );

    // Ce qui compte : le journal a bien reçu l'événement, sous son nom public.
    let evenement = abonnement
        .attend(std::time::Duration::ZERO)
        .unwrap_or_else(|| panic!("aucun événement publié"));
    assert_eq!(evenement.genre, "agent_status");
    let charge: serde_json::Value =
        serde_json::from_slice(&evenement.donnees).unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(charge["to"], "working");
    assert_eq!(charge["from"], "idle");
}

#[test]
fn une_source_injoignable_ne_publie_rien() {
    struct SourceEnPanne;

    impl SourceDeVues for SourceEnPanne {
        fn vues(&self) -> Result<Vec<AgentView>, String> {
            Err(String::from("socket absent"))
        }
    }

    struct Compte(Arc<Mutex<usize>>);

    impl PublicateurDeChangements for Compte {
        fn publie(&self, changements: &[Changement]) {
            *self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) += changements.len();
        }
    }

    let compte = Arc::new(Mutex::new(0));
    let boucle = BoucleDeVeille::nouvelle(
        Arc::new(SourceEnPanne),
        Arc::new(Veilleur::nouveau()),
        Arc::new(Compte(Arc::clone(&compte))),
        Arc::new(MaintenantReelle),
    );

    assert!(boucle.une_fois().is_err());
    assert_eq!(
        *compte
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        0
    );
}

// ---------------------------------------------------------------------------
// Les notifications push : la veille les ENFILE (P0 — aucune ne partait).
// ---------------------------------------------------------------------------

use herdrchat::veille::{DernieresVues, SourceMemorisee, notification_de_changement};
use notifications::delivery::{ErreurLivraison, LivraisonPush};
use notifications::notifieur::Notifieur;
use notifications::store::{AbonnementPush, ClefsAbonnement, GardienDeStore};
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

/// Le faux service push : note chaque envoi, répond l'issue scriptée.
struct FauxServicePush {
    envois: Mutex<Vec<(String, String)>>,
    issue: Result<(), ErreurLivraison>,
}

impl FauxServicePush {
    fn qui_repond(issue: Result<(), ErreurLivraison>) -> Arc<Self> {
        Arc::new(Self {
            envois: Mutex::new(Vec::new()),
            issue,
        })
    }

    fn envois(&self) -> Vec<(String, String)> {
        self.envois
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

impl LivraisonPush for FauxServicePush {
    fn envoie<'a>(
        &'a self,
        abonnement: &'a AbonnementPush,
        payload: &'a str,
        _ttl: Duration,
    ) -> Pin<Box<dyn Future<Output = Result<(), ErreurLivraison>> + Send + 'a>> {
        Box::pin(async move {
            self.envois
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((abonnement.endpoint.clone(), String::from(payload)));
            self.issue.clone()
        })
    }
}

fn store_avec_un_abonne() -> Arc<GardienDeStore> {
    static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dossier = std::env::temp_dir().join(format!(
        "herdr-veille-push-{}-{}",
        std::process::id(),
        COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    std::fs::create_dir_all(&dossier).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    let gardien = Arc::new(GardienDeStore::nouveau(dossier.join("push.json"), None));
    gardien
        .abonne(&AbonnementPush {
            endpoint: String::from("https://push.example/telephone"),
            keys: ClefsAbonnement {
                p256dh: String::from("p256dh"),
                auth: String::from("auth"),
            },
        })
        .unwrap_or_else(|erreur| panic!("abonnement : {erreur:?}"));
    gardien
}

/// La boucle de production en miniature : source mémorisée, journal, push.
fn boucle_avec_push(
    source: Arc<SourceFixe>,
    service: Arc<FauxServicePush>,
    store: Arc<GardienDeStore>,
) -> BoucleDeVeille {
    let journal = Arc::new(ServiceAbonnements::nouveau(Arc::new(Journal::nouveau())));
    let vues: DernieresVues = Arc::new(Mutex::new(Vec::new()));
    let notifieur = Arc::new(Notifieur::nouveau(service, store));
    BoucleDeVeille::nouvelle(
        Arc::new(SourceMemorisee::nouvelle(source, Arc::clone(&vues))),
        Arc::new(Veilleur::nouveau()),
        Arc::new(PublieDansLeJournal::nouveau(journal).avec_notifications(notifieur, vues)),
        Arc::new(MaintenantReelle),
    )
}

fn change_le_parc(source: &SourceFixe, vues: Vec<AgentView>) {
    *source
        .vues
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = vues;
}

async fn attend_envois(service: &FauxServicePush, attendus: usize) {
    let debut = std::time::Instant::now();
    while service.envois().len() < attendus {
        assert!(
            debut.elapsed() < Duration::from_secs(2),
            "{attendus} envoi(s) attendu(s), {} vu(s)",
            service.envois().len()
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn working_vers_idle_livre_une_notification_agent_finished() {
    use application::noyau::AgentStatus;

    let service = FauxServicePush::qui_repond(Ok(()));
    let source = Arc::new(SourceFixe {
        vues: Mutex::new(vec![une_vue(AgentStatus::Working)]),
    });
    let boucle = boucle_avec_push(source.clone(), service.clone(), store_avec_un_abonne());
    boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));
    change_le_parc(&source, vec![une_vue(AgentStatus::Idle)]);
    boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));

    attend_envois(&service, 1).await;
    // Un seul envoi : pas de doublon, pas de rafale.
    tokio::time::sleep(Duration::from_millis(50)).await;
    let envois = service.envois();
    assert_eq!(envois.len(), 1, "{envois:?}");
    assert_eq!(envois[0].0, "https://push.example/telephone");
    let payload: serde_json::Value =
        serde_json::from_str(&envois[0].1).unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(payload["title"], "Agent finished");
    assert_eq!(payload["tag"], "done-w1:p1");
    assert_eq!(payload["url"], "/#/agent/w1%3Ap1");
    // L'agent est NOMMÉ par sa vue courante (titre + onglet), pas générique.
    assert_eq!(payload["body"], "un agent · tab 1 has finished working.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn idle_vers_working_ne_notifie_pas() {
    use application::noyau::AgentStatus;

    let service = FauxServicePush::qui_repond(Ok(()));
    let source = Arc::new(SourceFixe {
        vues: Mutex::new(vec![une_vue(AgentStatus::Idle)]),
    });
    let boucle = boucle_avec_push(source.clone(), service.clone(), store_avec_un_abonne());
    boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));
    change_le_parc(&source, vec![une_vue(AgentStatus::Working)]);
    boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(service.envois().is_empty(), "{:?}", service.envois());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn un_abonnement_expire_410_est_elague() {
    use application::noyau::AgentStatus;

    let service = FauxServicePush::qui_repond(Err(ErreurLivraison::Expire));
    let store = store_avec_un_abonne();
    let source = Arc::new(SourceFixe {
        vues: Mutex::new(vec![une_vue(AgentStatus::Working)]),
    });
    let boucle = boucle_avec_push(source.clone(), service.clone(), Arc::clone(&store));
    boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));
    change_le_parc(&source, vec![une_vue(AgentStatus::Blocked)]);
    boucle.une_fois().unwrap_or_else(|cause| panic!("{cause}"));

    attend_envois(&service, 1).await;
    let payload: serde_json::Value =
        serde_json::from_str(&service.envois()[0].1).unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(payload["title"], "Agent needs you");
    assert_eq!(payload["tag"], "waiting-w1:p1");
    let debut = std::time::Instant::now();
    while !store
        .abonnements()
        .unwrap_or_else(|erreur| panic!("{erreur:?}"))
        .is_empty()
    {
        assert!(
            debut.elapsed() < Duration::from_secs(2),
            "l'abonnement expiré n'a pas été élagué"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[test]
fn un_agent_disparu_en_travail_est_annonce_par_sa_derniere_vue() {
    use application::noyau::AgentStatus;

    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![une_vue(AgentStatus::Working)]);
    let tour = veilleur.tick(Vec::new());
    assert_eq!(tour.changements.len(), 1);
    let payload = notification_de_changement(&tour.changements[0], &tour.agents)
        .unwrap_or_else(|| panic!("un agent en travail qui disparaît doit être annoncé"));
    assert_eq!(payload.title, "Agent stopped");
    assert_eq!(payload.tag, "gone-w1:p1");
    assert_eq!(payload.body, "un agent · tab 1 is no longer running.");
}
