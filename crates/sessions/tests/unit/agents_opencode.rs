//! Le profil opencode (T021/D15/D17) : les requêtes mesurées sur l'ouvrier,
//! le curseur par `seq`, les lignes réécrites incluses (D15), `default`
//! jamais inventé (D17), images data-URI et erreurs d'outil gardées.

use serde_json::json;
use sessions::agents::opencode::ProfilOpencode;
use sessions::agents::opencode::moteur::{lire_avant, lire_depuis, lire_derniere, session_existe};
use sessions::families::codecs::opencode::{horodatage_iso, ligne_opencode_vers_pi};
use sessions::pipeline::{LigneNormalisee, Registre};

fn soutien_nonce(pid: u32) -> u32 {
    // Un nonce de nommage stable par test (le pid suffit à la séparation).
    pid
}

/// Une base factice aux DEUX tables du fil (mesuré) : session_v2 + session_message.
fn base_opencode(prefixe: &str) -> std::path::PathBuf {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        soutien_nonce(std::process::id())
    ));
    match std::fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let chemin = racine.join("opencode.db");
    let connexion = match rusqlite::Connection::open(&chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("création refusée : {cause}"),
    };
    match connexion.execute_batch(
        "CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
         CREATE TABLE session_message (
            id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            type TEXT NOT NULL,
            seq INTEGER NOT NULL,
            time_created INTEGER NOT NULL,
            data TEXT NOT NULL
         );
         INSERT INTO session_v2 (id) VALUES ('ses_ef41fb118ffeUmFo0RN74rXEyi');
         INSERT INTO session_message (id, session_id, type, seq, time_created, data)
            VALUES ('m1', 'ses_ef41fb118ffeUmFo0RN74rXEyi', 'user', 1, 1750000000000, '{\"text\": \"liste les fichiers\", \"time\": {\"created\": 1750000000000}}'),
                   ('m2', 'ses_ef41fb118ffeUmFo0RN74rXEyi', 'assistant', 2, 1750000005000, '{\"model\": {\"id\": \"claude-sonnet-4-6\", \"providerID\": \"anthropic\", \"variant\": \"high\"}, \"time\": {\"created\": 1750000005000}, \"content\": [{\"type\": \"text\", \"text\": \"je regarde\"}, {\"type\": \"reasoning\", \"text\": \"en clair\"}]}'),
                   ('m3', 'ses_ef41fb118ffeUmFo0RN74rXEyi', 'idle', 3, 1750000010000, '{\"outcome\": \"ok\"}');",
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

const SESSION: &str = "ses_ef41fb118ffeUmFo0RN74rXEyi";

#[test]
fn les_requetes_mesurees_passent_par_l_ouvrier() {
    let chemin = base_opencode("soutien-opencode-requetes");
    let ouvrier = ouvrier_de(&chemin);
    // La session existe — et une autre n'existe pas (la distinction de
    // diagnostic : erreur ≠ vide).
    match session_existe(&ouvrier, SESSION) {
        Ok(true) => (),
        autre => panic!("la session du corpus existe : {autre:?}"),
    }
    match session_existe(&ouvrier, "ses_inconnu") {
        Ok(false) => (),
        autre => panic!("l'identifiant inconnu ne passe PAS : {autre:?}"),
    }
    // La dernière page : 3 lignes, ordre de lecture remis.
    let page = match lire_derniere(&ouvrier, SESSION, 10) {
        Ok(page) => page,
        Err(cause) => panic!("dernière page refusée : {cause}"),
    };
    assert!(
        page.entrees.len() == 3,
        "trois lignes : {}",
        page.entrees.len()
    );
    // L'ordre de lecture remis ; la première entrée est le prompt user
    // TRADUIT — son type au fil devient "message" (mesuré versEntree).
    assert!(
        page.entrees[0].genre == "message",
        "l'ordre de lecture est remis : {}",
        page.entrees[0].genre
    );
    assert!(
        page.entrees[0].brut.contains("liste les fichiers"),
        "le prompt du corpus reste"
    );
    assert!(
        page.entrees[2].genre == "idle",
        "la ligne non traduite garde son type : {}",
        page.entrees[2].genre
    );
    assert!(
        page.premier_seq == 1 && page.dernier_seq == 3,
        "les positions : {}/{}",
        page.premier_seq,
        page.dernier_seq
    );
    assert!(!page.has_more);
}

#[test]
fn d15_les_lignes_reecrites_sont_incluses_une_seule_fois() {
    let chemin = base_opencode("soutien-opencode-d15");
    let ouvrier = ouvrier_de(&chemin);
    // Le curseur à 2 (le message assistant déjà servi) : la RÉÉCRITURE de
    // la même ligne (même seq, contenu plus long) est relue — `>=` inclus,
    // le correctif du streaming.
    let ecrivain = match rusqlite::Connection::open(&chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("écrivain refusé : {cause}"),
    };
    let reecrite = json!({
        "model": { "id": "claude-sonnet-4-6", "providerID": "anthropic", "variant": "high" },
        "time": { "created": 1_750_000_005_000_i64 },
        "content": [{ "type": "text", "text": "je regarde — et je trouve trois fichiers" }],
    })
    .to_string();
    match ecrivain.execute(
        "UPDATE session_message SET data = ?1 WHERE id = 'm2'",
        [&reecrite],
    ) {
        Ok(_) => (),
        Err(cause) => panic!("réécriture refusée : {cause}"),
    }
    let page = match lire_depuis(&ouvrier, SESSION, 2, 10) {
        Ok(page) => page,
        Err(cause) => panic!("page depuis refusée : {cause}"),
    };
    // La ligne réécrite EST relue (borne incluse) — une ligne relue, assumée.
    let reecrite = page
        .entrees
        .iter()
        .find(|entree| entree.brut.contains("trois fichiers"))
        .map(|entree| entree.id.clone());
    assert!(
        reecrite.is_some(),
        "la ligne réécrite est relue (D15) : {:?}",
        page.entrees.len()
    );
    // Le client remplace PAR IDENTIFIANT : l'id est stable d'une lecture à
    // l'autre (la clé de la ligne, pas un contenu déduit).
    let identifiant = reecrite.unwrap_or_default();
    assert!(
        identifiant == Some(String::from("opencode:m2"))
            || identifiant.as_deref() == Some("opencode:m2"),
        "l'id est la clé stable : {identifiant:?}"
    );
    // La page D'AVANT : `<` strict — pas de doublon avec la borne.
    let avant = match lire_avant(&ouvrier, SESSION, 2, 10) {
        Ok(page) => page,
        Err(cause) => panic!("page avant refusée : {cause}"),
    };
    assert!(
        avant.entrees.len() == 1
            && avant.entrees[0].genre == "message"
            && avant.entrees[0].brut.contains("liste les fichiers"),
        "seulement seq 1, traduite en message : {:?}",
        avant
            .entrees
            .iter()
            .map(|e| e.genre.clone())
            .collect::<Vec<_>>()
    );
}

#[test]
fn d17_le_variant_default_nest_jamais_inventé_et_les_images_erreurs_gardées() {
    // `variant: "default"` = AUCUN niveau choisi (52 occurrences mesurées) :
    // il ne se transforme JAMAIS en thinkingLevel.
    let data_default = json!({
        "model": { "id": "m-1", "providerID": "p-1", "variant": "default" },
        "content": [{ "type": "text", "text": "sans niveau" }],
    });
    let ligne = match ligne_opencode_vers_pi("assistant", &data_default, "m1") {
        Some(ligne) => ligne,
        None => panic!("un message assistant passe"),
    };
    assert!(
        ligne.message.thinking_level.is_none(),
        "default = aucun niveau déclaré : {:?}",
        ligne.message.thinking_level
    );
    assert!(
        ligne.message.model.as_deref() == Some("m-1")
            && ligne.message.provider.as_deref() == Some("p-1")
    );

    // Les images data-URI et les erreurs d'outil restent.
    let data_outils = json!({
        "content": [
            { "type": "tool", "id": "t1", "name": "read", "state": { "status": "error", "input": { "chemin": "/p" } },
              "content": [{ "type": "text", "text": "boom" },
                          { "type": "file", "uri": "data:image/png;base64,aG9sYQ==" }] },
        ],
    });
    let ligne = match ligne_opencode_vers_pi("assistant", &data_outils, "m2") {
        Some(ligne) => ligne,
        None => panic!("un message avec outils passe"),
    };
    let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
    assert!(
        contenu.contains("toolCall") && contenu.contains("toolResult"),
        "appel PUIS résultat : {contenu}"
    );
    assert!(
        contenu.contains("image/png") && contenu.contains("aG9sYQ=="),
        "l'image data-URI reste : {contenu}"
    );
    // Le state error est le SEUL marqueur d'échec — porté, pas deviné.
    assert!(
        contenu.contains("\"isError\":true"),
        "l'erreur porte : {contenu}"
    );
    // La réflexion en clair : publiée, redacted:false.
    let data_raisonnement = json!({
        "content": [{ "type": "reasoning", "text": "réflexion en clair" }],
    });
    let ligne = match ligne_opencode_vers_pi("assistant", &data_raisonnement, "m3") {
        Some(ligne) => ligne,
        None => panic!("une réflexion en clair passe"),
    };
    let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
    assert!(
        contenu.contains("\"redacted\":false") && contenu.contains("réflexion en clair"),
        "publiée : {contenu}"
    );
}

#[test]
fn les_types_non_traduits_restent_lignes_lues() {
    // `idle`/`system`/`synthetic`/`compaction` : PAS traduits — mais le
    // curseur avance quand même (sinon relecture infinie).
    let chemin = base_opencode("soutien-opencode-non-traduits");
    let ouvrier = ouvrier_de(&chemin);
    let page = match lire_depuis(&ouvrier, SESSION, 3, 10) {
        Ok(page) => page,
        Err(cause) => panic!("page refusée : {cause}"),
    };
    assert!(
        page.entrees.len() == 1,
        "la ligne idle est LUE : {}",
        page.entrees.len()
    );
    assert!(
        page.entrees[0].genre == "idle",
        "elle reste son type : {}",
        page.entrees[0].genre
    );
    assert!(page.dernier_seq == 3, "le curseur a avancé");
    // Le codec, lui, ne la traduit pas.
    assert!(ligne_opencode_vers_pi("idle", &json!({ "outcome": "ok" }), "m3").is_none());
    assert!(ligne_opencode_vers_pi("system", &json!({}), "m4").is_none());
    assert!(ligne_opencode_vers_pi("synthetic", &json!({}), "m5").is_none());
}

#[test]
fn le_profil_opencode_se_pose_sur_le_socle() {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilOpencode::profil());
    let ligne = json!({
        "type": "assistant", "id": "m2",
        "data": { "model": { "id": "m-1", "providerID": "p-1", "variant": "high" },
                  "content": [{ "type": "text", "text": "via le socle" }] },
    });
    match registre.traite("opencode", &ligne) {
        Some(LigneNormalisee::Message(ligne_pi)) => {
            assert!(
                ligne_pi.id.as_deref() == Some("opencode:m2"),
                "l'id porte le préfixe stable"
            );
            assert!(ligne_pi.message.thinking_level.as_deref() == Some("high"));
        }
        autre => panic!("le profil opencode passe par le socle : {autre:?}"),
    }
    // L'inconnu ne bascule pas (règle du socle).
    assert!(registre.traite("inconnu", &ligne).is_none());
    let capacites = ProfilOpencode::capacites();
    assert!(
        capacites.lisible && capacites.catalogue && capacites.lancement && capacites.interactions
    );
}

#[test]
fn horodatage_iso_aux_bornes() {
    assert!(
        horodatage_iso(1_750_000_000_000).is_some(),
        "une vraie date passe"
    );
    assert!(horodatage_iso(0).is_none(), "zéro = date absurde, rien");
    assert!(horodatage_iso(-5).is_none(), "négatif = rien");
    assert!(
        horodatage_iso(4_102_444_800_001).is_none(),
        "au-delà = rien"
    );
    // L'ISO rendu est bien formé (le millésime civil calculé).
    let rendu = horodatage_iso(1_750_000_000_000).unwrap_or_default();
    assert!(
        rendu.ends_with('Z') && rendu.len() == 24,
        "ISO 8601 ms : {rendu}"
    );
}
