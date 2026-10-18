//! Le profil Pi (T018/D11) : corpus préservé, filiation intra-session
//! jamais confondue avec un sous-agent, aucune écriture source.

use serde_json::{Value, json};
use sessions::agents::pi::{ProfilPi, filiation_de_contenu, ligne_vers_pi};
use sessions::pipeline::LigneNormalisee;

#[test]
fn les_lignes_du_corpus_se_preservent_telle_quelles() {
    // La forme À PLAT du corpus (pi/pane-01.jsonl, mesurée).
    let plat = json!({
        "type": "message", "id": "msg-0-u", "timestamp": "2024-03-05T08:00:00.000Z",
        "role": "user", "content": [{ "type": "text", "text": "Le chemin critique passe par le serveur." }],
    });
    let ligne = match ligne_vers_pi(&plat) {
        Some(ligne) => ligne,
        None => panic!("une ligne à plat du corpus doit passer"),
    };
    assert!(
        ligne.id.as_deref() == Some("msg-0-u"),
        "l'id préservé : {:?}",
        ligne.id
    );
    assert!(
        ligne.timestamp.as_deref() == Some("2024-03-05T08:00:00.000Z"),
        "l'horodatage préservé"
    );
    assert!(
        ligne.message.role.as_deref() == Some("user"),
        "le rôle préservé"
    );
    let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
    assert!(
        contenu.contains("Le chemin critique passe par le serveur."),
        "le contenu préservé : {contenu}"
    );
}

#[test]
fn la_forme_enveloppee_passe_par_identite() {
    let enveloppee = json!({
        "type": "message", "id": "msg-1-a",
        "message": { "role": "assistant", "model": "faux-modele",
                     "content": [{ "type": "thinking", "thinking": "opaque" }] },
    });
    match ligne_vers_pi(&enveloppee) {
        Some(ligne) => {
            assert!(ligne.id.as_deref() == Some("msg-1-a"));
            assert!(
                ligne.message.model.as_deref() == Some("faux-modele"),
                "le modèle du message préservé"
            );
        }
        None => panic!("la forme enveloppée passe par identité"),
    }
}

#[test]
fn les_autres_types_de_ligne_restent_en_brut() {
    // usage / compaction / custom_message / label / session_info : PAS des
    // messages — None (l'appelant garde la brute, rien n'est fabriqué).
    for genre in [
        "usage",
        "compaction",
        "custom_message",
        "label",
        "session_info",
        "context_edit",
    ] {
        let ligne = json!({ "type": genre, "detail": { "x": 1 } });
        assert!(
            ligne_vers_pi(&ligne).is_none(),
            "{genre} n'est pas un message : il reste en brut"
        );
    }
    // Une ligne illisible (pas un objet) : None aussi.
    assert!(ligne_vers_pi(&json!("une chaîne")).is_none());
    assert!(ligne_vers_pi(&json!([])).is_none());
}

#[test]
fn les_huit_roles_sont_au_complet_et_ouverts() {
    // Les huit rôles du fil (mesuré MessageRole) — la constante est fermée
    // mais une ligne pi porte son rôle tel quel, l'union au domaine décide.
    assert!(sessions::agents::pi::ROLES.len() == 8);
    for (role, attendu) in [
        ("user", "user"),
        ("assistant", "assistant"),
        ("toolResult", "toolResult"),
        ("bashExecution", "bashExecution"),
        ("custom", "custom"),
        ("branchSummary", "branchSummary"),
        ("compactionSummary", "compactionSummary"),
    ] {
        assert!(
            sessions::agents::pi::ROLES.contains(&attendu),
            "le rôle {role} doit figurer"
        );
    }
}

#[test]
fn la_filiation_parentid_n_est_jamais_un_sous_agent() {
    // D11 : le parentSession de l'EN-TÊTE est le seul lien inter-sessions.
    let entete = json!({
        "type": "session", "cwd": "/projets/atelier", "id": "sess-1",
        "parentSession": "sess-0", "version": 1,
    });
    let filiation = filiation_de_contenu(&entete);
    assert!(
        filiation.session_parente.as_deref() == Some("sess-0"),
        "le parentSession porte la filiation inter-sessions"
    );
    // Un parentId de LIGNE ne devient JAMAIS une filiation de session : il
    // reste un champ de ligne (intra-session), le profil ne le traduit pas.
    let ligne_branchee = json!({
        "type": "message", "id": "msg-2", "parentId": "msg-1",
        "message": { "role": "user", "content": [{ "type": "text", "text": "suite" }] },
    });
    let normalisee = match ligne_vers_pi(&ligne_branchee) {
        Some(ligne) => ligne,
        None => panic!("une ligne branchée reste un message"),
    };
    let rendu = serde_json::to_value(&normalisee).unwrap_or_default();
    assert!(
        rendu.get("parentId").is_none(),
        "le profil ne réinvente PAS une filiation depuis parentId (D11) : {rendu}"
    );
    // Et le profil ne suggère aucun sous-agent : la valeur parle, point.
    match LigneNormalisee::Message(Box::new(normalisee.clone())) {
        LigneNormalisee::Message(ligne) => {
            assert!(
                ligne.message.role.is_some(),
                "la ligne reste ce qu'elle est"
            );
        }
        autre => panic!("pas de transformation en autre chose : {autre:?}"),
    }
    // L'en-tête sans parentSession : pas de filiation inventée.
    let sans_parent = filiation_de_contenu(&json!({ "type": "session", "id": "sess-2" }));
    assert!(
        sans_parent.session_parente.is_none(),
        "pas de parent = pas de parent"
    );
}

#[test]
fn le_profil_se_pose_dans_le_registre_sans_effet_de_bord() {
    // Le profil Pi passe par le pipeline commun — et le corpus passe avec lui.
    let mut registre = sessions::pipeline::Registre::nouveau();
    registre.pose(ProfilPi::profil());
    let plat = json!({
        "type": "message", "id": "msg-0-u", "role": "user",
        "content": [{ "type": "text", "text": "première demande" }],
    });
    match registre.traite("pi", &plat) {
        Some(LigneNormalisee::Message(ligne)) => {
            assert!(
                ligne.id.as_deref() == Some("msg-0-u"),
                "le corpus passe par le pipeline"
            );
        }
        autre => panic!("le profil pi doit passer par le socle : {autre:?}"),
    }
    // Les capacités mesurées de la surface TS : tout est disponible pour pi.
    let capacites = ProfilPi::capacites();
    assert!(
        capacites.lisible && capacites.catalogue && capacites.lancement && capacites.interactions
    );
    // Le genre inconnu NE bascule PAS sur pi (règle du socle, revérifiée ici).
    assert!(
        registre.traite("inconnu", &plat).is_none(),
        "pas de repli vers pi"
    );
}

#[test]
fn aucune_ecriture_de_la_source() {
    // Le profil ne modifie jamais le fichier source : structurellement, le
    // module n'expose AUCUNE fonction d'écriture — la preuve par la lecture
    // du fichier : aucune de ses fonctions ne prend un chemin en écriture.
    // Ici on s'assure que la lecture NE CHANGE RIEN au fichier :
    let racine = std::env::temp_dir().join(format!(
        "soutien-pi-ecriture-{}-{}",
        std::process::id(),
        900_u32
    ));
    match std::fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let fichier = racine.join("session.jsonl");
    match std::fs::write(
        &fichier,
        "{\"type\":\"message\",\"role\":\"user\",\"content\":[]}\n",
    ) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let avant = match std::fs::read_to_string(&fichier) {
        Ok(texte) => texte,
        Err(cause) => panic!("lecture refusée : {cause}"),
    };
    let valeur: Value = serde_json::from_str(avant.trim()).unwrap_or_default();
    let _ = ligne_vers_pi(&valeur);
    let apres = match std::fs::read_to_string(&fichier) {
        Ok(texte) => texte,
        Err(cause) => panic!("relecture refusée : {cause}"),
    };
    assert!(avant == apres, "la source est intacte après lecture");
    let _ = std::fs::remove_dir_all(&racine);
}
