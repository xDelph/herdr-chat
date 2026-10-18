//! Identifiants distincts et liaison pane⇄source.

use domain::ids::{PaneId, RequestId, SessionId, SourceKey, TabId, WorkspaceId};
use domain::session::SourceBinding;

#[test]
fn la_meme_chaine_ne_melite_jamais_deux_familles() {
    // Même chaîne interne, deux familles : les valeurs restent deux types.
    // Chaque famille offre sa propre égalité, opaque et indépendante — et
    // aucun `From<PaneId> for SourceKey` n'existe dans l'API : la confusion
    // de famille est refusée à la compilation, pas surveillée à l'exécution.
    let pane = PaneId::from("wA:p7".to_string());
    let clef = SourceKey::from("wA:p7".to_string());
    assert_eq!(pane.as_str(), clef.as_str());
    assert_eq!(pane, PaneId::from("wA:p7".to_string()));
    assert_eq!(clef, SourceKey::from("wA:p7".to_string()));
}

fn tab(n: u64) -> TabId {
    TabId::from(format!("t{n}"))
}
fn workspace(n: u64) -> WorkspaceId {
    WorkspaceId::from(format!("w{n}"))
}
fn session(n: u64) -> SessionId {
    SessionId::from(format!("s{n}"))
}
fn demande(n: u64) -> RequestId {
    RequestId::from(format!("r{n}"))
}

#[test]
fn chaque_famille_construit_ce_qui_lui_parle() {
    // Les constructeurs sont explicites et par famille ; sans résolution,
    // lier un pane à une session est un objet de T023, pas du déduction.
    let t = tab(5);
    let w = workspace(7);
    let s = session(11);
    let r = demande(13);
    assert_eq!(t.as_str(), "t5");
    assert_eq!(w.as_str(), "w7");
    assert_eq!(s.as_str(), "s11");
    assert_eq!(r.as_str(), "r13");
}

#[test]
fn une_liaison_est_legitime_uniquement_a_les_deux_cles_identiques() {
    let p1 = PaneId::from("wA:p1".to_string());
    let p2 = PaneId::from("wA:p2".to_string());
    let ka = SourceKey::from("ka".to_string());
    let kb = SourceKey::from("kb".to_string());

    let liée = SourceBinding {
        pane: p1.clone(),
        source: ka.clone(),
    };
    // Même pane, même source : c'est la liaison.
    assert_eq!(
        liée,
        SourceBinding {
            pane: p1.clone(),
            source: ka.clone()
        }
    );
    // Même pane, autre source : le pane a changé de session.
    assert_ne!(
        liée,
        SourceBinding {
            pane: p1.clone(),
            source: kb.clone()
        }
    );
    // Autre pane, même source : la résolution d'un pane **ne démontre
    // rien** pour son voisin — source ≠ pane, dans les deux sens (C12/C20).
    assert_ne!(
        liée,
        SourceBinding {
            pane: p2.clone(),
            source: ka.clone()
        }
    );
    // Les deux membres diffèrent : rien de comparable.
    assert_ne!(
        liée,
        SourceBinding {
            pane: p2.clone(),
            source: kb.clone()
        }
    );
}

#[test]
fn l_identifiant_de_pane_se_classe_deterministiquement() {
    let haut = PaneId::from("p10".to_string());
    let bas = PaneId::from("p2".to_string());
    // Ordre d'octets : "p10" avant "p2" ("1" < "2"). Départage documenté
    // (naming) : déterministe, IDs Herdr de forme ASCII.
    match haut.cmp(&bas) {
        std::cmp::Ordering::Less => (),
        autre => panic!("le départage a divergé : {autre:?}"),
    }
}
