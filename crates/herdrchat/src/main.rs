//! Le démon herdr-remote (T056).
//!
//! ⚠️ **Ce binaire refuse de démarrer à moitié.** Quatre ports sur cinq sont
//! composés (contrôle Herdr, catalogues, artefacts, notifications) ; `sessions`
//! manque encore, et c'est le gros morceau (lecteurs par famille, curseurs,
//! bornage). Plutôt que de servir des conversations inventées, le démon
//! s'arrête avec la liste de ce qui manque — un `main` qui « marche » sans
//! adaptateur serait le mensonge le plus coûteux de la migration.
//!
//! La **composition** (`composition::services`) et le **cycle de vie**
//! (`cycle::sert`) sont, eux, complets et testés : dès que les adaptateurs
//! existent, `main` les branche ici, sans rien réécrire.

use herdrchat::composition::ManquePort;
use herdrchat::config::{Config, config_depuis};
use herdrchat::cycle::{Arret, Declencheur, ErreurDemarrage};
use std::collections::HashMap;
use std::sync::Arc;

/// Les ports que le binaire doit recevoir pour servir l'API.
///
/// ⚠️ **Contrôle, catalogues, artefacts et notifications sont composés** ;
/// `sessions` reste, et c'est le gros morceau (lecteurs par famille, curseurs,
/// bornage). La liste est la source de vérité du refus : elle rétrécit à
/// mesure que les adaptateurs arrivent, et elle ne ment jamais sur ce qui
/// manque.
const PORTS_ATTENDUS: [&str; 1] = ["sessions (sessions)"];

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
    // 1) Le contrôle : un socket absent est une cause RÉELLE, dite.
    let controle =
        herdr_client::port::PortHerdr::connecte(&config.herdr_socket_path).map_err(|cause| {
            format!(
                "Herdr injoignable ({}): {cause}",
                config.herdr_socket_path.display()
            )
        })?;
    // 2) Les catalogues partagent le MÊME socket (un client, un verrou) ; la
    //    découverte d'intégrations est une entrée fournie par la composition.
    let client = controle.client();
    let integrations: catalog::port::SourceIntegrations = Arc::new(move || {
        // ⚠️ L'`Arc` doit vivre le temps du verrou : un `Arc::clone(&client)`
        // temporaire serait détruit à la fin de l'expression, et le garde
        // emprunterait un mort.
        let partage = Arc::clone(&client);
        let mut garde = partage
            .lock()
            .map_err(|_| String::from("client Herdr empoisonné"))?;
        garde.integrations().map_err(|cause| cause.to_string())
    });
    let _catalogues = catalog::port::PortCatalogue::nouveau(
        Arc::new(catalog::cache::CacheCatalogues::nouveau()),
        integrations,
    );
    // 3) Les artefacts : confinés aux racines de CHAQUE requête.
    let _artefacts = files::port::PortArtefacts::nouveau();
    // 4) Les notifications : le store compatible, à côté du journal.
    let _notifications = notifications::port::PortNotifications::nouveau(Arc::new(
        notifications::store::GardienDeStore::nouveau(config.push_store_path.clone(), None),
    ));
    // 5) `sessions` n'a pas encore d'adaptateur : le démon refuse de servir
    //    une API dont la lecture de conversation manquerait.
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
