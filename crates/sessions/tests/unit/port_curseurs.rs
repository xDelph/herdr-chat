//! Le port de sessions face aux curseurs refusés, aux fichiers remplacés ou
//! tronqués, aux lignes géantes, aux sessions SQLite inconnues et à la
//! réserve d'ouvriers. Fixtures temporaires uniquement — aucune session de
//! l'utilisateur n'est lue.

use domain::errors::Nature;
use domain::ports::SessionPort;
use domain::session::{
    ResolvedSource, SessionEntry, SessionPage, SessionPageOutcome, SessionPageRequest, SourceKind,
};
use sessions::port::{PortSessions, empreinte_de_source};
use sessions::resolver::Racines;
use std::io::Write;
use std::path::{Path, PathBuf};

static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn dossier() -> PathBuf {
    let chemin = std::env::temp_dir().join(format!(
        "sessions-curseurs-{}-{}",
        std::process::id(),
        COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&chemin);
    std::fs::create_dir_all(chemin.join("sessions"))
        .unwrap_or_else(|cause| panic!("dossier : {cause}"));
    chemin
}

fn racines(racine: &Path) -> Racines {
    Racines {
        pi_sessions: racine.to_path_buf(),
        claude_projects: racine.join("claude"),
        codex_home: racine.join("codex-home"),
        codex_sessions: racine.join("codex-sessions"),
        devin_db: racine.join("devin.db"),
        opencode_db: racine.join("opencode.db"),
    }
}

fn ligne(n: usize) -> String {
    format!(r#"{{"type":"message","id":"m{n}","message":{{"role":"user","content":"texte {n}"}}}}"#)
}

fn ecrit_lignes(chemin: &Path, de: usize, a: usize) {
    let mut contenu = String::new();
    for n in de..a {
        contenu.push_str(&ligne(n));
        contenu.push('\n');
    }
    std::fs::write(chemin, contenu).unwrap_or_else(|cause| panic!("écriture : {cause}"));
}

fn ajoute(chemin: &Path, texte: &str) {
    let mut fichier = std::fs::OpenOptions::new()
        .append(true)
        .open(chemin)
        .unwrap_or_else(|cause| panic!("append : {cause}"));
    fichier
        .write_all(texte.as_bytes())
        .unwrap_or_else(|cause| panic!("append : {cause}"));
}

fn source_fichier(chemin: &Path) -> ResolvedSource {
    ResolvedSource {
        kind: SourceKind::File,
        base: chemin.display().to_string(),
        session_id: None,
        family: Some(domain::ids::AgentKind::from(String::from("pi"))),
    }
}

fn source_opencode(base: &Path, session: &str) -> ResolvedSource {
    ResolvedSource {
        kind: SourceKind::Sqlite,
        base: base.display().to_string(),
        session_id: Some(domain::ids::SessionId::from(String::from(session))),
        family: Some(domain::ids::AgentKind::from(String::from("opencode"))),
    }
}

fn demande(
    source: ResolvedSource,
    cursor: Option<String>,
    before: Option<String>,
    limit: u32,
) -> SessionPageRequest {
    SessionPageRequest {
        source,
        cursor,
        previous_cursor: before,
        limit,
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

fn page_de(issue: Result<SessionPageOutcome, domain::errors::ErreurDomaine>) -> SessionPage {
    match issue {
        Ok(SessionPageOutcome::Page(page) | SessionPageOutcome::Vide(page)) => page,
        autre => panic!("une page attendue : {autre:?}"),
    }
}

fn ids(entrees: &[SessionEntry]) -> Vec<String> {
    entrees
        .iter()
        .filter_map(|entree| entree.id.clone())
        .collect()
}

fn refus(issue: Result<SessionPageOutcome, domain::errors::ErreurDomaine>, attendu: &str) {
    match issue {
        Err(erreur) => {
            assert_eq!(erreur.nature, Nature::InvalidInput, "{erreur:?}");
            assert_eq!(erreur.detail, attendu);
        }
        Ok(issue) => panic!("refus « {attendu} » attendu : {issue:?}"),
    }
}

/// Une base opencode factice : deux sessions, deux messages chacune.
fn base_opencode(racine: &Path) -> PathBuf {
    let chemin = racine.join("opencode.db");
    let connexion =
        rusqlite::Connection::open(&chemin).unwrap_or_else(|cause| panic!("base : {cause}"));
    connexion
        .execute_batch(
            "CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
             CREATE TABLE session_message (
                id TEXT NOT NULL, session_id TEXT NOT NULL, type TEXT NOT NULL,
                seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
             INSERT INTO session_v2 (id) VALUES ('ses_a'), ('ses_b'), ('ses_vide');
             INSERT INTO session_message (id, session_id, type, seq, time_created, data) VALUES
               ('a1', 'ses_a', 'user', 1, 1750000000000, '{\"text\": \"A un\"}'),
               ('a2', 'ses_a', 'user', 2, 1750000001000, '{\"text\": \"A deux\"}'),
               ('b1', 'ses_b', 'user', 3, 1750000002000, '{\"text\": \"B un\"}'),
               ('b2', 'ses_b', 'user', 4, 1750000003000, '{\"text\": \"B deux\"}');",
        )
        .unwrap_or_else(|cause| panic!("schéma : {cause}"));
    chemin
}

#[test]
fn cursor_et_before_ensemble_sont_refuses() {
    let racine = dossier();
    let chemin = racine.join("sessions/s.jsonl");
    ecrit_lignes(&chemin, 0, 3);
    let port = PortSessions::nouveau(racines(&racine));
    let premiere = page_de(attend(port.page(demande(
        source_fichier(&chemin),
        None,
        None,
        4096,
    ))));
    // Régression : `valide_paire` n'était jamais appelée — les deux
    // ensemble lisaient l'historique en ignorant `cursor`.
    refus(
        attend(port.page(demande(
            source_fichier(&chemin),
            premiere.cursor.clone(),
            premiere.previous_cursor.clone(),
            4096,
        ))),
        "invalid previous-page cursor",
    );
    refus(
        attend(port.page(demande(
            source_fichier(&chemin),
            None,
            Some(String::from("pas-un-curseur")),
            4096,
        ))),
        "invalid previous-page cursor",
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_curseur_sqlite_illisible_ou_d_une_autre_session_est_refuse() {
    let racine = dossier();
    let base = base_opencode(&racine);
    let port = PortSessions::nouveau(racines(&racine));
    // La première page de B : son curseur est celui de B.
    let page_b = page_de(attend(port.page(demande(
        source_opencode(&base, "ses_b"),
        None,
        None,
        4096,
    ))));
    assert_eq!(ids(&page_b.entries), vec!["opencode:b1", "opencode:b2"]);
    // Régression : le curseur de B présenté pour A rendait la dernière page
    // de A en 200 (`.ok()` avalait le refus) — C12 cassé dans le flux.
    refus(
        attend(port.page(demande(
            source_opencode(&base, "ses_a"),
            page_b.cursor.clone(),
            None,
            4096,
        ))),
        "invalid cursor",
    );
    refus(
        attend(port.page(demande(
            source_opencode(&base, "ses_a"),
            Some(String::from("hc2:%%%")),
            None,
            4096,
        ))),
        "invalid cursor",
    );
    refus(
        attend(port.page(demande(
            source_opencode(&base, "ses_a"),
            None,
            page_b.previous_cursor.clone(),
            4096,
        ))),
        "invalid previous-page cursor",
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_session_sqlite_inconnue_est_absente_pas_vide() {
    let racine = dossier();
    let base = base_opencode(&racine);
    let port = PortSessions::nouveau(racines(&racine));
    // Régression : `session_existe` n'était jamais appelée — un identifiant
    // que la base ignore s'affichait comme une conversation vide.
    match attend(port.page(demande(
        source_opencode(&base, "ses_inconnue"),
        None,
        None,
        4096,
    ))) {
        Ok(SessionPageOutcome::Absente(page)) => {
            assert!(page.entries.is_empty());
            assert!(page.previous_cursor.is_none());
        }
        autre => panic!("absente attendue : {autre:?}"),
    }
    // Une session connue sans message reste `vide` (bénin, distinct).
    match attend(port.page(demande(
        source_opencode(&base, "ses_vide"),
        None,
        None,
        4096,
    ))) {
        Ok(SessionPageOutcome::Vide(_)) => {}
        autre => panic!("vide attendue : {autre:?}"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_ouvrier_sqlite_par_base_pas_par_page() {
    let racine = dossier();
    let base = base_opencode(&racine);
    let port = PortSessions::nouveau(racines(&racine));
    assert_eq!(port.ouvriers_sqlite(), 0);
    for session in ["ses_a", "ses_b", "ses_a", "ses_b"] {
        let _ = page_de(attend(port.page(demande(
            source_opencode(&base, session),
            None,
            None,
            4096,
        ))));
    }
    // Régression : chaque page ouvrait sa connexion et lançait son fil.
    assert_eq!(port.ouvriers_sqlite(), 1, "un ouvrier partagé par base");
    // Une base remplacée (autre inode) : l'ouvrier est recréé, jamais
    // l'ancien fichier lu pour toujours.
    let remplacante = racine.join("remplacante.db");
    {
        let connexion = rusqlite::Connection::open(&remplacante)
            .unwrap_or_else(|cause| panic!("base : {cause}"));
        connexion
            .execute_batch(
                "CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
                 CREATE TABLE session_message (
                    id TEXT NOT NULL, session_id TEXT NOT NULL, type TEXT NOT NULL,
                    seq INTEGER NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
                 INSERT INTO session_v2 (id) VALUES ('ses_a');
                 INSERT INTO session_message (id, session_id, type, seq, time_created, data) VALUES
                   ('z1', 'ses_a', 'user', 1, 1750000000000, '{\"text\": \"nouvelle\"}');",
            )
            .unwrap_or_else(|cause| panic!("schéma : {cause}"));
    }
    std::fs::rename(&remplacante, &base).unwrap_or_else(|cause| panic!("rename : {cause}"));
    let page = page_de(attend(port.page(demande(
        source_opencode(&base, "ses_a"),
        None,
        None,
        4096,
    ))));
    assert_eq!(
        ids(&page.entries),
        vec!["opencode:z1"],
        "la base remplacée est lue"
    );
    assert_eq!(port.ouvriers_sqlite(), 1);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_fichier_remplace_au_meme_chemin_repart_de_sa_queue() {
    let racine = dossier();
    let chemin = racine.join("sessions/s.jsonl");
    ecrit_lignes(&chemin, 0, 4);
    let port = PortSessions::nouveau(racines(&racine));
    let premiere = page_de(attend(port.page(demande(
        source_fichier(&chemin),
        None,
        None,
        4096,
    ))));
    assert_eq!(ids(&premiere.entries), vec!["m0", "m1", "m2", "m3"]);
    // Un autre fichier (autre inode) au même chemin, PLUS LONG : sans
    // identité dans le curseur, la lecture repartait de l'ancien offset —
    // au milieu d'une autre session, sans le dire.
    let remplacant = racine.join("sessions/remplacant.jsonl");
    ecrit_lignes(&remplacant, 100, 110);
    std::fs::rename(&remplacant, &chemin).unwrap_or_else(|cause| panic!("rename : {cause}"));
    let suite = page_de(attend(port.page(demande(
        source_fichier(&chemin),
        premiere.cursor.clone(),
        None,
        4096,
    ))));
    assert!(suite.reset, "une rotation prouvée est dite");
    assert_eq!(
        ids(&suite.entries).first().map(String::as_str),
        Some("m100"),
        "la queue du NOUVEAU fichier, depuis une ligne entière"
    );
    // L'historique demandé avec un curseur de l'ancien fichier : 409.
    match attend(port.page(demande(
        source_fichier(&chemin),
        None,
        premiere.previous_cursor.clone(),
        4096,
    ))) {
        Err(erreur) => assert_eq!(erreur.nature, Nature::SourceInvalid, "{erreur:?}"),
        Ok(issue) => panic!("un curseur d'historique périmé est refusé : {issue:?}"),
    }
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_troncature_repart_de_la_queue_pas_du_debut() {
    let racine = dossier();
    let chemin = racine.join("sessions/s.jsonl");
    ecrit_lignes(&chemin, 0, 40);
    let port = PortSessions::nouveau(racines(&racine));
    let fenetre = u32::try_from(ligne(0).len() * 3).unwrap_or(256);
    let premiere = page_de(attend(port.page(demande(
        source_fichier(&chemin),
        None,
        None,
        fenetre,
    ))));
    // Le même fichier (même inode), réécrit plus court.
    let mut contenu = String::new();
    for n in 200..230 {
        contenu.push_str(&ligne(n));
        contenu.push('\n');
    }
    std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&chemin)
        .and_then(|mut fichier| fichier.write_all(contenu.as_bytes()))
        .unwrap_or_else(|cause| panic!("troncature : {cause}"));
    let suite = page_de(attend(port.page(demande(
        source_fichier(&chemin),
        premiere.cursor.clone(),
        None,
        fenetre,
    ))));
    assert!(suite.reset, "la troncature est dite");
    // Régression : la lecture repartait de l'octet 0 (tout le fichier poussé).
    assert!(
        !ids(&suite.entries).contains(&String::from("m200")),
        "la queue, pas le début : {:?}",
        ids(&suite.entries)
    );
    assert_eq!(ids(&suite.entries).last().map(String::as_str), Some("m229"));
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn un_ancien_curseur_sans_identite_continue_comme_avant() {
    let racine = dossier();
    let chemin = racine.join("sessions/s.jsonl");
    ecrit_lignes(&chemin, 0, 2);
    let port = PortSessions::nouveau(racines(&racine));
    let source = source_fichier(&chemin);
    let taille = std::fs::metadata(&chemin)
        .map(|meta| meta.len())
        .unwrap_or(0);
    // Un `hc2:` émis avant l'identité : source/session/position seulement.
    let ancien = sessions::cursor::encode(
        &empreinte_de_source(&source),
        &source.base,
        1,
        i64::try_from(taille).unwrap_or(0),
    );
    ajoute(&chemin, &format!("{}\n", ligne(2)));
    let suite = page_de(attend(port.page(demande(source, Some(ancien), None, 4096))));
    assert!(!suite.reset);
    assert_eq!(ids(&suite.entries), vec!["m2"]);
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_ligne_geante_est_ignoree_et_le_reste_reste_lisible() {
    let racine = dossier();
    let chemin = racine.join("sessions/s.jsonl");
    ecrit_lignes(&chemin, 0, 1);
    let port = PortSessions::nouveau(racines(&racine));
    let premiere = page_de(attend(port.page(demande(
        source_fichier(&chemin),
        None,
        None,
        4096,
    ))));
    let geante = format!(
        "{{\"type\":\"message\",\"gros\":\"{}\"}}\n",
        "g".repeat(17 * 1024 * 1024)
    );
    ajoute(&chemin, &geante);
    ajoute(&chemin, &format!("{}\n", ligne(1)));
    // Régression : la page était refusée (422) pour toujours, le flux
    // envoyait `gone`. La ligne est ignorée, DITE, et franchie.
    let mut entrees = Vec::new();
    let mut curseur = premiere.cursor.clone();
    for _ in 0..4 {
        let page = page_de(attend(port.page(demande(
            source_fichier(&chemin),
            curseur.clone(),
            None,
            4096,
        ))));
        curseur = page.cursor.clone();
        let fini = page.rattrape;
        entrees.extend(page.entries);
        if fini {
            break;
        }
    }
    assert_eq!(entrees.len(), 2, "{entrees:?}");
    assert_eq!(entrees[0].kind, "unknown");
    assert!(
        entrees[0].raw.contains("ligne trop grande") && entrees[0].raw.len() < 1024,
        "{}",
        entrees[0].raw
    );
    assert_eq!(entrees[1].id.as_deref(), Some("m1"), "la suite est lisible");
    let _ = std::fs::remove_dir_all(&racine);
}
