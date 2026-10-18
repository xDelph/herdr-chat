//! L'horloge contrôlée : le temps n'existe que quand un test le pousse.

use std::panic;
use test_support::fake_clock::HorlogeFausse;

#[test]
fn le_temps_ne_bouge_que_si_un_test_le_pousse() {
    let horloge = HorlogeFausse::figee_a(1_000);
    assert!(
        horloge.maintenant().0 == 1_000,
        "l'heure fixée doit tenir sans bouger"
    );
    assert!(
        horloge.avance(50).0 == 1_050,
        "l'avance ajoute exactement sa valeur"
    );
    assert!(
        horloge.pose_a(900).0 == 900,
        "le saut arrière est explicite et local"
    );
    assert!(
        horloge.avance(1).0 == 901,
        "l'avance repart de l'heure posée"
    );
    assert!(
        HorlogeFausse::figee_a(0).maintenant().0 == 0,
        "zéro = jamais écoulé, une absence mesurable"
    );
}

#[test]
fn les_clones_partagent_la_meme_heure() {
    let horloge = HorlogeFausse::figee_a(0);
    let clonee = horloge.clone();
    horloge.avance(7);
    assert!(
        clonee.maintenant().0 == 7,
        "un service qui reçoit un clone voit le temps du test"
    );
}

#[test]
fn l_avance_hors_bornes_est_refusee_loudement() {
    let horloge = HorlogeFausse::figee_a(u64::MAX);
    let couche = panic::catch_unwind(|| horloge.avance(1));
    assert!(
        couche.is_err(),
        "une avance hors bornes doit être refusée, jamais saturée en silence"
    );
}
