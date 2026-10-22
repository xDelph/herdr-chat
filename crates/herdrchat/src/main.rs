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

use herdrchat::config::{Config, config_depuis};
use herdrchat::cycle::{Arret, Declencheur, ErreurDemarrage};
use std::collections::HashMap;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    // `--version` : la seule commande qui ne démarre rien. Elle existe pour que
    // l'installation (formule Homebrew, service) puisse vérifier le binaire
    // sans lui demander d'écouter sur un port — et sans Bun, sans Node.
    if std::env::args().any(|argument| argument == "--version") {
        println!("herdrchat {}", env!("CARGO_PKG_VERSION"));
        return;
    }
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
    if let Err(cause) = demarre(&config).await {
        eprintln!("{cause}");
        std::process::exit(1);
    }
}

/// Le démarrage — refusé tant que les adaptateurs ne sont pas composés.
///
/// Le refus est **nomme** : il dit exactement quels ports manquent, et il ne
/// cree aucun socket, n'ecrit aucun journal, ne lance aucun worker.
async fn demarre(config: &Config) -> Result<(), String> {
    // 1) Le contrôle : un socket absent est une cause RÉELLE, dite.
    let controle =
        herdr_client::port::PortHerdr::connecte(&config.herdr_socket_path).map_err(|cause| {
            format!(
                "Herdr injoignable ({}): {cause}",
                config.herdr_socket_path.display()
            )
        })?;
    // 2) La découverte d'intégrations est une entrée fournie par la
    //    composition. Elle passe par le MÊME port que le reste : le port prête
    //    un client le temps de l'appel (chaque demande ouvre sa connexion), au
    //    lieu d'un verrou unique qui sérialisait tous les appels du démon.
    let controle: Arc<herdr_client::port::PortHerdr> = Arc::new(controle);
    let pour_integrations = Arc::clone(&controle);
    // Le port de contrôle vu par les handlers : le même objet, derrière son trait.
    let controle_port: Arc<dyn application::ports::ControlPort> = Arc::clone(&controle) as _;
    let integrations: catalog::port::SourceIntegrations = Arc::new(move || {
        pour_integrations
            .integrations()
            .map_err(|cause| cause.to_string())
    });
    let catalogue: Arc<dyn application::ports::CatalogPort> =
        Arc::new(catalog::port::PortCatalogue::nouveau(
            Arc::new(catalog::cache::CacheCatalogues::nouveau()),
            integrations,
        ));
    // 3) Les artefacts : confinés aux racines de CHAQUE requête.
    let artefacts = Arc::new(files::port::PortArtefacts::nouveau());
    // 4) Les notifications : le store compatible, à côté du journal.
    let notifications = Arc::new(notifications::port::PortNotifications::nouveau(Arc::new(
        notifications::store::GardienDeStore::nouveau(config.push_store_path.clone(), None),
    )));
    // 5) Les sessions : les racines de la configuration, lues par les
    //    lecteurs par famille.
    let port_sessions: Arc<dyn application::ports::SessionPort> = Arc::new(
        sessions::port::PortSessions::nouveau(sessions::resolver::Racines {
            claude_projects: config
                .session_roots
                .first()
                .cloned()
                .unwrap_or_else(|| config.codex_home.clone()),
            codex_home: config.codex_home.clone(),
            codex_sessions: config.codex_home.clone(),
            devin_db: config.devin_db_path.clone(),
            opencode_db: config.opencode_db_path.clone(),
        }),
    );

    // 6) Les Services du routeur : les ports entrent, le monde sort.
    let maintenant: Arc<dyn application::refresh::SourceMaintenant> =
        Arc::new(application::refresh::MaintenantReelle);
    let ports = herdrchat::composition::Ports {
        controle: Arc::clone(&controle_port),
        sessions: Arc::clone(&port_sessions),
        catalogue: Arc::clone(&catalogue),
        artefacts: Arc::clone(&artefacts) as Arc<dyn application::ports::ArtifactPort>,
        notifications: Some(
            Arc::clone(&notifications) as Arc<dyn application::ports::NotificationPort>
        ),
        resout: Arc::new(herdrchat::assemblage::ResoutSessionsViaPort {
            port: Arc::clone(&port_sessions),
        }),
        lit_sessions: Arc::new(herdrchat::assemblage::LitSessionsViaPort {
            port: Arc::clone(&port_sessions),
            familles: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            fenetres: Arc::new(std::sync::Mutex::new(
                herdrchat::assemblage::CacheFenetres::default(),
            )),
        }),
        types: Arc::new(herdrchat::assemblage::TypesViaCatalogue {
            port: Arc::clone(&catalogue),
        }),
        branche: Arc::new(herdrchat::assemblage::lecteur_de_branches(Arc::clone(
            &maintenant,
        ))),
        args: herdrchat::assemblage::constructeur_d_args(),
    };
    // 7) Le journal des diagnostics : le vrai, à côté des données.
    let diagnostics = Arc::new(herdrchat::logging::Journal::nouveau(
        config.log_path.clone(),
    ));
    let services = Arc::new(herdrchat::composition::services(
        config,
        ports,
        herdrchat::composition::direct(),
        diagnostics,
        Arc::new(herdrchat::assets::AssetsEmbarques),
    ));
    /*
      ⚠️ **La veille démarre AVANT le routeur, et elle manquait totalement.**
      Sans elle, le démon ne publiait jamais `agent_status` ni
      `session_changed` : la PWA retombait sur son filet (30 s / 120 s), donc
      ni statut en direct, ni message en direct — même écran ouvert.
    */
    let mut veille =
        herdrchat::veille::Veille::demarre(Arc::clone(&services), Arc::clone(&maintenant));
    // 8) Le routeur, l'écoute et le cycle de vie.
    let adresse = format!("{}:{}", config.hostname, config.port);
    let adresse: std::net::SocketAddr = adresse
        .parse()
        .map_err(|cause| format!("adresse invalide ({adresse}): {cause}"))?;
    let ecouteur = herdrchat::cycle::ecoute(adresse)
        .await
        .map_err(|erreur| erreur.to_string())?;
    let (declencheur, arret) = herdrchat::cycle::Declencheur::nouveau();
    // ⚠️ Le déclencheur est DÉPLACÉ dans la tâche de signaux : il n'est pas
    // clonable, et c'est voulu (un seul point demande l'arrêt).
    tokio::spawn(async move {
        herdrchat::cycle::signaux().await;
        declencheur.demande();
    });
    let routeur = http_api::router::routeur(services, config.origines_publiques.clone());
    let rapport = herdrchat::cycle::sert(
        ecouteur,
        routeur,
        Arc::new(herdrchat::cycle::EnCours::nouveau()),
        Arc::new(herdrchat::cycle::Taches::nouveau()),
        Arc::new(herdrchat::logging::Journal::nouveau(
            config.log_path.clone(),
        )),
        arret,
        herdrchat::cycle::DELAI_DRAIN,
    )
    .await;
    // La veille s'arrête avec le serveur : un fil qui interroge Herdr après la
    // fermeture du socket d'écoute serait un résidu.
    veille.arrete();
    if rapport.drain_interrompu {
        eprintln!(
            "arrêt : {} requête(s) coupée(s) après le délai de drain",
            rapport.requetes_coupees
        );
    }
    Ok(())
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
