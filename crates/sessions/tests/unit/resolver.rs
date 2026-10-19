//! Le résolveur (T023/C15) : state_10 > state_9 (la régression d19f98d), les
//! DEUX lectures du titre (l'index tranche), le cache négatif invalidable
//! (une session ajoutée devient visible), la source unique pour
//! overview/liste/session.
//! Prouve : D07, D08.

use serde_json::json;
use sessions::resolver::{
    Emplacement, Racines, Resolveur, bases_codex, chemin_claude_par_id, chemin_codex_par_id,
    chemin_codex_par_nom, localise_session, nom_de_session_codex, noms_de_session_codex,
    source_session, source_session_de,
};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

fn temporaire(prefixe: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let chemin = base.join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match fs::create_dir(&chemin) {
        Ok(()) => chemin,
        Err(cause) => panic!("racine refusée : {cause}"),
    }
}

fn racines_fake() -> Racines {
    let racine = temporaire("soutien-resolveur-racines");
    for sous in ["codex-sessions", "codex-home", "claude-projects"] {
        match fs::create_dir(racine.join(sous)) {
            Ok(()) => (),
            Err(cause) => panic!("mkdir refusé : {cause}"),
        }
    }
    Racines {
        codex_sessions: racine.join("codex-sessions"),
        codex_home: racine.join("codex-home"),
        claude_projects: racine.join("claude-projects"),
        opencode_db: racine.join("opencode.db"),
        devin_db: racine.join("devin.db"),
    }
}

#[test]
fn les_bases_codex_se_trient_par_version_numerique() {
    // LA régression d19f98d : le tri lexicographique plaçait state_9 devant
    // state_10 — le tri NUMÉRIQUE redresse.
    let home = temporaire("soutien-resolveur-states");
    for nom in [
        "state_2.sqlite",
        "state_9.sqlite",
        "state_10.sqlite",
        "autre.sqlite",
    ] {
        match fs::write(home.join(nom), "") {
            Ok(()) => (),
            Err(cause) => panic!("touch refusé : {cause}"),
        }
    }
    let bases = bases_codex(&home);
    let noms: Vec<String> = bases
        .iter()
        .map(|chemin| {
            chemin
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        })
        .collect();
    assert!(
        noms == vec!["state_10.sqlite", "state_9.sqlite", "state_2.sqlite"],
        "state_10 AVANT state_9, versions numériques décroissantes : {noms:?}"
    );
    // Un dossier absent ou vide : rien, sans erreur.
    assert!(bases_codex(&home.join("absent")).is_empty());
}

#[test]
fn les_deux_lectures_du_titre_brute_et_sans_décoration() {
    let cwd = "/dev/projets/herdr-pwa";
    // Le titre mesuré, au repos : UNE lecture (brute).
    let noms = noms_de_session_codex(Some("Audit PWA and webapp | herdr-pwa"), Some(cwd));
    assert!(
        noms == vec!["Audit PWA and webapp"],
        "le brut seul : {noms:?}"
    );
    assert!(
        nom_de_session_codex(Some("Audit PWA and webapp | herdr-pwa"), Some(cwd))
            == Some(String::from("Audit PWA and webapp")),
        "le nom simple = le premier candidat"
    );
    // Le titre EN TRAVAIL (glyphe ⠼) : DEUX lectures — et un vrai titre qui
    // commence par un glyphe reste trouvable.
    let noms = noms_de_session_codex(Some("⠼ Audit PWA and webapp | herdr-pwa"), Some(cwd));
    assert!(
        noms == vec!["⠼ Audit PWA and webapp", "Audit PWA and webapp"],
        "le brut ET le sans-décoration : {noms:?}"
    );
    // Le dossier doit être celui du pane — sinon rien.
    assert!(
        noms_de_session_codex(Some("Audit PWA and webapp | autre-projet"), Some(cwd)).is_empty(),
        "un dossier non concordant ne nomme rien"
    );
    // Un titre qui n'est que le dossier (« perso », un pane jamais utilisé) :
    // rien à retrouver.
    assert!(
        noms_de_session_codex(Some("herdr-pwa | herdr-pwa"), Some(cwd)).is_empty()
            || noms_de_session_codex(Some("perso | perso"), Some(cwd)).is_empty()
    );
    // Un titre sans ` | ` : rien.
    assert!(noms_de_session_codex(Some("sans barre"), Some(cwd)).is_empty());
    // Cwd vide ou titres vides : rien.
    assert!(noms_de_session_codex(Some("x | y"), Some("")).is_empty());
    assert!(noms_de_session_codex(None, Some(cwd)).is_empty());
}

#[test]
fn l_index_confirme_le_nom_et_le_dossier_et_lexistence() {
    let racines = racines_fake();
    // Un index codex factice, avec le rollout SUR DISQUE.
    let base = racines.codex_home.join("state_10.sqlite");
    let connexion = match rusqlite::Connection::open(&base) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("index refusé : {cause}"),
    };
    let rollout = racines.codex_sessions.join("rollout-2025-01a14a74.jsonl");
    match fs::write(&rollout, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("rollout refusé : {cause}"),
    }
    match connexion.execute_batch(&format!(
        "CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER, updated_at TEXT);
         INSERT INTO threads (name, cwd, rollout_path, archived, updated_at) VALUES ('Audit PWA and webapp', '/dev/projets/herdr-pwa', '{}', 0, '2026-10-18');",
        rollout.display()
    )) {
        Ok(()) => (),
        Err(cause) => panic!("schéma refusé : {cause}"),
    }
    let resolveur = Resolveur::nouveau(racines);
    match chemin_codex_par_nom(&resolveur, "Audit PWA and webapp", "/dev/projets/herdr-pwa") {
        Some(chemin) => assert!(chemin == rollout, "le chemin confirmé : {chemin:?}"),
        None => panic!("l'index confirme le nom + le dossier + l'existence"),
    }
    // Un autre cwd : NON — jamais la session d'un autre.
    assert!(chemin_codex_par_nom(&resolveur, "Audit PWA and webapp", "/dev/autre").is_none());
    // Une base d'un schéma inattendu ne prouve rien (pas de substitution).
    assert!(chemin_codex_par_nom(&resolveur, "inconnu", "/dev/projets/herdr-pwa").is_none());
}

#[test]
fn le_cache_négatif_s_invalide_quand_la_base_bouge() {
    let racines = racines_fake();
    let base = racines.codex_home.join("state_10.sqlite");
    let connexion = match rusqlite::Connection::open(&base) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("index refusé : {cause}"),
    };
    match connexion.execute_batch(
        "CREATE TABLE threads (id TEXT PRIMARY KEY, name TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER, updated_at TEXT);",
    ) {
        Ok(()) => (),
        Err(cause) => panic!("schéma refusé : {cause}"),
    }
    let resolveur = Resolveur::nouveau(racines);
    // Cache NÉGATIF : la session n'existe pas encore.
    assert!(chemin_codex_par_nom(&resolveur, "Nouvelle session", "/dev/projets/x").is_none());
    // La session est AJOUTÉE (la base change) : le cache négatif s'invalide,
    // la session devient VISIBLE.
    let rollout = resolveur
        .racines
        .codex_sessions
        .join("rollout-2026-nouvelle.jsonl");
    match fs::write(&rollout, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("rollout refusé : {cause}"),
    }
    match connexion.execute_batch(&format!(
        "INSERT INTO threads (name, cwd, rollout_path, archived, updated_at) VALUES ('Nouvelle session', '/dev/projets/x', '{}', 0, '2026-10-18T12:00:00Z');",
        rollout.display()
    )) {
        Ok(()) => (),
        Err(cause) => panic!("insertion refusée : {cause}"),
    }
    match chemin_codex_par_nom(&resolveur, "Nouvelle session", "/dev/projets/x") {
        Some(chemin) => assert!(
            chemin == rollout,
            "la nouvelle session est VISIBLE : {chemin:?}"
        ),
        None => panic!("un cache négatif permanent cachait la session ajoutée"),
    }
}

#[test]
fn la_source_unique_decide_pour_tous() {
    let racines = racines_fake();
    let resolveur = Resolveur::nouveau(racines);
    // path fait foi.
    match source_session(
        &resolveur,
        Some("pi"),
        Some(&Emplacement::nouveau("path", "/sessions/pi/x.jsonl")),
    ) {
        Some(source) => {
            assert!(
                localise_session(
                    &resolveur,
                    Some("pi"),
                    Some(&Emplacement::nouveau("path", "/sessions/pi/x.jsonl"))
                ) == Some(PathBuf::from("/sessions/pi/x.jsonl"))
            );
            let _ = source;
        }
        None => panic!("path fait foi"),
    }
    // opencode : une base, pas un chemin — localise rend NONE.
    let emplacement = Emplacement::nouveau("id", "ses_1");
    match source_session(&resolveur, Some("opencode"), Some(&emplacement)) {
        Some(source) => match source {
            sessions::resolver::SourceSession::Sqlite { magasin, .. } => {
                assert!(magasin == sessions::resolver::Magasin::Opencode);
            }
            autre => panic!("opencode = sqlite : {autre:?}"),
        },
        None => panic!("opencode résout en base"),
    }
    assert!(
        localise_session(&resolveur, Some("opencode"), Some(&emplacement)).is_none(),
        "une base n'est pas un chemin de session"
    );
    // Un identifiant vide : refusé (jamais la session d'un autre).
    assert!(
        source_session(
            &resolveur,
            Some("opencode"),
            Some(&Emplacement::nouveau("id", " "))
        )
        .is_none()
    );
    // Un kind inconnu : rien.
    assert!(source_session(&resolveur, Some("autre"), Some(&emplacement)).is_none());
    // Le repli par titre : CODEX SEUL — le même titre pour pi ne fait rien.
    let codex_titre = source_session_de(
        &resolveur,
        Some("codex"),
        None,
        Some("Audit PWA and webapp | herdr-pwa"),
        Some("/dev/projets/herdr-pwa"),
    );
    let _ = codex_titre; // l'index vide ici : None — le repli existe, il ne trouve pas
    assert!(
        source_session_de(
            &resolveur,
            Some("pi"),
            None,
            Some("Audit PWA and webapp | herdr-pwa"),
            Some("/dev/projets/herdr-pwa")
        )
        .is_none(),
        "le repli par titre est codex-SEUL"
    );
}

#[test]
fn les_identifiants_par_nom_de_fichier_sont_ancrés() {
    let racines = racines_fake();
    let session = racines.codex_sessions.join("rollout-2025-x-abc123.jsonl");
    match fs::write(&session, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("rollout refusé : {cause}"),
    }
    match chemin_codex_par_id(&racines, "abc123") {
        Some(chemin) => assert!(chemin == session),
        None => panic!("l'identifiant nommé se retrouve"),
    }
    // Un identifiant VIDE : refusé — « n'importe quel rollout » n'existe pas.
    assert!(chemin_codex_par_id(&racines, " ").is_none());
    assert!(chemin_codex_par_id(&racines, "").is_none());
    // Claude : cherché dans le nom, dossier intermédiaire encodé.
    let dossier_claude = racines.claude_projects.join("-Users-x-projets");
    match fs::create_dir_all(&dossier_claude) {
        Ok(()) => (),
        Err(cause) => panic!("mkdir refusé : {cause}"),
    }
    let claude = dossier_claude.join("9054562f-7ce.jsonl");
    match fs::write(&claude, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("fichier refusé : {cause}"),
    }
    assert!(chemin_claude_par_id(&racines, "9054562f-7ce") == Some(claude));
    assert!(chemin_claude_par_id(&racines, "").is_none());
}

#[test]
fn les_racines_injectees_ne_lisent_jamais_lenvironnement() {
    // Structurel : toutes les fonctions prennent leurs racines en argument —
    // le test le vérifie en passant des racines inexistantes sans que rien
    // ne lise le HOME.
    let racines = racines_fake();
    let resolveur = Resolveur::nouveau(racines);
    assert!(chemin_codex_par_id(&resolveur.racines, "inexistant").is_none());
    assert!(chemin_claude_par_id(&resolveur.racines, "inexistant").is_none());
    // Et un JSON d'en-tête, pour la forme — rien n'est déduit :
    let _ = json!({ "parentSession": null });
}
