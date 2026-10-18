//! Le service de focus (T036/A05/C24) : l'échec reste une valeur, la cible
//! est celle de l'appel, la ligne de journal est explicite.

use application::commands::focus::{FocaliseurAgent, IssueFocus};
use domain::errors::PortError;
use domain::ids::PaneId;
use domain::ports::FocusEvidence;
use test_support::fake_herdr::{HerdrFaux, Op};

fn cible() -> PaneId {
    PaneId::from(String::from("wA:p1"))
}

#[test]
fn le_focus_reussi_est_porte_avec_sa_ligne_ok() {
    // A05 : l'effet réel est appliqué, la ligne dit « ok ».
    let faux = HerdrFaux::nouveau();
    faux.repond_focus(FocusEvidence::Focused);
    let issue = FocaliseurAgent::nouveau().focalise(&faux, &cible());
    assert!(issue.focalise, "le focus a un effet réel");
    assert!(issue.cause.is_none(), "pas de cause sur un succès");
    assert!(
        issue.ligne_journal(&cible()) == "focus wA:p1 (ok)",
        "la ligne de journal du fil : {}",
        issue.ligne_journal(&cible())
    );
    let actions = faux.actions();
    assert!(
        actions.len() == 1 && actions[0].op == Op::Focus && actions[0].cible == "wA:p1",
        "le focus vise la cible de l'appel : {:?}",
        actions
    );
}

#[test]
fn le_refus_est_une_valeur_200_pas_une_panne() {
    // A05 : refusé → `focused: false` en VALEUR, cause exacte portée.
    let faux = HerdrFaux::nouveau();
    faux.repond_focus(FocusEvidence::Refused {
        detail: String::from("bureau occupé par un autre focus"),
    });
    let issue = FocaliseurAgent::nouveau().focalise(&faux, &cible());
    assert!(!issue.focalise, "le refus n'applique rien");
    match &issue.cause {
        Some(cause) => assert!(
            cause.contains("bureau occupé"),
            "la cause réelle passe : {cause}"
        ),
        None => panic!("un refus porte sa cause"),
    }
    assert!(
        issue.ligne_journal(&cible()) == "focus wA:p1 (échec)",
        "la ligne dit échec : {}",
        issue.ligne_journal(&cible())
    );
}

#[test]
fn la_panne_transport_ne_ferme_pas_la_lecture() {
    // A05 : « focus échoué n'empêche pas lecture » — une panne de
    // transport reste une VALEUR (focused: false), jamais une erreur.
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: String::from("socket Herdr fermé"),
    });
    let issue = FocaliseurAgent::nouveau().focalise(&faux, &cible());
    assert!(!issue.focalise, "la panne ne promet pas un focus");
    match &issue.cause {
        Some(cause) => assert!(
            cause.contains("socket Herdr fermé"),
            "la cause réelle passe : {cause}"
        ),
        None => panic!("une panne porte sa cause"),
    }
}

#[test]
fn l_issue_s_imprime_tel_quelle_sans_verdict_invente() {
    // Une IssueFocus n'est jamais affichée « envoyé » : focalise=false
    // quand rien n'est prouvé, la cause nomme le refus.
    let faux = HerdrFaux::nouveau();
    faux.repond_focus(FocusEvidence::Refused {
        detail: String::from("FenetreInconnue"),
    });
    let issue = FocaliseurAgent::nouveau().focalise(&faux, &cible());
    assert_eq!(
        issue,
        IssueFocus {
            focalise: false,
            cause: Some(String::from("FenetreInconnue")),
        }
    );
}
