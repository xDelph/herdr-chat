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
