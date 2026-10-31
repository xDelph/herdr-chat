//! Les collages emballés par Claude Code (`<pasted_content id=…>`) : la
//! demande enregistrée redevient le texte envoyé — dans le fil, la file
//! d'attente et la liste. Retour du 2026-10-31 (« double envoi »).

use serde_json::{Value, json};
use sessions::agents::claude::ProfilClaude;
use sessions::agents::claude::collages::texte_sans_collages;
use sessions::pipeline::{LigneNormalisee, Registre};

/// La forme MESURÉE (session réelle, 2026-10-31, lecture seule) : un envoi
/// de plusieurs lignes depuis la PWA, remis par Herdr comme un collage.
const ENVOYE: &str = "Autre bug, sur le Dashboard cette fois :\nLes filtres ne sont pas gardés\nSur la page commandes, regrouper par étape";

fn emballe(texte: &str) -> String {
    format!("\n\n<pasted_content id=\"09c3\">\n{texte}\n</pasted_content id=\"09c3\">\n")
}

fn message(ligne: &Value) -> domain::session::LignePi {
    let mut registre = Registre::nouveau();
    registre.pose(ProfilClaude::profil());
    match registre.traite("claude", ligne) {
        Some(LigneNormalisee::Message(ligne)) => *ligne,
        autre => panic!("un message était attendu : {autre:?}"),
    }
}

/// Le texte d'un message, que son contenu soit une chaîne ou des blocs.
fn texte(ligne: &domain::session::LignePi) -> String {
    match &ligne.message.content {
        Value::String(texte) => texte.clone(),
        Value::Array(blocs) => blocs
            .iter()
            .filter_map(|bloc| bloc.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        autre => panic!("contenu inattendu : {autre}"),
    }
}

#[test]
fn le_collage_mesure_redevient_le_texte_envoye() {
    assert_eq!(texte_sans_collages(&emballe(ENVOYE)), ENVOYE);
}

#[test]
fn sans_collage_le_texte_reste_intact_octet_pour_octet() {
    for brut in [
        "une ligne",
        "  espaces gardés \n",
        "",
        "cite <pasted_content> sans id",
    ] {
        assert_eq!(texte_sans_collages(brut), brut);
    }
}

#[test]
fn le_texte_tape_et_le_collage_se_joignent_comme_claude() {
    // La règle de Claude Code (`RIi`) : morceaux tapés et corps joints par
    // un saut de ligne, au plus deux sauts autour du bloc lui appartiennent.
    let brut = "regarde ça\n\n<pasted_content id=\"a1f0\">\nligne 1\nligne 2\n</pasted_content id=\"a1f0\">\n\nmerci";
    assert_eq!(
        texte_sans_collages(brut),
        "regarde ça\nligne 1\nligne 2\nmerci"
    );
    // Deux collages.
    let deux = format!(
        "{}{}",
        emballe("un\ndeux"),
        "<pasted_content id=\"00ff\">\ntrois\n</pasted_content id=\"00ff\">\n"
    );
    assert_eq!(texte_sans_collages(&deux), "un\ndeux\ntrois");
}

#[test]
fn une_forme_hors_regle_n_est_pas_devinee() {
    for brut in [
        // Identifiant en majuscules, trop court, non hexadécimal.
        "<pasted_content id=\"09C3\">\nx\n</pasted_content id=\"09C3\">\n",
        "<pasted_content id=\"09c\">\nx\n</pasted_content id=\"09c\">\n",
        "<pasted_content id=\"zzzz\">\nx\n</pasted_content id=\"zzzz\">\n",
        // Pas de saut de ligne après l'ouvrante.
        "<pasted_content id=\"09c3\">x\n</pasted_content id=\"09c3\">\n",
        // Fermante absente, ou d'un autre identifiant.
        "<pasted_content id=\"09c3\">\nx\n",
        "<pasted_content id=\"09c3\">\nx\n</pasted_content id=\"aaaa\">\n",
    ] {
        assert_eq!(texte_sans_collages(brut), brut, "intact : {brut:?}");
    }
}

#[test]
fn un_corps_vide_et_l_unicode_ne_cassent_rien() {
    assert_eq!(
        texte_sans_collages("<pasted_content id=\"09c3\">\n</pasted_content id=\"09c3\">\n"),
        ""
    );
    let accentue = "J’ai l’impression\u{a0}: déjà vu — « oui »\nfin";
    assert_eq!(texte_sans_collages(&emballe(accentue)), accentue);
}

#[test]
fn la_demande_au_repos_arrive_deballee_dans_le_fil() {
    let ligne = json!({
        "type": "user", "uuid": "u-1", "timestamp": "2026-10-31T14:02:20.388Z",
        "message": { "role": "user", "content": emballe(ENVOYE) },
    });
    let rendu = message(&ligne);
    assert_eq!(rendu.message.role.as_deref(), Some("user"));
    assert_eq!(texte(&rendu), ENVOYE);
}

#[test]
fn la_demande_en_plein_tour_arrive_deballee() {
    let ligne = json!({
        "type": "attachment", "uuid": "u-2", "timestamp": "2026-10-31T14:06:01.483Z",
        "attachment": {
            "type": "queued_command", "prompt": emballe(ENVOYE),
            "commandMode": "prompt", "origin": { "kind": "human" },
        },
    });
    let rendu = message(&ligne);
    assert_eq!(rendu.message.role.as_deref(), Some("user"));
    assert_eq!(texte(&rendu), ENVOYE);
}

#[test]
fn la_demande_emballee_entre_dans_la_file_affichee() {
    // Emballée, elle commençait par `<` et passait pour une entrée du
    // harnais : la file ne la montrait jamais.
    let ligne = json!({
        "type": "queue-operation", "operation": "enqueue",
        "timestamp": "2026-10-31T14:06:02.575Z", "content": emballe(ENVOYE),
    });
    let rendu = message(&ligne);
    assert_eq!(rendu.message.role.as_deref(), Some("custom"));
    assert_eq!(texte(&rendu), ENVOYE);
}
