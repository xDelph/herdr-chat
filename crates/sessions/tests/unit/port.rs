//! Le port de sessions (T056 suite) : résolution, pages, clauses.
//!
//! ⚠️ Aucune session de l'utilisateur n'est lue : les fixtures sont des
//! fichiers JSONL temporaires, créés par le test. Herdr n'est pas contacté —
//! il ne fournit que l'emplacement, et ce test le passe à la main.
//! Prouve : D09.

use domain::observation::{AgentSessionRef, SessionRefKind};
use domain::ports::SessionPort;
use domain::session::{
    ResolvedSource, SessionHint, SessionPageOutcome, SessionPageRequest, SourceKind,
};
use sessions::port::{PortSessions, empreinte_de_source};
use sessions::resolver::Racines;
use std::path::{Path, PathBuf};

/// Compteur de dossiers : deux tests lancés dans la même nanoseconde
/// partageaient leur dossier temporaire — un échec intermittent observé une
/// fois sur `sessions` (test vert en isolation, rouge en parallèle).
static COMPTEUR_DOSSIERS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn dossier() -> PathBuf {
    let unique = format!(
        "sessions-port-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duree| duree.as_nanos())
            .unwrap_or(0),
        COMPTEUR_DOSSIERS.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    );
    let chemin = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&chemin).unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn racines(racine: &Path) -> Racines {
    Racines {
        claude_projects: racine.join("claude"),
        codex_home: racine.join("codex-home"),
        codex_sessions: racine.join("codex-sessions"),
        devin_db: racine.join("devin.db"),
        opencode_db: racine.join("opencode.db"),
    }
}

/// Une session pi minimale : deux messages et un réglage.
fn ecrit_session(chemin: &Path) {
    let lignes = [
        r#"{"type":"message","id":"m1","timestamp":"2026-10-15T10:00:00Z","message":{"role":"user","content":"bonjour"}}"#,
        r#"{"type":"message","id":"m2","parentId":"m1","timestamp":"2026-10-15T10:00:05Z","message":{"role":"assistant","content":"salut"}}"#,
    ];
    let contenu = format!("{}\n{}\n", lignes[0], lignes[1]);
    std::fs::create_dir_all(chemin.parent().unwrap_or(chemin))
        .unwrap_or_else(|cause| panic!("dossier : {cause}"));
    std::fs::write(chemin, contenu).unwrap_or_else(|cause| panic!("écriture : {cause}"));
}

fn source_fichier(chemin: &Path) -> ResolvedSource {
    ResolvedSource {
        kind: SourceKind::File,
        base: chemin.display().to_string(),
        session_id: None,
        family: Some(domain::ids::AgentKind::from(String::from("pi"))),
    }
}

fn attend<T: Send>(
    mut futur: domain::ports::SessionFuture<'_, T>,
) -> Result<T, domain::errors::ErreurDomaine> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => panic!("un port bloquant répond au premier poll"),
    }
}

#[test]
fn une_page_depuis_le_debut_rend_les_entrees_et_un_curseur() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let issue = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: None,
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    let SessionPageOutcome::Page(page) = issue else {
        panic!("une page pleine : {issue:?}");
    };
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.entries[0].kind, "message");
    assert_eq!(page.entries[0].id.as_deref(), Some("m1"));
    assert_eq!(page.entries[1].parent_id.as_deref(), Some("m1"));
    // Le brut est conservé TEL QUEL (la compatibilité est le contrat).
    assert!(page.entries[0].raw.contains("\"role\":\"user\""));
    assert!(page.cursor.is_some(), "un curseur est rendu");
    assert!(page.rattrape, "tout le fichier a été consommé");
    assert!(!page.reset);
    assert_eq!(page.session_path, chemin.display().to_string());
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_curseur_rendu_permet_de_lire_la_suite() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let premiere = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: None,
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    let SessionPageOutcome::Page(page) = premiere else {
        panic!("une page");
    };
    let curseur = page.cursor.unwrap_or_else(|| panic!("curseur"));
    // Une suite sans nouveau contenu : aucun doublon (la page est vide).
    let suite = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: Some(curseur),
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    match suite {
        SessionPageOutcome::Vide(page) => assert!(page.entries.is_empty()),
        autre => panic!("une suite sans nouveauté est vide : {autre:?}"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_fichier_absent_est_absent_pas_une_panne() {
    let racine = dossier();
    let chemin = racine.join("sessions/inexistant.jsonl");
    let port = PortSessions::nouveau(racines(&racine));
    let issue = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: None,
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    // ⚠️ Le JSONL naît au premier message : absente = bénin, pas une panne.
    assert!(matches!(issue, SessionPageOutcome::Absente(_)), "{issue:?}");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_curseur_d_une_autre_source_est_refuse() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let autre = ResolvedSource {
        base: String::from("/sessions/autre.jsonl"),
        ..source_fichier(&chemin)
    };
    let curseur =
        sessions::cursor::encode(&empreinte_de_source(&autre), "/sessions/autre.jsonl", 1, 0);
    let issue = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: Some(curseur),
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    // Un curseur étranger est une DEMANDE invalide : on le dit (400), on ne
    // relit pas au hasard.
    match issue {
        SessionPageOutcome::Invalide { detail } => {
            assert!(detail.contains("curseur"), "{detail}");
        }
        autre_issue => panic!("un curseur étranger est refusé : {autre_issue:?}"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_curseur_illisible_est_refuse() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let issue = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: Some(String::from("pas-un-curseur")),
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    assert!(
        matches!(issue, SessionPageOutcome::Invalide { .. }),
        "{issue:?}"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_page_arriere_remonte_l_historique() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let premiere = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: None,
        previous_cursor: None,
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    let SessionPageOutcome::Page(page) = premiere else {
        panic!("une page");
    };
    // Le curseur d'historique rendu pointe le DÉBUT du fichier : la page
    // arrière est vide, ce qui est exact (rien avant le début).
    let avant = page
        .previous_cursor
        .unwrap_or_else(|| panic!("curseur d'historique"));
    let arriere = attend(port.page(SessionPageRequest {
        source: source_fichier(&chemin),
        cursor: None,
        previous_cursor: Some(avant),
        limit: 512 * 1024,
    }))
    .unwrap_or_else(|cause| panic!("page : {cause:?}"));
    let SessionPageOutcome::Page(page) = arriere else {
        panic!("une page arrière : {arriere:?}");
    };
    assert!(page.entries.is_empty(), "rien avant le début du fichier");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn la_resolution_utilise_l_emplacement_publie_par_herdr() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let resolution = attend(port.resolve(SessionHint {
        agent: Some(domain::ids::AgentKind::from(String::from("pi"))),
        cwd: Some(String::from("/projets/atelier")),
        published: Some(AgentSessionRef {
            kind: SessionRefKind::Path,
            value: chemin.display().to_string(),
        }),
        title: None,
    }))
    .unwrap_or_else(|cause| panic!("résolution : {cause:?}"));
    let source = resolution.unwrap_or_else(|| panic!("une source publiée est résolue"));
    assert_eq!(source.kind, SourceKind::File);
    assert_eq!(source.base, chemin.display().to_string());
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn sans_emplacement_publie_rien_n_est_resolu() {
    let racine = dossier();
    let port = PortSessions::nouveau(racines(&racine));
    let resolution = attend(port.resolve(SessionHint {
        agent: Some(domain::ids::AgentKind::from(String::from("pi"))),
        cwd: Some(String::from("/projets/atelier")),
        published: None,
        title: None,
    }))
    .unwrap_or_else(|cause| panic!("résolution : {cause:?}"));
    // Aucune preuve de session : une VALEUR absente, pas une panne.
    assert!(resolution.is_none());
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn les_metadonnees_ne_supposent_aucun_modele() {
    let racine = dossier();
    let chemin = racine.join("sessions/wx.jsonl");
    ecrit_session(&chemin);
    let port = PortSessions::nouveau(racines(&racine));
    let metadonnees = attend(port.metadata(source_fichier(&chemin)))
        .unwrap_or_else(|cause| panic!("métadonnées : {cause:?}"));
    assert!(metadonnees.model.is_none(), "aucun modèle supposé");
    assert!(metadonnees.provider.is_none());
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_entete_illisible_ne_fait_pas_echouer_lenrichissement() {
    // ⚠️ D09 : une lecture d'en-tête qui échoue est **ignorée** — le résumé
    // n'est pas perdu, il reste absent. Une erreur d'enrichissement ne doit
    // jamais faire échouer une page lisible.
    let racine = dossier();
    let absent = racine.join("sessions/jamais-ecrit.jsonl");
    let port = PortSessions::nouveau(racines(&racine));
    let metadonnees = attend(port.metadata(source_fichier(&absent)))
        .unwrap_or_else(|cause| panic!("métadonnées : {cause:?}"));
    assert!(metadonnees.model.is_none());
    let _ = std::fs::remove_dir_all(&racine);
}
