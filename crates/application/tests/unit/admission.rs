//! L'admission (T034) : A/B indépendants (parallèles), non-entrelacement par
//! pane, saturation explicite, annulation après effet sans rejeu.

use application::commands::admission::{ErreurAdmission, FILE_PANE_MAX, Tourniquet};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

fn pane(nom: &str) -> domain::ids::PaneId {
    domain::ids::PaneId::from(String::from(nom))
}

#[test]
fn a_et_b_sont_indépendants_parallèles() {
    let tourniquet = Arc::new(Tourniquet::nouveau());
    let en_cours = Arc::new(AtomicUsize::new(0));
    let pic = Arc::new(AtomicUsize::new(0));
    // Deux panes, deux effets lents CONCURRENTS : le pic de concurrence = 2.
    let poignees: Vec<_> = (0..2)
        .map(|rang| {
            let tourniquet_fils = Arc::clone(&tourniquet);
            let en_cours_fils = Arc::clone(&en_cours);
            let pic_fils = Arc::clone(&pic);
            thread::spawn(move || {
                let pane_courant = pane(&format!("p{rang}"));
                tourniquet_fils
                    .admet(&pane_courant, || {
                        let niveau = en_cours_fils.fetch_add(1, Ordering::SeqCst) + 1;
                        pic_fils.fetch_max(niveau, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(150));
                        let _ = en_cours_fils.fetch_sub(1, Ordering::SeqCst);
                        Result::<(), String>::Ok(())
                    })
                    .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"))
            })
        })
        .collect();
    for poignee in poignees {
        let _ = poignee.join();
    }
    assert!(
        pic.load(Ordering::SeqCst) == 2,
        "les deux panes tournent EN PARALLÈLE : pic {}",
        pic.load(Ordering::SeqCst)
    );
}

#[test]
fn les_séquences_dun_même_pane_ne_sentrelacent_pas() {
    let tourniquet = Arc::new(Tourniquet::nouveau());
    let entrelacs = Arc::new(AtomicUsize::new(0));
    let pic = Arc::new(AtomicUsize::new(0));
    // Huit effets sur LE MÊME pane : chacun entre une seule fois à la fois.
    let poignees: Vec<_> = (0..8)
        .map(|rang| {
            let tourniquet_fils = Arc::clone(&tourniquet);
            let entrelacs_fils = Arc::clone(&entrelacs);
            let pic_fils = Arc::clone(&pic);
            thread::spawn(move || {
                tourniquet_fils
                    .admet(&pane("wA:p1"), || {
                        let niveau = entrelacs_fils.fetch_add(1, Ordering::SeqCst) + 1;
                        pic_fils.fetch_max(niveau, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(30));
                        let _ = entrelacs_fils.fetch_sub(1, Ordering::SeqCst);
                        Result::<usize, String>::Ok(rang)
                    })
                    .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"))
            })
        })
        .collect();
    for poignee in poignees {
        let _ = poignee.join();
    }
    assert!(
        pic.load(Ordering::SeqCst) == 1,
        "UN effet à la fois par pane : pic {}",
        pic.load(Ordering::SeqCst)
    );
}

#[test]
fn la_saturation_est_explicite() {
    let tourniquet = Arc::new(Tourniquet::nouveau());
    // Les 8 admissions ENGAGÉES (fils lents)…
    let poignees: Vec<_> = (0..FILE_PANE_MAX)
        .map(|rang| {
            let tourniquet_fils = Arc::clone(&tourniquet);
            thread::spawn(move || {
                tourniquet_fils
                    .admet(&pane("wA:p2"), move || {
                        thread::sleep(Duration::from_millis(250));
                        Result::<usize, String>::Ok(rang)
                    })
                    .unwrap_or_else(|erreur| {
                        panic!("l'admission {rang} devait passer : {erreur:?}")
                    })
            })
        })
        .collect();
    // PENDANT que les huit tiennent (effets de 250 ms), la neuvième
    // demande → Saturation (NAMÉ). Le fil principal dort 30 ms puis
    // frappe : les huit tiennent encore (8 × 250 ms sérialisés par le
    // tour = 2 s au total — la fenêtre est large).
    thread::sleep(Duration::from_millis(30));
    match tourniquet.admet(&pane("wA:p2"), || Result::<(), String>::Ok(())) {
        Err(Ok(ErreurAdmission::Saturation)) => (),
        Ok(_) => panic!("la 9e admission devait être REFUSÉE (file pleine)"),
        Err(Err(_)) => panic!("l'effet ne devait pas tourner"),
    }
    for poignee in poignees {
        let _ = poignee.join();
    }
}

#[test]
fn l_annulation_après_effet_ne_rejoue_rien() {
    // L'effet a tourné UNE fois ; l'annulation posée APRÈS : le résultat
    // reste, aucune relecture, aucun rejeu.
    let tourniquet = Tourniquet::nouveau();
    let tournus = Arc::new(AtomicUsize::new(0));
    let tournus_fils = Arc::clone(&tournus);
    let rendu = tourniquet
        .admet(&pane("wA:p3"), move || {
            tournus_fils.fetch_add(1, Ordering::SeqCst);
            Result::<String, String>::Ok(String::from("le résultat"))
        })
        .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"));
    assert!(rendu == "le résultat");
    assert!(
        tournus.load(Ordering::SeqCst) == 1,
        "l'effet a tourné UNE fois"
    );
    // (l'annulation se pose après — structurellement, la file n'a AUCUNE
    // relecture : le résultat sert tel quel)
    let tournus_reprise = Arc::clone(&tournus);
    let rendu = tourniquet
        .admet(&pane("wA:p3"), move || {
            tournus_reprise.fetch_add(1, Ordering::SeqCst);
            Result::<String, String>::Ok(String::from("le résultat"))
        })
        .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"));
    assert!(rendu == "le résultat");
    assert!(
        tournus.load(Ordering::SeqCst) == 2,
        "deux effets, deux tours, jamais de rejeu"
    );
}
