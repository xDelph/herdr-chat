//! Le pipeline et le registre (T017) : le socle ne connaît AUCUN agent
//! concret, l'inconnu ne bascule pas, les profils sont indépendants.
//! Prouve : D06.

use domain::session::LignePi;
use serde_json::{Value, json};
use sessions::pipeline::{Capacites, Codec, LigneNormalisee, Profil, Registre};

/// Les codecs FACTICES sont des **fonctions statiques** : un pointeur `fn`
/// ne capture rien — l'agent est une donnée du test, jamais une branche du
/// socle.
fn codec_de_marque(ligne: &Value, marque: &str) -> Option<Value> {
    let texte = ligne.get("texte").and_then(Value::as_str)?;
    if !texte.contains(marque) {
        return None;
    }
    Some(json!({
        "type": "message",
        "message": { "role": "user", "content": [{ "type": "text", "text": texte }] },
    }))
}

fn codec_x1(ligne: &Value) -> Option<LignePi> {
    codec_de_marque(ligne, "x1").and_then(|valeur| serde_json::from_value(valeur).ok())
}

fn codec_y1(ligne: &Value) -> Option<LignePi> {
    codec_de_marque(ligne, "y1").and_then(|valeur| serde_json::from_value(valeur).ok())
}

fn codec_reel(ligne: &Value) -> Option<LignePi> {
    codec_de_marque(ligne, "reel").and_then(|valeur| serde_json::from_value(valeur).ok())
}

fn codec_devin_1(ligne: &Value) -> Option<LignePi> {
    codec_de_marque(ligne, "devin-1").and_then(|valeur| serde_json::from_value(valeur).ok())
}

fn codec_devin_2(ligne: &Value) -> Option<LignePi> {
    codec_de_marque(ligne, "devin-2").and_then(|valeur| serde_json::from_value(valeur).ok())
}

fn profil(genre: &'static str, ligne_vers_pi: fn(&Value) -> Option<LignePi>) -> Profil {
    Profil {
        genre,
        capacites: Capacites {
            lisible: true,
            catalogue: false,
            lancement: false,
            interactions: false,
        },
        codec: Codec {
            ligne_vers_pi,
            reglage_vers_pi: None,
        },
    }
}

#[test]
fn le_socle_accepte_tout_genre_sans_branche() {
    // Les genres sont des DONNÉES : deux familles inventées passent par le
    // même pipeline — aucun `match` sur un agent concret.
    let mut registre = Registre::nouveau();
    registre.pose(profil("famille-x", codec_x1));
    registre.pose(profil("famille-y", codec_y1));
    match registre.traite("famille-x", &json!({ "texte": "ligne x1" })) {
        Some(LigneNormalisee::Message(ligne)) => {
            assert!(
                ligne.message.role.as_deref() == Some("user"),
                "normalisée comme les autres"
            );
        }
        autre => panic!("famille-x doit passer : {autre:?}"),
    }
    match registre.traite("famille-y", &json!({ "texte": "ligne y1" })) {
        Some(LigneNormalisee::Message(_)) => (),
        autre => panic!("famille-y doit passer : {autre:?}"),
    }
    // Une ligne hors conversation pour SA famille : None (à l'appelant de
    // garder la brute) — pas un basculement.
    assert!(
        registre
            .traite("famille-x", &json!({ "texte": "ligne y1" }))
            .is_none()
    );
}

#[test]
fn un_genre_inconnu_ne_bascule_pas_sur_un_autre_profil() {
    let mut registre = Registre::nouveau();
    registre.pose(profil("famille-reelle", codec_reel));
    // Le genre inconnu, même avec une ligne de la MÊME forme : AUCUN repli.
    match registre.profil("inconnu") {
        None => (),
        Some(profil) => panic!("aucun profil pour un inconnu : {:?}", profil.genre),
    }
    match registre.traite("inconnu", &json!({ "texte": "ligne reel" })) {
        None => (),
        Some(ligne) => panic!("l'inconnu ne doit pas passer par un autre profil : {ligne:?}"),
    }
    // Le profil connu, lui, marche toujours — rien n'a fuité.
    assert!(
        registre
            .traite("famille-reelle", &json!({ "texte": "ligne reel" }))
            .is_some()
    );
}

#[test]
fn modifier_devin_ne_change_pas_codex() {
    let mut registre = Registre::nouveau();
    registre.pose(profil("devin", codec_devin_1));
    registre.pose(profil("codex", codec_reel));
    let ligne_codex = json!({ "texte": "ligne reel" });
    let ligne_devin = json!({ "texte": "ligne devin-1" });
    let avant_codex = registre.traite("codex", &ligne_codex);
    let _avant_devin = registre.traite("devin", &ligne_devin);
    // MODIFICATION du profil Devin : nouveaux capacités, nouveau codec.
    registre.pose(Profil {
        genre: "devin",
        capacites: Capacites {
            lisible: true,
            catalogue: true,
            lancement: true,
            interactions: false,
        },
        codec: Codec {
            ligne_vers_pi: codec_devin_2,
            reglage_vers_pi: None,
        },
    });
    let apres_codex = registre.traite("codex", &ligne_codex);
    let apres_devin = registre.traite("devin", &ligne_devin);
    assert!(
        avant_codex == apres_codex,
        "codex INCHANGÉ : {avant_codex:?} vs {apres_codex:?}"
    );
    assert!(
        apres_devin.is_none(),
        "le codec Devin a changé (devin-1 n'est plus rendu)"
    );
    // Les capacités de Devin changées : celles de Codex intactes.
    let profil_codex = match registre.profil("codex") {
        Some(profil) => profil,
        None => panic!("codex reste posé"),
    };
    assert!(
        !profil_codex.capacites.catalogue && !profil_codex.capacites.lancement,
        "les capacités de codex sont restées les siennes"
    );
}

#[test]
fn les_capacites_sont_independantes_lues_sans_deduction() {
    // Une famille lisible sans lancement, une autre avec catalogue+interactions
    // mais illisible (un agent dont on ne lit PAS les sessions) : chaque
    // capacité se pose seule, jamais déduite d'une voisine.
    let mut registre = Registre::nouveau();
    registre.pose(Profil {
        genre: "lecteur-seul",
        capacites: Capacites {
            lisible: true,
            catalogue: false,
            lancement: false,
            interactions: false,
        },
        codec: Codec {
            ligne_vers_pi: codec_x1,
            reglage_vers_pi: None,
        },
    });
    registre.pose(Profil {
        genre: "catalogue-seul",
        capacites: Capacites {
            lisible: false,
            catalogue: true,
            lancement: true,
            interactions: true,
        },
        codec: Codec {
            ligne_vers_pi: codec_y1,
            reglage_vers_pi: None,
        },
    });
    let lecteur = match registre.profil("lecteur-seul") {
        Some(profil) => profil.capacites,
        None => panic!("posé"),
    };
    let catalogueur = match registre.profil("catalogue-seul") {
        Some(profil) => profil.capacites,
        None => panic!("posé"),
    };
    assert!(lecteur.lisible && !lecteur.catalogue && !lecteur.lancement && !lecteur.interactions);
    assert!(
        catalogueur.catalogue
            && catalogueur.lancement
            && catalogueur.interactions
            && !catalogueur.lisible,
        "les quatre capacités sont indépendantes"
    );
}

#[test]
fn un_reglage_passe_par_son_etape_propre() {
    // Une famille qui écrit des réglages : le changement sort par l'étape
    // propre — la LignePi ne paie pas la variante.
    fn reglage_de(ligne: &Value) -> Option<domain::session::ChangePi> {
        if ligne.get("reglage").and_then(Value::as_str) != Some("model") {
            return None;
        }
        serde_json::from_value(json!({ "type": "model_change", "modelId": "m-1" })).ok()
    }
    fn message_de(ligne: &Value) -> Option<LignePi> {
        serde_json::from_value(json!({
            "type": "message",
            "message": { "role": "user", "content": [{ "type": "text", "text": ligne.get("t").and_then(Value::as_str).unwrap_or("") }] },
        }))
        .ok()
    }
    let mut registre = Registre::nouveau();
    registre.pose(Profil {
        genre: "a-reglages",
        capacites: Capacites {
            lisible: true,
            catalogue: false,
            lancement: false,
            interactions: false,
        },
        codec: Codec {
            ligne_vers_pi: message_de,
            reglage_vers_pi: Some(reglage_de),
        },
    });
    match registre.traite("a-reglages", &json!({ "reglage": "model" })) {
        Some(LigneNormalisee::Reglage(changement)) => {
            assert!(
                changement.model_id.as_deref() == Some("m-1"),
                "le changement sort par le sien"
            );
        }
        autre => panic!("un réglage doit sortir en Reglage : {autre:?}"),
    }
    match registre.traite("a-reglages", &json!({ "t": "message" })) {
        Some(LigneNormalisee::Message(ligne)) => {
            assert!(ligne.message.role.is_some(), "le message sort en Message");
        }
        autre => panic!("un message doit sortir en Message : {autre:?}"),
    }
}
