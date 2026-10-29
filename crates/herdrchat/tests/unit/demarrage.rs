//! O03 — le ping de démarrage : Herdr joignable est dit, Herdr injoignable
//! est un avertissement nommé, jamais un démarrage refusé.

use application::noyau::PortError;
use herdrchat::demarrage::{Joignabilite, lance_ping_de_demarrage, ping_de_demarrage};
use std::sync::Arc;
use test_support::fake_herdr::{HerdrFaux, Op};

#[test]
fn herdr_joignable_rend_son_protocole() {
    let faux = HerdrFaux::nouveau();
    match ping_de_demarrage(&faux) {
        Joignabilite::Joignable(ping) => assert!(ping.protocol > 0, "{ping:?}"),
        autre => panic!("Herdr sain doit être joignable : {autre:?}"),
    }
    assert_eq!(
        faux.actions()
            .iter()
            .filter(|action| action.op == Op::Ping)
            .count(),
        1,
        "UN ping au démarrage"
    );
}

#[test]
fn herdr_injoignable_garde_la_cause_reelle() {
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: String::from("No such file or directory (os error 2)"),
    });
    match ping_de_demarrage(&faux) {
        Joignabilite::Injoignable(cause) => assert!(cause.contains("os error 2"), "{cause}"),
        autre => panic!("une panne de socket n'est pas joignable : {autre:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn le_ping_tourne_a_cote_et_ne_bloque_pas_le_demarrage() {
    // Le démon lance le ping sur un fil bloquant : le verdict arrive, panne
    // comprise, sans que rien n'attende avant l'écoute.
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Timeout);
    let verdict = lance_ping_de_demarrage(Arc::new(faux))
        .await
        .unwrap_or_else(|cause| panic!("le fil du ping : {cause}"));
    assert!(
        matches!(verdict, Joignabilite::Injoignable(_)),
        "{verdict:?}"
    );
}
