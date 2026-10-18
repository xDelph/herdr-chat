//! Les magasins jetables : isolation, dernière main, verbatim, vrai SQLite.

use std::fs;
use test_support::temp_stores::{MagasinJsonl, MagasinSqlite, RacineJetable};

#[test]
fn la_racine_est_sous_le_tmpdir_hors_home_et_detruisible() {
    let mut racine = match RacineJetable::nouveau("soutien-verif-racine") {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let chemin = racine.chemin().to_path_buf();
    assert!(
        racine.sous_le_tmpdir(),
        "la racine vit sous le tmpdir du système"
    );
    if let Some(home) = std::env::var_os("HOME") {
        assert!(
            !chemin.starts_with(&home),
            "la racine ne doit jamais vivre sous le HOME"
        );
    }
    match racine.detruit() {
        Ok(()) => (),
        Err(cause) => panic!("destruction refusée : {cause}"),
    }
    assert!(!chemin.exists(), "le nettoyage prouvable retire la racine");
    match racine.detruit() {
        Ok(()) => (),
        Err(cause) => panic!("la deuxième destruction reste un succès sans effet : {cause}"),
    }
}

#[test]
fn deux_racines_meme_prefixe_sont_distinctes() {
    let premiere = match RacineJetable::nouveau("soutien-verif-pair") {
        Ok(racine) => racine,
        Err(cause) => panic!("première racine refusée : {cause}"),
    };
    let seconde = match RacineJetable::nouveau("soutien-verif-pair") {
        Ok(racine) => racine,
        Err(cause) => panic!("deuxième racine refusée : {cause}"),
    };
    assert!(
        premiere.chemin() != seconde.chemin(),
        "le nonce fait la différence"
    );
}

#[test]
fn le_nettoyage_attend_la_derniere_main() {
    let racine = match RacineJetable::nouveau("soutien-verif-main") {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racine = racine.partage();
    let chemin_racine = racine.chemin().to_path_buf();
    let magasin = match MagasinJsonl::nouveau(&racine, "jsonl/pi/agent-1/version-1/sessions.jsonl")
    {
        Ok(magasin) => magasin,
        Err(cause) => panic!("magasin refusé : {cause}"),
    };
    let chemin_magasin = magasin.chemin().to_path_buf();
    assert!(
        chemin_magasin.exists(),
        "le fichier du magasin existe avant la dernière main"
    );
    drop(magasin);
    assert!(
        chemin_magasin.exists(),
        "lâcher un magasin ne retire rien tant qu'une main reste"
    );
    drop(racine);
    assert!(
        !chemin_magasin.exists(),
        "à la dernière main, la charge est nettoyée"
    );
    assert!(!chemin_racine.exists(), "la racine disparaît avec elle");
}

#[test]
fn un_magasin_jsonl_ecrit_verbatim_meme_ligne_vide() {
    let racine = match RacineJetable::nouveau("soutien-verif-jsonl") {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racine = racine.partage();
    let magasin = match MagasinJsonl::nouveau(&racine, "jsonl/pi/agent-2/version-1/faux.jsonl") {
        Ok(magasin) => magasin,
        Err(cause) => panic!("magasin refusé : {cause}"),
    };
    match magasin.ajoute_lignes(&["{\"type\":\"message\",\"id\":\"a-0-u\"}", ""]) {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let lu = match fs::read_to_string(magasin.chemin()) {
        Ok(texte) => texte,
        Err(cause) => panic!("relecture refusée : {cause}"),
    };
    assert!(
        lu == "{\"type\":\"message\",\"id\":\"a-0-u\"}\n\n",
        "les lignes sont écrites verbatim, la vide comprise — lecture : {lu}"
    );
}

#[test]
fn un_magasin_sqlite_est_un_vrai_sqlite() {
    let racine = match RacineJetable::nouveau("soutien-verif-sqlite") {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racine = racine.partage();
    let magasin = match MagasinSqlite::nouveau(&racine, "sqlite/devin/agent-3/version-3/faux.db") {
        Ok(magasin) => magasin,
        Err(cause) => panic!("magasin refusé : {cause}"),
    };
    match magasin.execute(
        "CREATE TABLE faux (id INTEGER PRIMARY KEY, note TEXT NOT NULL);\n\
         INSERT INTO faux (note) VALUES ('un'), ('deux');",
    ) {
        Ok(()) => (),
        Err(cause) => panic!("script SQL refusé : {cause}"),
    }
    let conn = match magasin.connexion() {
        Ok(conn) => conn,
        Err(cause) => panic!("connexion refusée : {cause}"),
    };
    let nombre = match conn.query_row("SELECT COUNT(*) FROM faux", [], |row| row.get::<_, i64>(0)) {
        Ok(nombre) => nombre,
        Err(cause) => panic!("lecture refusée : {cause}"),
    };
    assert!(
        nombre == 2,
        "deux lignes relues depuis le vrai fichier SQLite, pas {nombre}"
    );
}
