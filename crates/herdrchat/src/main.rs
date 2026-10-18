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
const PORTS_ATTENDUS: [&str; 5] = [
    "control (herdr-client)",
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
    if let Err(manque) = demarre(&config) {
        eprintln!("{manque}");
        std::process::exit(1);
    }
}

/// Le démarrage — refusé tant que les adaptateurs ne sont pas composés.
///
/// Le refus est **nomme** : il dit exactement quels ports manquent, et il ne
/// cree aucun socket, n'ecrit aucun journal, ne lance aucun worker.
fn demarre(_config: &Config) -> Result<(), ManquePort> {
    Err(ManquePort {
        ports: PORTS_ATTENDUS.to_vec(),
    })
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
