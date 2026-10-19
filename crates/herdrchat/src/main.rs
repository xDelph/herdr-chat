//! Le démon herdr-remote (T056).
//!
//! ⚠️ **Ce binaire refuse de démarrer à moitié.** Les cinq ports d'I/O
//! (contrôle Herdr, sessions, catalogue, artefacts, notifications) ne sont
//! pas encore adaptés aux crates qui les implémentent (T028–T033 + un suivi
//! de T056) : plutôt que de servir des valeurs inventées, le démon s'arrête
//! avec la liste de ce qui manque. Un `main` qui « marche » sans adaptateur
//! serait le mensonge le plus coûteux de la migration.
//!
//! La **composition** (`composition::services`) et le **cycle de vie**
//! (`cycle::sert`) sont, eux, complets et testés : dès que les adaptateurs
//! existent, `main` les branche ici, sans rien réécrire.

use herdrchat::composition::ManquePort;
use herdrchat::config::{Config, config_depuis};
use herdrchat::cycle::{Arret, Declencheur, ErreurDemarrage};
use std::collections::HashMap;

/// Les ports que le binaire doit recevoir pour servir l'API.
///
/// ⚠️ Le **contrôle** est composé (T056 suite) ; les quatre autres attendent
/// leurs adaptateurs. La liste reste la source de vérité du refus : elle
/// rétrécit à mesure que les adaptateurs arrivent, et elle ne ment jamais sur
/// ce qui manque.
const PORTS_ATTENDUS: [&str; 4] = [
    "sessions (sessions)",
    "catalog (catalog)",
    "artifacts (files)",
    "notifications (notifications)",
];

fn main() {
    let environnement: HashMap<String, String> = std::env::vars().collect();
    let maison = environnement
        .get("HOME")
        .cloned()
        .unwrap_or_else(|| String::from("/"));
    let config = match config_depuis(&environnement, std::path::Path::new(&maison)) {
        Ok(config) => config,
        Err(erreur) => {
            eprintln!("configuration invalide : {}", erreur.detail);
            std::process::exit(1);
        }
    };
    if let Err(cause) = demarre(&config) {
        eprintln!("{cause}");
        std::process::exit(1);
    }
}

/// Le démarrage — refusé tant que les adaptateurs ne sont pas composés.
///
/// Le refus est **nomme** : il dit exactement quels ports manquent, et il ne
/// cree aucun socket, n'ecrit aucun journal, ne lance aucun worker.
fn demarre(config: &Config) -> Result<(), String> {
    // 1) Le port de contrôle : la seule chose qui peut être composée
    //    aujourd'hui. Un socket absent est une cause RÉELLE, dite.
    let _controle =
        herdr_client::port::PortHerdr::connecte(&config.herdr_socket_path).map_err(|cause| {
            format!(
                "Herdr injoignable ({}): {cause}",
                config.herdr_socket_path.display()
            )
        })?;
    // 2) Les quatre autres ports n'ont pas encore d'adaptateur : le démon
    //    refuse de servir une API à moitié câblée.
    Err(ManquePort {
        ports: PORTS_ATTENDUS.to_vec(),
    }
    .to_string())
}

/// Les elements du cycle de vie, exposes pour que le cablage final (quand les
/// adaptateurs existeront) n'ait qu'a les appeler — et pour que les tests
/// puissent les verifier sans binaire.
#[allow(dead_code)]
pub struct Cycle {
    pub declencheur: Declencheur,
    pub arret: Arret,
}

/// Prepare le cycle : l'arret est declenche par `SIGINT`/`SIGTERM`.
#[allow(dead_code)]
pub fn prepare_cycle() -> Cycle {
    let (declencheur, arret) = Declencheur::nouveau();
    Cycle { declencheur, arret }
}

/// Les erreurs de démarrage que `main` sait traduire en message utilisateur.
#[allow(dead_code)]
pub fn decrit(erreur: &ErreurDemarrage) -> String {
    erreur.to_string()
}
