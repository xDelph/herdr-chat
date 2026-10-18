//! L'index partagé (T027) : huit clients = UNE lecture, la réponse tardive
//! d'une vieille génération ignorée, disparition/réapparition, le lease
//! d'observation, les bornes de mémoire.

use sessions::agents::opencode::moteur::EntreeBrute;
use sessions::index::{CAPACITE_INDEX, ErreurIndex, IndexSessions};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

fn entrees_de(n: u64) -> Vec<EntreeBrute> {
    vec![EntreeBrute {
        id: Some(format!("m-{n}")),
        parent_id: None,
        brut: serde_json::json!({
            "message": { "role": "user", "content": [{ "type": "text", "text": format!("demande {n}") }] },
        })
        .to_string(),
        timestamp: None,
        genre: "message".to_string(),
    }]
}

#[test]
fn huit_clients_ne_multiplient_pas_les_lectures() {
    let index = Arc::new(IndexSessions::nouveau());
    let lectures = Arc::new(AtomicUsize::new(0));
    let engagee = Arc::new(AtomicUsize::new(0));
    let poignees: Vec<_> = (0..8)
        .map(|rang| {
            let index_fils = Arc::clone(&index);
            let lectures_client = Arc::clone(&lectures);
            let engagee_client = Arc::clone(&engagee);
            thread::spawn(move || {
                // Les clients 2..8 attendent que la lecture soit ENGAGÉE
                // (la fenêtre de single-flight, prouvée et non espérée).
                if rang > 0 {
                    while engagee_client.load(Ordering::SeqCst) == 0 {
                        thread::sleep(Duration::from_millis(2));
                    }
                }
                index_fils.interroge(
                    "source-1",
                    true,
                    || {
                        lectures_client.fetch_add(1, Ordering::SeqCst);
                        engagee_client.store(1, Ordering::SeqCst);
                        // La lecture LENTE — les autres attendent.
                        thread::sleep(Duration::from_millis(200));
                        Ok(entrees_de(1))
                    },
                )
            })
        })
        .collect();
    let mut reussites = 0_usize;
    for poignee in poignees {
        match poignee.join() {
            Some(Ok(_resume)) => reussites += 1,
            Some(Err(cause)) => panic!("un client a échoué : {cause:?}"),
            None => panic!("un fil a paniqué"),
        }
    }
    assert!(reussites == 8, "les huit clients servis : {reussites}");
    assert!(
        lectures.load(Ordering::SeqCst) == 1,
        "UNE seule lecture sous-jacente : {}",
        lectures.load(Ordering::SeqCst)
    );
}

#[test]
fn une_réponse_tardive_d_ancienne_génération_est_ignorée() {
    let index = Arc::new(IndexSessions::nouveau());
    let engagee = Arc::new(AtomicUsize::new(0));
    let engagee_fils = Arc::clone(&engagee);
    let index_lecteur = Arc::clone(&index);
    let poignee = thread::spawn(move || {
        index_lecteur.interroge(
            "source-1",
            true,
            || {
                engagee_fils.store(1, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(150));
                Ok(entrees_de(1))
            },
        )
    });
    // L'invalidation PENDANT la lecture : la génération avance.
    while engagee.load(Ordering::SeqCst) == 0 {
        thread::sleep(Duration::from_millis(2));
    }
    index.invalide("source-1");
    match poignee.join() {
        Some(Err(ErreurIndex::GenerationDepassee)) => (),
        autre => panic!("la réponse tardive doit être IGNORÉE : {autre:?}"),
    }
    // Le cache n'a pas reçu le résultat périmé.
    assert!(index.resume_cache("source-1").is_none(), "le résultat périmé n'entre pas");
    assert!(index.generation_de("source-1") == 1, "la génération a avancé");
}

#[test]
fn disparition_réapparition_et_cold_miss() {
    let index = IndexSessions::nouveau();
    let lectures = Arc::new(AtomicUsize::new(0));
    let lectures_fils = Arc::clone(&lectures);
    index.interroge("source-1", true, || {
        lectures_fils.fetch_add(1, Ordering::SeqCst);
        Ok(entrees_de(1))
    });
    index.invalide("source-1");
    index.interroge("source-1", true, || {
        lectures_fils.fetch_add(1, Ordering::SeqCst);
        Ok(entrees_de(2))
    });
    assert!(
        lectures.load(Ordering::SeqCst) == 2,
        "après invalidation, la lecture REPART (cold miss) : {}",
        lectures.load(Ordering::SeqCst)
    );
    match index.resume_cache("source-1") {
        Some(resume) => assert!(
            resume.dernier_prompt.as_deref() == Some("demande 2"),
            "la réapparition lit le NOUVEAU contenu : {:?}",
            resume.dernier_prompt
        ),
        None => panic!("la source réapparaît avec ses données"),
    }
}

#[test]
fn le_lease_dobservation_se_renouvelle_seulement_si_observe() {
    let index = IndexSessions::nouveau();
    index.interroge("source-1", false, || Ok(entrees_de(1)));
    assert!(index.lease_de("source-1").is_none(), "observe=0 ne renouvelle PAS le lease");
    index.interroge("source-1", true, || Ok(entrees_de(1)));
    let premier = index.lease_de("source-1");
    assert!(premier.is_some(), "observe=1 renouvelle le lease");
    thread::sleep(Duration::from_millis(5));
    index.interroge("source-1", false, || Ok(entrees_de(1)));
    assert!(
        index.lease_de("source-1") == premier,
        "observe=0 ne déplace PAS le lease existant"
    );
}

#[test]
fn les_bornes_de_mémoire_évincent_la_plus_ancienne() {
    let index = IndexSessions::nouveau();
    for n in 0..=CAPACITE_INDEX {
        let cle = format!("source-{n}");
        index.interroge(&cle, true, || Ok(entrees_de(n as u64)));
    }
    // La plus ancienne est évincée ; la récente reste.
    assert!(index.generation_de("source-0") == 0, "source-0 évincée");
    assert!(index.generation_de(&format!("source-{CAPACITE_INDEX}")) == 1, "la récente reste");
    // La lecture d'une évincée repart en cold miss propre.
    let lectures = Arc::new(AtomicUsize::new(0));
    let lectures_fils = Arc::clone(&lectures);
    index.interroge("source-0", true, || {
        lectures_fils.fetch_add(1, Ordering::SeqCst);
        Ok(entrees_de(0))
    });
    assert!(lectures.load(Ordering::SeqCst) == 1, "le cold miss relit");
}
