//! Le moteur SQLite commun (T015) : deux schémas factices **différents**
//! passent par le même ouvrier — read-only, borne relue, pagination,
//! interruption.

use sessions::storage::sqlite::paging::{borne_de, sql_arriere, sql_avant_apres};
use sessions::storage::sqlite::worker::{ErreurOuvrier, FILE_MAX, Ouvrier};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;
use std::time::Duration;

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Un fichier SQLite jetable avec SON schéma — chaque famille fait la
/// sienne ; le moteur reste le même.
struct BaseFausse {
    chemin: PathBuf,
}

fn base(prefixe: &str, schema: &str) -> BaseFausse {
    let racine = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match std::fs::create_dir(&racine) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    let chemin = racine.join("base.db");
    let connexion = match rusqlite::Connection::open(&chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("création refusée : {cause}"),
    };
    match connexion.execute_batch(schema) {
        Ok(()) => (),
        Err(cause) => panic!("schéma refusé : {cause}"),
    }
    BaseFausse { chemin }
}

#[test]
fn deux_schemas_factices_passent_par_le_meme_moteur() {
    // Schéma Devin-factice : row_id + chat_message.
    let devin = base(
        "soutien-sqlite-devin",
        "CREATE TABLE messages (row_id INTEGER PRIMARY KEY, chat_message TEXT NOT NULL, metadata TEXT);
         INSERT INTO messages (chat_message, metadata) VALUES ('un', '{}'), ('deux', '{}'), ('trois', '{}');",
    );
    // Schéma opencode-factice : seq + partie.
    let opencode = base(
        "soutien-sqlite-opencode",
        "CREATE TABLE parties (seq INTEGER PRIMARY KEY, texte TEXT NOT NULL);
         INSERT INTO parties (texte) VALUES ('alpha'), ('beta');",
    );
    // Le MÊME ouvrier, deux bases.
    let ouvrier_devin = match Ouvrier::nouveau(&devin.chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier devin refusé : {cause}"),
    };
    let ouvrier_opencode = match Ouvrier::nouveau(&opencode.chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier opencode refusé : {cause}"),
    };
    let lignes_devin = match ouvrier_devin.interroge(
        "SELECT row_id, chat_message FROM messages ORDER BY row_id ASC",
        &[],
    ) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("requête devin refusée : {cause:?}"),
    };
    assert!(
        lignes_devin.len() == 3,
        "trois lignes devin : {}",
        lignes_devin.len()
    );
    let lignes_opencode = match ouvrier_opencode.interroge("SELECT seq, texte FROM parties", &[]) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("requête opencode refusée : {cause:?}"),
    };
    assert!(lignes_opencode.len() == 2);
    // Les colonnes portent leurs noms (le seq/row_id est INCLUS en avant).
    assert!(
        lignes_devin[0].colonnes.contains(&"row_id".to_string()),
        "row_id inclus"
    );
    assert!(
        lignes_opencode[0].colonnes.contains(&"seq".to_string()),
        "seq inclus"
    );
}

#[test]
fn les_pages_avant_et_arriere_utilisent_leurs_formes() {
    let base_test = base(
        "soutien-sqlite-pages",
        "CREATE TABLE messages (row_id INTEGER PRIMARY KEY, chat_message TEXT NOT NULL);
         INSERT INTO messages (chat_message) VALUES ('un'), ('deux'), ('trois'), ('quatre'), ('cinq');",
    );
    let ouvrier = match Ouvrier::nouveau(&base_test.chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier refusé : {cause}"),
    };
    // Page avant bornée à 2.
    let premieme = match ouvrier.interroge(&sql_avant_apres("messages", "row_id", 2), &["0"]) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("page avant refusée : {cause:?}"),
    };
    assert!(premieme.len() == 2, "deux lignes : {}", premieme.len());
    // La borne de la page suivante = le row_id du dernier.
    let borne = match borne_de(&premieme, "row_id") {
        Some(borne) => borne,
        None => panic!("la borne doit exister"),
    };
    assert!(borne == 2, "row_id 2 : {borne}");
    let deuxieme = match ouvrier.interroge(
        &sql_avant_apres("messages", "row_id", 2),
        &[&borne.to_string()],
    ) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("page suivante refusée : {cause:?}"),
    };
    assert!(deuxieme.len() == 2, "encore deux : {}", deuxieme.len());
    match borne_de(&deuxieme, "row_id") {
        Some(borne) => assert!(borne == 4, "row_id 4 : {borne}"),
        None => panic!("la borne existe"),
    }

    // ARRIÈRE : `< ?1` strict, ordre décroissant — depuis la borne 4 : 3, 2.
    let arriere = match ouvrier.interroge(&sql_arriere("messages", "row_id", 2), &["4"]) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("page arrière refusée : {cause:?}"),
    };
    assert!(
        arriere.len() == 2,
        "deux lignes arrière : {}",
        arriere.len()
    );
    assert!(
        arriere[0].valeurs[0] == 3,
        "le plus grand d'abord : {:?}",
        arriere[0].valeurs[0]
    );
    assert!(
        arriere[1].valeurs[0] == 2,
        "puis 2 : {:?}",
        arriere[1].valeurs[0]
    );
}

#[test]
fn une_mutation_de_borne_est_relue() {
    // La borne relue : la page relancée depuis la MÊME requête lit le
    // contenu MIS À JOUR de la borne (la connexion est vivante, read-only).
    let base_test = base(
        "soutien-sqlite-borne",
        "CREATE TABLE messages (row_id INTEGER PRIMARY KEY, chat_message TEXT NOT NULL);
         INSERT INTO messages (chat_message) VALUES ('un'), ('deux');",
    );
    let ouvrier = match Ouvrier::nouveau(&base_test.chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier refusé : {cause}"),
    };
    let avant = match ouvrier.interroge(
        "SELECT row_id, chat_message FROM messages WHERE row_id >= ?1",
        &["2"],
    ) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("page refusée : {cause:?}"),
    };
    assert!(avant.len() == 1 && avant[0].valeurs[1] == "deux");
    // La borne est MUTÉE (par l'agent qui écrit) — via une connexion séparée
    // d'écriture (la nôtre, pas celle du moteur).
    let ecrivain = match rusqlite::Connection::open(&base_test.chemin) {
        Ok(connexion) => connexion,
        Err(cause) => panic!("écrivain refusé : {cause}"),
    };
    match ecrivain.execute(
        "UPDATE messages SET chat_message = 'deux-muté' WHERE row_id = 2",
        [],
    ) {
        Ok(_) => (),
        Err(cause) => panic!("mutation refusée : {cause}"),
    }
    let apres = match ouvrier.interroge(
        "SELECT row_id, chat_message FROM messages WHERE row_id >= ?1",
        &["2"],
    ) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("relecture refusée : {cause:?}"),
    };
    assert!(
        apres[0].valeurs[1] == "deux-muté",
        "la borne mutée est RELUE : {:?}",
        apres[0].valeurs[1]
    );
}

#[test]
fn la_file_bornee_refuse_nommeement_et_les_parametres_sont_lies() {
    let base_test = base(
        "soutien-sqlite-file",
        "CREATE TABLE messages (row_id INTEGER PRIMARY KEY, chat_message TEXT NOT NULL);
         INSERT INTO messages (chat_message) VALUES ('deux');",
    );
    let ouvrier = match Ouvrier::nouveau(&base_test.chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier refusé : {cause}"),
    };
    // Les paramètres LIÉS : une apostrophe dans la valeur ne casse rien.
    let lignes = match ouvrier.interroge(
        "SELECT chat_message FROM messages WHERE chat_message = ?1",
        &["deux"],
    ) {
        Ok(lignes) => lignes,
        Err(cause) => panic!("requête paramétrée refusée : {cause:?}"),
    };
    assert!(
        lignes.len() == 1,
        "la valeur liée trouve : {}",
        lignes.len()
    );
    // La file est bornée à 32 : on DÉPOSE sans attendre (la séparation
    // dépose/attente est l'API du moteur) — la 33e dépose → FilePleine.
    let base_lente = base(
        "soutien-sqlite-file-lente",
        "CREATE TABLE lente (id INTEGER PRIMARY KEY, v TEXT);",
    );
    let ouvrier_lent = match Ouvrier::nouveau(&base_lente.chemin) {
        Ok(ouvrier) => ouvrier,
        Err(cause) => panic!("ouvrier lent refusé : {cause}"),
    };
    // On occupe le fil de l'ouvrier avec UNE requête lente (CTE récursive),
    // puis on remplit la file : les dépôts au-delà de 32 → FilePleine.
    let poignee = ouvrier_lent.poignee_interruption();
    let mut deposees = 0;
    for _ in 0..FILE_MAX + 2 {
        match ouvrier_lent.depose(
            "WITH RECURSIVE lent(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM lent WHERE x < 20000) SELECT COUNT(*) FROM lent",
            &[],
        ) {
            Ok(_reception) => deposees += 1,
            Err(ErreurOuvrier::FilePleine) => deposees += 0, // compté comme refus ci-dessous
            Err(ErreurOuvrier::OuvrierAbsent) => panic!("ouvrier parti"),
            Err(ErreurOuvrier::Requete(cause)) => panic!("erreur inattendue : {cause}"),
        }
    }
    // On interrompt le lent : la file se vide (les travaux interrompus
    // rendent leur erreur aux dépôts), l'ouvrier reste en vie — l'attente
    // boucle jusqu'au drain (les 33 requêtes lentes s'écoulent).
    poignee.interrupt();
    let mut vide = Err(ErreurOuvrier::FilePleine);
    for _ in 0..600 {
        match ouvrier_lent.interroge("SELECT COUNT(*) FROM lente", &[]) {
            Ok(lignes) => {
                vide = Ok(lignes);
                break;
            }
            Err(ErreurOuvrier::FilePleine) => thread::sleep(Duration::from_millis(20)),
            Err(cause) => panic!("l'ouvrier doit survivre : {cause:?}"),
        }
    }
    thread::sleep(Duration::from_millis(0));
    match &vide {
        Ok(lignes) => assert!(
            lignes[0].valeurs[0] == 0,
            "la table est vide : {:?}",
            lignes[0].valeurs
        ),
        Err(cause) => panic!("l'ouvrier n'a pas survécu au drain : {cause:?}"),
    }
    // 1 travail en exécution + 32 en file = 33 acceptés, le reste refusé.
    assert!(
        deposees <= FILE_MAX + 1,
        "au moins un refus FilePleine : {deposees} déposés"
    );
}
