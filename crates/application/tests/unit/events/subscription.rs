//! Les abonnements au direct (T043, E05, C11) : 8 permis RAII, le 9e flux
//! refusé, la frontière replay/live sans perte ni doublon, la sonnette
//! bornée (un consommateur lent ne grossit pas la mémoire), et 100 cycles
//! connect/disconnect sans permis orphelin.

use application::events::journal::IdJournal;
use application::events::journal::Journal;
use application::events::subscription::{
    ABONNEMENTS_MAX, Abonnement, CANAL_LIVE, RefusAbonnement, ServiceAbonnements,
};
use std::sync::Arc;
use std::time::Duration;

fn service() -> (ServiceAbonnements, Arc<Journal>) {
    let journal = Arc::new(Journal::nouveau());
    let service = ServiceAbonnements::nouveau(Arc::clone(&journal));
    (service, journal)
}

fn publie(
    service: &ServiceAbonnements,
    genre: &str,
) -> application::events::journal::EvenementJournal {
    service
        .publie(genre, vec![b'x'; 4])
        .unwrap_or_else(|_| panic!("la publication doit réussir"))
}

fn id(journal: &Journal, sequence: u64) -> String {
    IdJournal {
        boot: String::from(journal.boot()),
        sequence,
    }
    .opaque()
}

#[test]
fn le_9e_flux_est_refuse() {
    // S06 : au plus 8 flux — le 9e est REFUSÉ (503), jamais mis en attente.
    let (service, journal) = service();
    let mut abonnements = Vec::new();
    for _ in 0..ABONNEMENTS_MAX {
        abonnements.push(
            service
                .abonne("")
                .unwrap_or_else(|_| panic!("la place est libre")),
        );
    }
    assert_eq!(service.nb_abonnes(), ABONNEMENTS_MAX);
    assert!(
        matches!(service.abonne(""), Err(RefusAbonnement::TropDeFlux)),
        "le 9e flux est refusé"
    );
    // La fermeture d'un abonnement rend la place : le suivant passe.
    drop(abonnements.pop());
    let _ = journal;
    let _retour = service
        .abonne("")
        .unwrap_or_else(|_| panic!("la place est rendue"));
}

#[test]
fn cent_cycles_connect_disconnect_ne_laissent_aucun_permis_orphelin() {
    // T043 : 100 cycles au repos — les 8 places toujours disponibles
    // (aucun permis orphelin), et les émetteurs morts nettoyés à la
    // prochaine opération.
    let (service, _journal) = service();
    for _ in 0..100 {
        let abonnement = service
            .abonne("")
            .unwrap_or_else(|_| panic!("la place est libre"));
        drop(abonnement);
    }
    let mut tenus = Vec::new();
    for _ in 0..ABONNEMENTS_MAX {
        tenus.push(
            service
                .abonne("")
                .unwrap_or_else(|_| panic!("toutes les places sont rendues")),
        );
    }
    assert!(
        matches!(service.abonne(""), Err(RefusAbonnement::TropDeFlux)),
        "exactement 8 places, ni plus ni moins"
    );
    // On ferme tout, puis la prochaine opération nettoie les morts : le
    // compte ne reflète que les vivants.
    drop(tenus);
    let dernier = service
        .abonne("")
        .unwrap_or_else(|_| panic!("la place est libre"));
    drop(dernier);
    let _ = publie(&service, "a");
    assert_eq!(service.nb_abonnes(), 0, "aucun émetteur orphelin");
}

#[test]
fn le_rattrapage_et_le_live_ne_perdent_ni_ne_doublent() {
    // T043 : la frontière replay/live — ce qui précède le curseur est dans
    // le rattrapage, ce qui suit arrive par la sonnette ; rien ne tombe
    // entre les deux, rien n'est doublé.
    let (service, journal) = service();
    let un = publie(&service, "a");
    let deux = publie(&service, "b");
    let abonnement = service
        .abonne(&un.id.opaque())
        .unwrap_or_else(|_| panic!("abonné"));
    // Le rattrapage contient exactement ce qui suit le curseur.
    let sequences: Vec<u64> = abonnement
        .rattrapage()
        .evenements
        .iter()
        .map(|e| e.id.sequence)
        .collect();
    assert_eq!(sequences, vec![2], "le rattrapage est exact");
    // La suite arrive par la sonnette.
    let trois = publie(&service, "c");
    let recu = abonnement
        .attend(Duration::from_millis(100))
        .unwrap_or_else(|| panic!("l'événement live arrive"));
    assert_eq!(recu.id, trois.id);
    assert_eq!(recu.id.sequence, 3);
    // Rien n'a été doublé : le rattrapage n'a pas rejoué « un ».
    let _ = deux;
    let _ = journal;
}

#[test]
fn un_evenement_publie_avant_l_abonnement_est_dans_le_rattrapage() {
    // L'atomicité, côté publication d'abord : l'événement est dans le
    // journal, le rattrapage (calculé sous la même possession) le rend.
    let (service, _journal) = service();
    let un = publie(&service, "a");
    let abonnement = service
        .abonne(&id(&_journal, 0))
        .unwrap_or_else(|_| panic!("abonné"));
    let sequences: Vec<u64> = abonnement
        .rattrapage()
        .evenements
        .iter()
        .map(|e| e.id.sequence)
        .collect();
    assert_eq!(sequences, vec![un.id.sequence]);
}

#[test]
fn un_evenement_publie_apres_l_abonnement_arrive_par_la_sonnette() {
    let (service, _journal) = service();
    let abonnement = service.abonne("").unwrap_or_else(|_| panic!("abonné"));
    assert!(
        abonnement.rattrapage().evenements.is_empty(),
        "pas de rejeu"
    );
    let un = publie(&service, "a");
    let recu = abonnement
        .attend(Duration::from_millis(100))
        .unwrap_or_else(|| panic!("l'événement live arrive"));
    assert_eq!(recu.id, un.id);
}

#[test]
fn la_sonnette_bornee_ne_grossit_pas_la_memoire() {
    // T043 : un consommateur lent ne fait pas grossir la mémoire — le canal
    // live est borné, les événements au-delà restent dans le journal.
    let (service, journal) = service();
    let abonnement = service.abonne("").unwrap_or_else(|_| panic!("abonné"));
    // On publie bien plus que la capacité du canal sans jamais lire.
    let mut dernier = None;
    for index in 0..(CANAL_LIVE * 4) {
        dernier = Some(publie(&service, &format!("e{index}")));
    }
    // L'abonnement est toujours vivant (le canal plein n'a pas désabonné).
    assert_eq!(service.nb_abonnes(), 1, "plein mais vivant");
    // La sonnette ne contient que ce que le canal peut tenir.
    let mut recus = 0;
    while abonnement.attend(Duration::from_millis(1)).is_some() {
        recus += 1;
    }
    assert!(
        recus <= CANAL_LIVE,
        "la sonnette est bornée (reçus = {recus})"
    );
    // Le journal, lui, a tout : la relecture depuis la frontière retrouve
    // les événements tombés de la sonnette.
    let relecture = abonnement.rattrapage_depuis(&id(&journal, 0));
    assert!(
        relecture.evenements.len() >= CANAL_LIVE * 4 - 1,
        "le journal garde tout (relecture = {})",
        relecture.evenements.len()
    );
    let _ = dernier;
    let _ = journal;
}

#[test]
fn le_heartbeat_est_la_cadence_de_la_sonnette() {
    // E05 : sans événement, la sonnette rend `None` après le délai — le
    // heartbeat du flux, puis la relecture du journal.
    let (service, _journal) = service();
    let abonnement = service.abonne("").unwrap_or_else(|_| panic!("abonné"));
    let debut = std::time::Instant::now();
    let recu = abonnement.attend(Duration::from_millis(40));
    assert!(recu.is_none(), "rien à annoncer");
    assert!(
        debut.elapsed() >= Duration::from_millis(30),
        "l'attente a réellement attendu"
    );
}

#[test]
fn la_relecture_du_journal_retrouve_ce_que_la_sonnette_a_laisse_tomber() {
    // T043 : le journal est l'autorité — après un heartbeat vide, la
    // relecture depuis le curseur rend les événements manqués.
    let (service, journal) = service();
    let abonnement = service.abonne("").unwrap_or_else(|_| panic!("abonné"));
    let un = publie(&service, "a");
    let deux = publie(&service, "b");
    // Le consommateur n'a rien lu : la relecture depuis la frontière rend
    // tout ce qui a été publié.
    let relecture = abonnement.rattrapage_depuis(&id(&journal, 0));
    let sequences: Vec<u64> = relecture.evenements.iter().map(|e| e.id.sequence).collect();
    assert_eq!(sequences, vec![un.id.sequence, deux.id.sequence]);
    // La relecture depuis le dernier lu ne rend que la suite.
    let suite = abonnement.rattrapage_depuis(&un.id.opaque());
    let sequences: Vec<u64> = suite.evenements.iter().map(|e| e.id.sequence).collect();
    assert_eq!(sequences, vec![deux.id.sequence]);
}

#[test]
fn la_chute_de_l_abonnement_ferme_la_sonnette() {
    // T043 : un abonnement fermé ne reçoit plus rien — et sa place est
    // rendue (le 9e flux repasse).
    let (service, _journal) = service();
    let abonnement: Abonnement = service.abonne("").unwrap_or_else(|_| panic!("abonné"));
    drop(abonnement);
    let _ = publie(&service, "a");
    assert_eq!(service.nb_abonnes(), 0, "l'émetteur mort est retiré");
    let _ = service
        .abonne("")
        .unwrap_or_else(|_| panic!("la place est rendue"));
}
