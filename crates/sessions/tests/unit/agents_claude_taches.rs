//! Les tâches de fond d'une session Claude : lancements et fins dans la
//! session parente, méta-données et transcriptions des sous-agents — et
//! `inconnu` quand rien ne prouve l'état.

use serde_json::json;
use sessions::agents::claude::taches::{
    GenreTache, LecteurTaches, SILENCE_INCONNU_MS, StatutTache, chemin_transcription, id_valide,
};
use std::io::Write;
use std::path::{Path, PathBuf};

static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn racine() -> PathBuf {
    let unique = format!(
        "sessions-taches-{}-{}",
        std::process::id(),
        COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    );
    let chemin = std::env::temp_dir().join(unique);
    let _ = std::fs::remove_dir_all(&chemin);
    std::fs::create_dir_all(chemin.join("-projet")).unwrap_or_else(|cause| panic!("{cause}"));
    chemin
}

fn ms(iso: &str) -> u64 {
    sessions::metadata::iso_vers_ms(iso)
        .and_then(|ms| u64::try_from(ms).ok())
        .unwrap_or_else(|| panic!("date {iso}"))
}

fn ajoute(chemin: &Path, lignes: &[serde_json::Value]) {
    let mut fichier = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(chemin)
        .unwrap_or_else(|cause| panic!("{cause}"));
    for ligne in lignes {
        writeln!(fichier, "{ligne}").unwrap_or_else(|cause| panic!("{cause}"));
    }
}

fn lancement_agent(id: &str, horodatage: &str) -> serde_json::Value {
    json!({
        "type": "user", "timestamp": horodatage,
        "message": { "role": "user", "content": [{
            "type": "tool_result", "tool_use_id": format!("toolu_{id}"),
            "content": [{ "type": "text", "text": format!("Async agent launched successfully. (internal)\nagentId: {id} (internal ID)") }],
        }]},
        "toolUseResult": { "isAsync": true, "status": "async_launched", "agentId": id, "description": "Audit du flux" },
    })
}

fn appel_bash(id: &str, horodatage: &str, description: &str) -> serde_json::Value {
    json!({
        "type": "assistant", "timestamp": horodatage,
        "message": { "role": "assistant", "content": [{
            "type": "tool_use", "id": id, "name": "Bash",
            "input": { "command": "bun run dev", "description": description, "run_in_background": true },
        }]},
    })
}

fn lancement_bash(appel: &str, id: &str, horodatage: &str) -> serde_json::Value {
    json!({
        "type": "user", "timestamp": horodatage,
        "message": { "role": "user", "content": [{
            "type": "tool_result", "tool_use_id": appel,
            "content": format!("Command running in background with ID: {id}. Output is being written to: /tmp/{id}.output."),
        }]},
        "toolUseResult": { "stdout": "", "backgroundTaskId": id },
    })
}

fn notification(
    id: &str,
    statut: &str,
    resume: &str,
    horodatage: &str,
    attachement: bool,
) -> serde_json::Value {
    let texte = format!(
        "<task-notification>\n<task-id>{id}</task-id>\n<status>{statut}</status>\n<summary>{resume}</summary>\n</task-notification>"
    );
    if attachement {
        json!({
            "type": "attachment", "timestamp": horodatage,
            "attachment": { "type": "queued_command", "prompt": texte, "commandMode": "task-notification", "origin": { "kind": "task-notification" } },
        })
    } else {
        json!({
            "type": "user", "timestamp": horodatage, "origin": { "kind": "task-notification" },
            "message": { "role": "user", "content": texte },
        })
    }
}

fn meta(session: &Path, id: &str, contenu: &serde_json::Value, transcription: Option<&str>) {
    let dossier = session.with_extension("").join("subagents");
    std::fs::create_dir_all(&dossier).unwrap_or_else(|cause| panic!("{cause}"));
    std::fs::write(
        dossier.join(format!("agent-{id}.meta.json")),
        contenu.to_string(),
    )
    .unwrap_or_else(|cause| panic!("{cause}"));
    if let Some(horodatage) = transcription {
        ajoute(
            &dossier.join(format!("agent-{id}.jsonl")),
            &[
                json!({ "type": "user", "isSidechain": true, "timestamp": horodatage,
                      "message": { "role": "user", "content": "consigne" } }),
            ],
        );
    }
}

fn maintenant() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duree| u64::try_from(duree.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}

#[test]
fn un_agent_et_une_commande_suivis_du_lancement_a_la_fin() {
    let racine = racine();
    let session = racine.join("-projet").join("s1.jsonl");
    ajoute(
        &session,
        &[
            lancement_agent("a1b2c3", "2026-10-29T10:00:00.000Z"),
            appel_bash("toolu_b", "2026-10-29T10:01:00.000Z", "Serveur de dev"),
            lancement_bash("toolu_b", "bx9", "2026-10-29T10:01:01.000Z"),
        ],
    );
    meta(
        &session,
        "a1b2c3",
        &json!({ "agentType": "general-purpose", "description": "Audit du flux", "toolUseId": "toolu_a1b2c3", "requestShape": "background" }),
        Some("2026-10-29T10:00:01.000Z"),
    );
    let lecteur = LecteurTaches::nouveau(racine.clone());
    let instant = maintenant();
    let taches = lecteur
        .taches(&session, instant)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(taches.len(), 2, "{taches:?}");
    let agent = taches
        .iter()
        .find(|tache| tache.id == "a1b2c3")
        .unwrap_or_else(|| panic!("agent"));
    assert_eq!(agent.genre, GenreTache::Agent);
    assert_eq!(agent.type_agent.as_deref(), Some("general-purpose"));
    assert_eq!(agent.description.as_deref(), Some("Audit du flux"));
    assert_eq!(agent.debut_ms, Some(ms("2026-10-29T10:00:00.000Z")));
    // La transcription vient d'être écrite : activité récente → en cours.
    assert_eq!(agent.statut, StatutTache::EnCours);
    assert!(agent.transcription);
    let commande = taches
        .iter()
        .find(|tache| tache.id == "bx9")
        .unwrap_or_else(|| panic!("commande"));
    assert_eq!(commande.genre, GenreTache::Commande);
    assert_eq!(commande.description.as_deref(), Some("Serveur de dev"));
    // Lancée il y a longtemps, sans fin écrite ni activité : inconnu.
    assert_eq!(commande.statut, StatutTache::Inconnu);

    // Les fins arrivent (les deux canaux) : la lecture INCRÉMENTALE les voit.
    ajoute(
        &session,
        &[
            notification(
                "bx9",
                "failed",
                "Background command \"Serveur de dev\" failed with exit code 1",
                "2026-10-29T10:05:00.000Z",
                false,
            ),
            notification(
                "a1b2c3",
                "completed",
                "Agent \"Audit du flux\" finished",
                "2026-10-29T10:06:00.000Z",
                true,
            ),
        ],
    );
    let taches = lecteur
        .taches(&session, ms("2026-10-29T10:06:30.000Z"))
        .unwrap_or_else(|cause| panic!("{cause}"));
    let commande = taches
        .iter()
        .find(|tache| tache.id == "bx9")
        .unwrap_or_else(|| panic!("commande"));
    assert_eq!(commande.statut, StatutTache::Echouee);
    assert_eq!(commande.fin_ms, Some(ms("2026-10-29T10:05:00.000Z")));
    assert!(
        commande
            .resume
            .as_deref()
            .is_some_and(|resume| resume.contains("exit code 1"))
    );
    let agent = taches
        .iter()
        .find(|tache| tache.id == "a1b2c3")
        .unwrap_or_else(|| panic!("agent"));
    // La transcription a été écrite APRÈS la notification (le fichier du
    // test date de maintenant) : le sous-agent a été relancé — sans fin
    // nouvelle, l'état revient à l'activité, jamais « terminé » par défaut.
    assert_ne!(agent.statut, StatutTache::Terminee);

    // Dernière écriture AVANT la notification : terminé, à l'heure écrite.
    pose_mtime(&session, "a1b2c3", "2026-10-29T10:05:50.000Z");
    let taches = lecteur
        .taches(&session, ms("2026-10-29T10:06:30.000Z"))
        .unwrap_or_else(|cause| panic!("{cause}"));
    let agent = taches
        .iter()
        .find(|tache| tache.id == "a1b2c3")
        .unwrap_or_else(|| panic!("agent"));
    assert_eq!(agent.statut, StatutTache::Terminee);
    assert_eq!(agent.fin_ms, Some(ms("2026-10-29T10:06:00.000Z")));
    assert_eq!(
        agent.resume.as_deref(),
        Some("Agent \"Audit du flux\" finished")
    );
}

fn pose_mtime(session: &Path, id: &str, iso: &str) {
    let chemin = session
        .with_extension("")
        .join("subagents")
        .join(format!("agent-{id}.jsonl"));
    let fichier = std::fs::OpenOptions::new()
        .write(true)
        .open(chemin)
        .unwrap_or_else(|cause| panic!("{cause}"));
    fichier
        .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms(iso)))
        .unwrap_or_else(|cause| panic!("{cause}"));
}

#[test]
fn sans_fin_ni_activite_recente_l_etat_est_inconnu() {
    let racine = racine();
    let session = racine.join("-projet").join("s2.jsonl");
    ajoute(
        &session,
        &[lancement_agent("ab12", "2026-10-29T10:00:00.000Z")],
    );
    meta(
        &session,
        "ab12",
        &json!({ "agentType": "fork", "description": "Long", "requestShape": "background" }),
        Some("2026-10-29T10:00:01.000Z"),
    );
    let lecteur = LecteurTaches::nouveau(racine.clone());
    let plus_tard = maintenant() + SILENCE_INCONNU_MS + 60_000;
    let taches = lecteur
        .taches(&session, plus_tard)
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(taches[0].statut, StatutTache::Inconnu);
}

#[test]
fn le_drapeau_finished_et_le_premier_plan() {
    let racine = racine();
    let session = racine.join("-projet").join("s3.jsonl");
    ajoute(
        &session,
        &[json!({ "type": "user", "message": { "role": "user", "content": "go" } })],
    );
    meta(
        &session,
        "fini1",
        &json!({ "agentType": "fork", "description": "Fini", "requestShape": "background", "finished": true }),
        Some("2026-10-29T10:00:01.000Z"),
    );
    // Un sous-agent au premier plan n'est pas une tâche de fond.
    meta(
        &session,
        "avant1",
        &json!({ "agentType": "general-purpose", "description": "Premier plan" }),
        None,
    );
    let lecteur = LecteurTaches::nouveau(racine.clone());
    let taches = lecteur
        .taches(&session, maintenant())
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(taches.len(), 1, "{taches:?}");
    assert_eq!(taches[0].id, "fini1");
    assert_eq!(taches[0].statut, StatutTache::Terminee);
}

#[test]
fn un_fichier_remplace_est_relu_depuis_le_debut() {
    let racine = racine();
    let session = racine.join("-projet").join("s4.jsonl");
    ajoute(
        &session,
        &[
            appel_bash("toolu_c", "2026-10-29T10:00:00.000Z", "Ancien"),
            lancement_bash("toolu_c", "old1", "2026-10-29T10:00:01.000Z"),
        ],
    );
    let lecteur = LecteurTaches::nouveau(racine.clone());
    assert_eq!(
        lecteur.taches(&session, maintenant()).map(|t| t.len()),
        Ok(1)
    );
    std::fs::remove_file(&session).unwrap_or_else(|cause| panic!("{cause}"));
    ajoute(
        &session,
        &[json!({ "type": "user", "message": { "role": "user", "content": "neuf" } })],
    );
    assert_eq!(
        lecteur.taches(&session, maintenant()).map(|t| t.len()),
        Ok(0)
    );
}

#[test]
fn la_transcription_reste_sous_la_racine() {
    let racine = racine();
    let session = racine.join("-projet").join("s5.jsonl");
    ajoute(
        &session,
        &[json!({ "type": "user", "message": { "role": "user", "content": "go" } })],
    );
    meta(
        &session,
        "abc",
        &json!({ "description": "x", "requestShape": "background" }),
        Some("2026-10-29T10:00:01.000Z"),
    );
    let lecteur = LecteurTaches::nouveau(racine.clone());
    assert!(lecteur.transcription(&session, "abc").is_some());
    // Un identifiant qui serait un morceau de chemin est refusé AVANT tout
    // accès disque.
    for mauvais in ["../s5", "a/b", "", "..", "a.b"] {
        assert!(!id_valide(mauvais), "{mauvais}");
        assert!(chemin_transcription(&session, mauvais).is_none());
        assert!(lecteur.transcription(&session, mauvais).is_none());
    }
    // Absente : rien.
    assert!(lecteur.transcription(&session, "absent").is_none());
    // Hors racine : refusé avec sa cause.
    let ailleurs = std::env::temp_dir().join(format!("hors-racine-{}.jsonl", std::process::id()));
    ajoute(&ailleurs, &[json!({ "type": "user" })]);
    let refus = lecteur.taches(&ailleurs, maintenant());
    assert!(
        refus.as_ref().is_err_and(|cause| cause.contains("outside")),
        "{refus:?}"
    );
    let _ = std::fs::remove_file(&ailleurs);
}
