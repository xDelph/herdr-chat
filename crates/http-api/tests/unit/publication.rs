//! Les événements d'un changement de veille : un changement de contenu ne
//! publie que `session_changed`, jamais un `agent_status` inventé.

use application::events::watcher::{Changement, CibleDeChangement, GenreDeChangement};
use domain::ids::PaneId;
use domain::status::AgentStatus;
use http_api::publication::{GENRE_SESSION_CHANGED, evenements_de_changement};

fn changement(genre: GenreDeChangement, de: AgentStatus, a: AgentStatus) -> Changement {
    Changement {
        pane_id: PaneId::from(String::from("w1:p1")),
        de: Some(de),
        a: CibleDeChangement::Statut(a),
        genre,
        disparu: None,
        revision_avant: String::from("aaaaaaaaaaaaaaaa"),
        revision_apres: String::from("bbbbbbbbbbbbbbbb"),
    }
}

#[test]
fn un_changement_de_contenu_ne_publie_que_la_session() {
    let evenements = evenements_de_changement(&changement(
        GenreDeChangement::Contenu,
        AgentStatus::Working,
        AgentStatus::Working,
    ));
    assert_eq!(evenements.len(), 1);
    assert_eq!(evenements[0].genre, GENRE_SESSION_CHANGED);
    let texte = String::from_utf8_lossy(&evenements[0].donnees);
    assert!(
        texte.contains("bbbbbbbbbbbbbbbb"),
        "la nouvelle révision : {texte}"
    );
}

#[test]
fn un_changement_de_statut_publie_les_deux() {
    let evenements = evenements_de_changement(&changement(
        GenreDeChangement::Statut,
        AgentStatus::Working,
        AgentStatus::Idle,
    ));
    let genres: Vec<&str> = evenements.iter().map(|evenement| evenement.genre).collect();
    assert_eq!(genres, vec!["agent_status", GENRE_SESSION_CHANGED]);
}
