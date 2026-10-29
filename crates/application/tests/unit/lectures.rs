//! Les lectures partagées (H22) : une lecture ne recule jamais, la table est
//! bornée, une panne de persistance est rendue — jamais avalée.

use application::lectures::{MAXIMUM_LECTURES, MagasinLectures, ServiceLectures};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Magasin {
    contenu: Mutex<HashMap<String, u64>>,
    ecritures: Mutex<usize>,
    refuse: bool,
}

impl MagasinLectures for Magasin {
    fn charge(&self) -> Result<HashMap<String, u64>, String> {
        if self.refuse {
            return Err(String::from("lectures.json: permission denied"));
        }
        Ok(self.contenu.lock().map(|c| c.clone()).unwrap_or_default())
    }

    fn ecrit(&self, lectures: &HashMap<String, u64>) -> Result<(), String> {
        if self.refuse {
            return Err(String::from("lectures.json: permission denied"));
        }
        if let Ok(mut n) = self.ecritures.lock() {
            *n += 1;
        }
        if let Ok(mut contenu) = self.contenu.lock() {
            contenu.clone_from(lectures);
        }
        Ok(())
    }
}

#[test]
fn une_lecture_ne_recule_jamais() {
    let service = ServiceLectures::en_memoire();
    assert_eq!(service.lue_a("w1:p1"), None);
    assert_eq!(service.note("w1:p1", 100).lue_a, 100);
    assert_eq!(service.note("w1:p1", 50).lue_a, 100);
    assert_eq!(service.lue_a("w1:p1"), Some(100));
    assert_eq!(service.note("w1:p1", 150).lue_a, 150);
}

#[test]
fn la_lecture_survit_au_redemarrage() {
    let magasin = Arc::new(Magasin::default());
    let (service, panne) = ServiceLectures::charge(magasin.clone());
    assert_eq!(panne, None);
    let _ = service.note("w1:p1", 100);
    // Une lecture plus ancienne n'écrit rien.
    let _ = service.note("w1:p1", 90);
    assert_eq!(magasin.ecritures.lock().map(|n| *n).unwrap_or(0), 1);

    let (relu, _) = ServiceLectures::charge(magasin);
    assert_eq!(relu.lue_a("w1:p1"), Some(100));
}

#[test]
fn une_panne_de_persistance_est_rendue_et_la_lecture_vaut_quand_meme() {
    let magasin = Arc::new(Magasin {
        refuse: true,
        ..Magasin::default()
    });
    let (service, panne) = ServiceLectures::charge(magasin);
    assert_eq!(panne.as_deref(), Some("lectures.json: permission denied"));
    let notee = service.note("w1:p1", 100);
    assert_eq!(notee.lue_a, 100);
    assert_eq!(
        notee.panne.as_deref(),
        Some("lectures.json: permission denied")
    );
    assert_eq!(service.lue_a("w1:p1"), Some(100));
}

#[test]
fn la_table_est_bornee_aux_plus_recentes() {
    let service = ServiceLectures::en_memoire();
    for n in 0..=MAXIMUM_LECTURES {
        let _ = service.note(&format!("p{n}"), n as u64 + 1);
    }
    // La plus ancienne (p0) est oubliée, la plus récente reste.
    assert_eq!(service.lue_a("p0"), None);
    assert_eq!(
        service.lue_a(&format!("p{MAXIMUM_LECTURES}")),
        Some(MAXIMUM_LECTURES as u64 + 1)
    );
}
