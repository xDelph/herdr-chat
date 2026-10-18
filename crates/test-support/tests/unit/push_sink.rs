//! Le puits de push : remises capturées, règles réglables, rien envoyé.

use crate::unit::pousse;
use domain::errors::PortError;
use domain::notifications::{
    BrowserSubscription, PushPayload, PushSubscriptionKeys, VapidPublicKey,
};
use domain::ports::{DeliveryOutcome, NotificationPort};
use test_support::push_sink::{PuitsPushFaux, ReglageRemise};

fn abonnement(endpoint: &str) -> BrowserSubscription {
    BrowserSubscription {
        endpoint: String::from(endpoint),
        keys: PushSubscriptionKeys {
            p256dh: String::from("cle-256-fausse"),
            auth: String::from("cle-auth-fausse"),
        },
    }
}

fn payload(corps: &str) -> PushPayload {
    PushPayload {
        title: String::from("titre du test"),
        body: String::from(corps),
        tag: String::from("wA:p1"),
        url: String::from("https://front.faux/agents/wA"),
    }
}

#[test]
fn les_remises_sont_capturees_dans_l_ordre() {
    let puits = PuitsPushFaux::nouveau();
    puits.regle_remise(ReglageRemise::Delivree {
        empreinte: String::from("ega-1"),
    });
    let mut premiere = puits.deliver(abonnement("https://push.faux/ep-1"), payload("première"));
    match pousse(&mut premiere) {
        Ok(DeliveryOutcome::Delivered { fingerprint }) => {
            assert!(
                fingerprint.as_str() == "ega-1",
                "l'empreinte réglée est rendue"
            );
        }
        Ok(autre) => panic!("règle délivrée → délivrée, pas {autre:?}"),
        Err(cause) => panic!("le puits réglé ne doit pas refuser : {cause}"),
    }
    let mut seconde = puits.deliver(abonnement("https://push.faux/ep-2"), payload("seconde"));
    match pousse(&mut seconde) {
        Ok(_) => (),
        Err(cause) => panic!("remise simulée : {cause}"),
    }
    let remises = puits.remises();
    assert!(remises.len() == 2, "deux remises tentées, notées");
    assert!(
        remises[0].endpoint == "https://push.faux/ep-1"
            && remises[1].endpoint == "https://push.faux/ep-2",
        "l'ordre des endpoints est celui des appels"
    );
    assert!(
        remises[0].payload.body == "première",
        "le payload est copié conforme"
    );
    puits.vider();
    assert!(
        puits.remises().is_empty(),
        "vider laisse le scénario repartir de zéro"
    );
}

#[test]
fn sans_regle_la_remise_est_declaree_inconnue() {
    let puits = PuitsPushFaux::nouveau();
    let mut remise = puits.deliver(abonnement("https://push.faux/ep-3"), payload("sans règle"));
    match pousse(&mut remise) {
        Ok(DeliveryOutcome::Unknown { detail }) => {
            assert!(
                detail.contains("aucune preuve"),
                "le détail dit pourquoi, pas {detail}"
            );
        }
        Ok(DeliveryOutcome::Delivered { .. }) => panic!("jamais « délivré » sans preuve"),
        Err(cause) => panic!("sans règle, le puits ne doit pas paniquer : {cause}"),
    }
    assert!(
        puits.remises().len() == 1,
        "la tentative est notée même non tranchée"
    );
}

#[test]
fn une_regle_inconnue_se_declare_telle_quelle() {
    let puits = PuitsPushFaux::nouveau();
    puits.regle_remise(ReglageRemise::Inconnue {
        detail: String::from("faux hic du service"),
    });
    let mut remise = puits.deliver(
        abonnement("https://push.faux/ep-4"),
        payload("inconnu réglé"),
    );
    match pousse(&mut remise) {
        Ok(DeliveryOutcome::Unknown { detail }) => {
            assert!(
                detail == "faux hic du service",
                "le détail réglé est porté tel quel"
            );
        }
        Ok(autre) => panic!("règle inconnue → inconnue, pas {autre:?}"),
        Err(cause) => panic!("la règle inconnue reste un succès de port : {cause}"),
    }
}

#[test]
fn la_panne_injectee_est_rendue_telle_quelle_et_neanmoins_notee() {
    let puits = PuitsPushFaux::nouveau();
    puits.regle_remise(ReglageRemise::Panne {
        panne: PortError::Transport {
            detail: String::from("prise débranchée par le test"),
        },
    });
    let mut remise = puits.deliver(
        abonnement("https://push.faux/ep-5"),
        payload("panne réglée"),
    );
    let reponse = match pousse(&mut remise) {
        Ok(valeur) => panic!("une panne réglée ne doit pas réussir : {valeur:?}"),
        Err(cause) => cause,
    };
    match reponse {
        PortError::Transport { detail } => {
            assert!(
                detail == "prise débranchée par le test",
                "la panne est portée telle quelle"
            );
        }
        autre => panic!("autre panne : {autre:?}"),
    }
    assert!(
        puits.remises().len() == 1,
        "la tentative ratée figure au journal — un échec non noté serait masqué"
    );
}

/// L'attente d'un port : les faux répondent au premier poll.
fn attend<T: Send>(
    mut fut: domain::ports::PortFuture<'_, T>,
) -> Result<T, domain::errors::PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => panic!("un faux répond au premier poll"),
    }
}

#[test]
fn la_cle_vapid_absente_est_absente() {
    let puits = PuitsPushFaux::nouveau();
    match attend(puits.vapid_public_key()) {
        Ok(None) => (),
        Ok(Some(cle)) => panic!("sans règle, aucune clef, pas {cle:?}"),
        Err(panne) => panic!("sans règle, aucune panne : {panne:?}"),
    }
    puits.regle_vapid(Some(VapidPublicKey::from(String::from(
        "cle-fausse-du-test",
    ))));
    match attend(puits.vapid_public_key()) {
        Ok(Some(cle)) => assert!(
            cle.as_str() == "cle-fausse-du-test",
            "la clef réglée est publiée telle quelle"
        ),
        Ok(None) => panic!("la clef réglée doit paraître"),
        Err(panne) => panic!("pas de panne ici : {panne:?}"),
    }
}

#[test]
fn la_panne_de_resolution_n_est_pas_une_absence() {
    // Une panne de magasin n'est JAMAIS « pas de clef » : le fil doit
    // répondre 500, pas 503 (une capacité absente ne se répare pas).
    let puits = PuitsPushFaux::nouveau();
    puits.panne_vapid(domain::errors::PortError::Upstream {
        code: String::from("EACCES"),
        message: String::from("store illisible"),
    });
    match attend(puits.vapid_public_key()) {
        Err(_) => (),
        autre => panic!("la panne est portée telle quelle : {autre:?}"),
    }
}

#[test]
fn les_abonnements_sont_captures() {
    let puits = PuitsPushFaux::nouveau();
    let abonnement = domain::notifications::BrowserSubscription {
        endpoint: String::from("https://push.example/ep-1"),
        keys: domain::notifications::PushSubscriptionKeys {
            p256dh: String::from("p256dh"),
            auth: String::from("auth"),
        },
    };
    attend(puits.subscribe(abonnement)).unwrap_or_else(|panne| panic!("abonnement : {panne:?}"));
    attend(puits.unsubscribe(String::from("https://push.example/ep-2")))
        .unwrap_or_else(|panne| panic!("désabonnement : {panne:?}"));
    assert_eq!(
        puits.abonnes(),
        vec![String::from("https://push.example/ep-1")]
    );
    assert_eq!(
        puits.desabonnes(),
        vec![String::from("https://push.example/ep-2")]
    );
}
