//! Le profil Devin (T022) : le curseur par `row_id` (jamais `node_id`), le
//! `system` majoritaire écarté, la réflexion en clair, le garde-fou
//! `tool_calls` (forme non mesurée → rien d'inventé).

use serde_json::json;
use sessions::agents::devin::{
    ProfilDevin,
    moteur::{lire_depuis, lire_derniere, session_existe},
};
use sessions::families::codecs::devin::ligne_devin_vers_pi;
use sessions::pipeline::{LigneNormalisee, Registre};

/// La base factice — le schéma EXACT mesuré (T022) : sessions + message_nodes
/// avec node_id/parent_node_id (la forêt) et row_id (le curseur).
fn base_devin(prefixe: &str) -> std::path::PathBuf {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        std::sync::atomic::AtomicU32::new(0).fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    ));
    match std::fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let chemin = racine.join("sessions.db");
    let connexion = match rusqlite::Connection::open(&chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("création refusée : {cause}"),
    };
    match connexion.execute_batch(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
         CREATE TABLE message_nodes (
            row_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            node_id INTEGER NOT NULL,
            parent_node_id INTEGER,
            chat_message TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            metadata TEXT,
            UNIQUE(session_id, node_id));
         INSERT INTO sessions (id, title) VALUES ('burly-stop', 'la session devin');
         INSERT INTO message_nodes (session_id, node_id, parent_node_id, chat_message, created_at)
            VALUES ('burly-stop', 1, NULL, '{\"role\": \"system\", \"content\": \"<system_info>contexte injecté</system_info>\"}', 1750000000000),
                   ('burly-stop', 2, 1, '{\"role\": \"user\", \"content\": \"la demande réelle\", \"metadata\": {\"created_at\": \"2026-06-14T17:18:50.653358Z\"}}', 1750000005000),
                   ('burly-stop', 3, 1, '{\"role\": \"assistant\", \"content\": \"I am powered by SWE-1.6.\", \"thinking\": {\"thinking\": \"réflexion en clair\"}, \"tool_calls\": [], \"metadata\": {\"created_at\": \"2026-06-14T17:19:00.000000Z\", \"generation_model\": \"swe-1-6-slow\"}}', 1750000010000);",
    ) {
        Ok(()) => (),
        Err(cause) => panic!("schéma refusé : {cause}"),
    }
    chemin
}

fn ouvrier_de(chemin: &std::path::Path) -> sessions::storage::sqlite::worker::Ouvrier {
    match sessions::storage::sqlite::worker::Ouvrier::nouveau(chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier refusé : {cause}"),
    }
}

#[test]
fn les_requetes_passent_par_l_ouvrier_et_le_system_est_écarré() {
    let chemin = base_devin("soutien-devin-requetes");
    let ouvrier = ouvrier_de(&chemin);
    match session_existe(&ouvrier, "burly-stop") {
        Ok(true) => (),
        autre => panic!("la session du corpus existe : {autre:?}"),
    }
    match session_existe(&ouvrier, "tidy-rook") {
        Ok(false) => (),
        autre => panic!("l'identifiant inconnu ne passe PAS : {autre:?}"),
    }
    let page = match lire_derniere(&ouvrier, "burly-stop", 10) {
        Ok(page) => page,
        Err(cause) => panic!("dernière page refusée : {cause}"),
    };
    // Les TROIS lignes sont lues (le curseur avance sur tout)…
    assert!(
        page.entrees.len() == 3,
        "trois lignes lues : {}",
        page.entrees.len()
    );
    // …mais la ligne `system` (majoritaire : 129/163 mesuré) n'est PAS un
    // message : elle reste en brut, type d'origine.
    let system = &page.entrees[0];
    assert!(
        system.genre == "system",
        "le type d'origine est gardé : {}",
        system.genre
    );
    assert!(
        system.brut.contains("<system_info>"),
        "le brut reste entier"
    );
    // Les deux autres sont des messages traduits.
    assert!(
        page.entrees[1].genre == "message" && page.entrees[1].brut.contains("la demande réelle")
    );
    assert!(page.entrees[2].genre == "message" && page.entrees[2].brut.contains("SWE-1.6"));
    assert!(page.premier_seq == 1 && page.dernier_seq == 3);
}

#[test]
fn le_curseur_est_le_row_id_mais_jamais_le_node_id() {
    // DEUX sessions avec chacune leur node_id 1 : le node_id comme curseur
    // ferait relire la MAUVAISE conversation.
    let chemin = base_devin("soutien-devin-rowid");
    let ouvrier = ouvrier_de(&chemin);
    // La préparation de la base passe par une connexion d'ÉCRITURE séparée
    // (l'ouvrier est read-only par construction — la règle du moteur).
    let prepareur = match rusqlite::Connection::open(&chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("écrivain refusé : {cause}"),
    };
    match prepareur.execute_batch(
        "INSERT INTO sessions (id, title) VALUES ('tidy-rook', 'la deuxième');\n
         INSERT INTO message_nodes (session_id, node_id, parent_node_id, chat_message, created_at)
            VALUES ('tidy-rook', 1, NULL, '{\"role\": \"user\", \"content\": \"la deuxième conversation\"}', 1750000020000);",
    ) {
        Ok(()) => (),
        Err(cause) => panic!("insertion refusée : {cause}"),
    }
    // Le row_id continue d'augmenter ENTRE les sessions (AUTOINCREMENT).
    let page = match lire_derniere(&ouvrier, "tidy-rook", 10) {
        Ok(page) => page,
        Err(cause) => panic!("page tidy-rook refusée : {cause}"),
    };
    assert!(
        page.entrees.len() == 1,
        "la deuxième session a SA ligne : {}",
        page.entrees.len()
    );
    assert!(
        page.entrees[0].brut.contains("la deuxième conversation"),
        "la bonne conversation relue"
    );
    // Les ids rendus portent le row_id GLOBAL — unique entre sessions.
    match &page.entrees[0].id {
        Some(identifiant) => assert!(
            identifiant == "devin:4",
            "row_id 4 (pas node_id 1) : {identifiant}"
        ),
        None => panic!("l'id porte le row_id"),
    }
    // Et le codec identifie le message par le row_id fourni.
    let ligne = json!({ "role": "user", "content": "x" });
    match ligne_devin_vers_pi(&ligne, "17") {
        Some(ligne) => assert!(
            ligne.id.as_deref() == Some("devin:17"),
            "le codec prend l'id donné : {:?}",
            ligne.id
        ),
        None => panic!("le codec identifie par l'id fourni"),
    }
}

#[test]
fn la_réflexion_en_clair_et_le_modèle_se_portent() {
    let chat_message = json!({
        "message_id": "3fd6dff9", "role": "assistant",
        "content": "I'm powered by SWE-1.6 Slow.",
        "thinking": { "thinking": "The user is asking…", "signature": "" },
        "tool_calls": [],
        "metadata": { "created_at": "2026-06-14T17:18:50.653358Z", "generation_model": "swe-1-6-slow", "finish_reason": "stop" },
    });
    let ligne = match ligne_devin_vers_pi(&chat_message, "3") {
        Some(ligne) => ligne,
        None => panic!("le message du corpus passe"),
    };
    let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
    assert!(
        contenu.contains("\"redacted\":false") && contenu.contains("The user is asking…"),
        "la réflexion EN CLAIR : {contenu}"
    );
    assert!(contenu.contains("SWE-1.6 Slow."), "la prose porte");
    assert!(
        ligne.message.model.as_deref() == Some("swe-1-6-slow"),
        "le modèle mesuré"
    );
    assert!(
        ligne.timestamp.as_deref() == Some("2026-06-14T17:18:50.653358Z"),
        "l'ISO déjà prêt"
    );
    assert!(ligne.id.as_deref() == Some("devin:3"));
}

#[test]
fn le_garde_fou_tool_calls_ninvente_rien() {
    // La forme non mesurée : un appel SANS function.name n'est PAS retenu —
    // le fil perd la ligne, n'affiche jamais d'inventé (la réserve écrite).
    assert!(
        ligne_devin_vers_pi(
            &json!({
                "role": "assistant", "content": "",
                "tool_calls": [{ "id": "x", "arguments": "{}" }],
            }),
            "1"
        )
        .is_none(),
        "sans function.name, rien n'est retenu"
    );
    // Un appel AVEC function.name : retenu, arguments décodés ou bruts.
    let avec_nom = ligne_devin_vers_pi(
        &json!({
            "role": "assistant", "content": "",
            "tool_calls": [{ "id": "appel-1", "function": { "name": "edit", "arguments": "{\"f\":\"a.ts\"}" } }],
        }),
        "2",
    );
    match avec_nom {
        Some(ligne) => {
            let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
            assert!(
                contenu.contains("toolCall") && contenu.contains("\"edit\""),
                "l'appel retenu : {contenu}"
            );
        }
        None => panic!("un appel nommé est retenu"),
    }
    // Le message avec SEULEMENT la réflexion vide et pas d'appels : pas de
    // bulle vide.
    assert!(ligne_devin_vers_pi(&json!({ "role": "assistant", "content": "" }), "3").is_none());
}

#[test]
fn le_profil_devin_se_pose_sur_le_socle() {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilDevin::profil());
    // Une ligne de message_nodes (le format du moteur) passe par le pipeline.
    // Une ligne de message_nodes dont le chat_message est DÉJÀ PARSÉ (le
    // moteur parse, le profil traduit) passe par le pipeline.
    let ligne = json!({
        "row_id": 7, "chat_message": { "role": "assistant", "content": "via le socle", "metadata": { "generation_model": "swe-1-6-slow" } },
    });
    match registre.traite("devin", &ligne) {
        Some(LigneNormalisee::Message(ligne_pi)) => {
            assert!(
                ligne_pi.id.as_deref() == Some("devin:7"),
                "l'id = le row_id : {:?}",
                ligne_pi.id
            );
            assert!(ligne_pi.message.model.as_deref() == Some("swe-1-6-slow"));
        }
        autre => panic!("le profil devin passe par le socle : {autre:?}"),
    }
    // Le système est écarté aussi via le socle.
    assert!(registre.traite("devin", &json!({
        "row_id": 8, "chat_message": "{\"role\": \"system\", \"content\": \"contexte\"}",
    })).is_none());
    // L'inconnu ne bascule pas.
    assert!(registre.traite("inconnu", &ligne).is_none());
    // Les capacités mesurées : interactions NON établies (aucune session
    // réelle n'en montre) — la capacité reste fausse tant qu'aucune preuve.
    let capacites = ProfilDevin::capacites();
    assert!(
        capacites.lisible && capacites.catalogue && capacites.lancement && !capacites.interactions
    );
}

#[test]
fn la_mutation_de_borne_est_relue_chez_devin_aussi() {
    let chemin = base_devin("soutien-devin-borne");
    let ouvrier = ouvrier_de(&chemin);
    let depuis = 3_i64;
    // La génération se TERMINE : la ligne est réécrite, son row_id ne bouge pas.
    let ecrivain = match rusqlite::Connection::open(&chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("écrivain refusé : {cause}"),
    };
    let mis_a_jour = json!({
        "role": "assistant", "content": "maintenant avec la réponse complète",
        "metadata": { "generation_model": "swe-1-6-slow" },
    })
    .to_string();
    match ecrivain.execute(
        "UPDATE message_nodes SET chat_message = ?1 WHERE row_id = 3",
        [&mis_a_jour],
    ) {
        Ok(_) => (),
        Err(cause) => panic!("mutation refusée : {cause}"),
    }
    let page = match lire_depuis(&ouvrier, "burly-stop", depuis, 10) {
        Ok(page) => page,
        Err(cause) => panic!("relecture refusée : {cause}"),
    };
    assert!(
        page.entrees[0].brut.contains("la réponse complète"),
        "la borne mutée est RELUE : {}",
        page.entrees[0].brut
    );
}
