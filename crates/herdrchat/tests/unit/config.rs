//! La configuration du démon (T048, C10) : origines Serve normalisées,
//! bind/port stricts, matrice des 17 variables, argv exact de la CLI —
//! contre les fixtures réelles du fil, aucun tailnet.
//!
//! ⚠️ La référence (config.ts) écoute sur le loopback par défaut
//! (`127.0.0.1`) ; les docs écrivent « [IP_ADDRESS] » par convention. Ici,
//! les valeurs sont celles du CODE.
//! Prouve : O02, S01.

use herdrchat::config::{
    Config, ErreurConfig, LanceStatutServe, PORT_DEFAUT, config_depuis_avec, est_range_tailnet,
    hote_url, origines_de_serve, origines_tailscale_avec, resolve_tailscale_bin,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

const PORT: u16 = 8791;

/// La sortie réelle de `tailscale serve status --json` (2026-10-15) : deux
/// services — le nôtre sur 8790, `print-cost-report` sur 8765. Autoriser
/// les deux élargirait la porte, et un test le refuse.
fn reel() -> Value {
    json!({
        "TCP": { "8765": { "HTTPS": true }, "8790": { "HTTPS": true } },
        "Web": {
            "macbook-pro-de-thomas.tailae2442.ts.net:8765": {
                "Handlers": { "/": { "Proxy": "http://127.0.0.1:8765" } }
            },
            "macbook-pro-de-thomas.tailae2442.ts.net:8790": {
                "Handlers": { "/": { "Proxy": "http://127.0.0.1:8791" } }
            }
        }
    })
}

fn serve(proxy: &str, hote_port: &str) -> Value {
    json!({ "Web": { hote_port: { "Handlers": { "/": { "Proxy": proxy } } } } })
}

fn env_dep() -> HashMap<String, String> {
    HashMap::new()
}

#[test]
fn le_port_443_est_omis_de_l_origine() {
    // C'est la ligne qui était fausse : avec « …:443 », toute la PWA
    // répondait 403 sur une installation par défaut.
    let defaut = json!({
        "TCP": { "443": { "HTTPS": true } },
        "Web": { "machine.tailnet.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:8791" } } } }
    });
    assert_eq!(
        origines_de_serve(&defaut, PORT),
        ["https://machine.tailnet.ts.net"]
    );

    let explicite = serve("http://127.0.0.1:8791", "machine.ts.net:8790");
    assert_eq!(
        origines_de_serve(&explicite, PORT),
        ["https://machine.ts.net:8790"]
    );

    let autre = serve("http://127.0.0.1:8791", "machine.ts.net:8443");
    assert_eq!(
        origines_de_serve(&autre, PORT),
        ["https://machine.ts.net:8443"]
    );

    // Un hôte sans port est accepté.
    let sans_port = serve("http://127.0.0.1:8791", "machine.ts.net");
    assert_eq!(
        origines_de_serve(&sans_port, PORT),
        ["https://machine.ts.net"]
    );

    // Une adresse IPv6 entre crochets perd aussi son port 443.
    let ipv6 = serve("http://[::1]:8791", "[fd7a:115c:a1e0::1]:443");
    assert_eq!(
        origines_de_serve(&ipv6, PORT),
        ["https://[fd7a:115c:a1e0::1]"]
    );
}

#[test]
fn seul_notre_backend_est_autorise() {
    // Le test qui compte pour la sécurité : la machine sert aussi
    // `print-cost-report` — autoriser son origine n'aurait aucun sens.
    assert_eq!(
        origines_de_serve(&reel(), PORT),
        ["https://macbook-pro-de-thomas.tailae2442.ts.net:8790"]
    );
    // La règle suit le PROXY, pas le nom de l'hôte.
    assert_eq!(
        origines_de_serve(&reel(), 8765),
        ["https://macbook-pro-de-thomas.tailae2442.ts.net:8765"]
    );
    // Un port voisin ne suffit pas.
    assert_eq!(
        origines_de_serve(&serve("http://127.0.0.1:8792", "machine.ts.net:443"), PORT),
        Vec::<String>::new()
    );
    // Une autre machine ne suffit pas : un proxy vers un hôte non local
    // n'est jamais notre backend.
    assert_eq!(
        origines_de_serve(
            &serve("http://machine-lointaine:8791", "autre.ts.net:443"),
            PORT
        ),
        Vec::<String>::new()
    );
    // Aucun service : aucune origine.
    assert_eq!(
        origines_de_serve(&json!({ "TCP": { "443": { "HTTPS": true } } }), PORT),
        Vec::<String>::new()
    );
}

#[test]
fn il_suffit_qu_un_seul_chemin_vise_notre_backend() {
    let statut = json!({
        "Web": {
            "machine.ts.net:443": {
                "Handlers": {
                    "/autre": { "Proxy": "http://127.0.0.1:9000" },
                    "/": { "Proxy": "http://127.0.0.1:8791" }
                }
            }
        }
    });
    assert_eq!(origines_de_serve(&statut, PORT), ["https://machine.ts.net"]);
}

#[test]
fn la_cible_est_comparee_par_hote_et_par_port() {
    // `localhost` est accepté comme le loopback — Serve rapporte la cible
    // telle qu'elle a été écrite.
    assert_eq!(
        origines_de_serve(
            &serve("http://localhost:8791", "machine.tailnet.ts.net:443"),
            PORT
        ),
        ["https://machine.tailnet.ts.net"]
    );
    // Une barre finale ne change rien.
    assert_eq!(
        origines_de_serve(
            &serve("http://127.0.0.1:8791/", "machine.tailnet.ts.net:443"),
            PORT
        ),
        ["https://machine.tailnet.ts.net"]
    );
    // Une cible illisible est écartée, pas devinée.
    assert_eq!(
        origines_de_serve(&serve("pas-une-url", "machine.ts.net:443"), PORT),
        Vec::<String>::new()
    );
    // Une cible sans port est écartée.
    assert_eq!(
        origines_de_serve(&serve("http://127.0.0.1", "machine.ts.net:443"), PORT),
        Vec::<String>::new()
    );
}

#[test]
fn un_releve_illisible_ne_fait_pas_tomber_le_demarrage() {
    assert_eq!(origines_de_serve(&json!({}), PORT), Vec::<String>::new());
    assert_eq!(
        origines_de_serve(&Value::String("pas-un-objet".into()), PORT),
        Vec::<String>::new()
    );
    assert_eq!(origines_de_serve(&Value::Null, PORT), Vec::<String>::new());
    let mains_vides = json!({ "Web": { "machine.ts.net:443": { "Handlers": {} } } });
    assert_eq!(origines_de_serve(&mains_vides, PORT), Vec::<String>::new());
    let sans_proxy = json!({ "Web": { "machine.ts.net:443": { "Handlers": { "/": {} } } } });
    assert_eq!(origines_de_serve(&sans_proxy, PORT), Vec::<String>::new());
}

#[test]
fn l_hote_d_ecoute_est_mis_en_forme_pour_une_url() {
    assert_eq!(hote_url("127.0.0.1"), "127.0.0.1");
    assert_eq!(hote_url("fd7a:115c:a1e0::1"), "[fd7a:115c:a1e0::1]");
    assert_eq!(hote_url("[fd7a:115c:a1e0::1]"), "[fd7a:115c:a1e0::1]");
    assert_eq!(hote_url("localhost"), "localhost");
}

#[test]
fn les_plages_tailnet_parcees_remplacent_les_prefixes() {
    use std::net::IpAddr;
    // Dans 100.64.0.0/10 : 100.64.0.1 – 100.127.255.254.
    assert!(est_range_tailnet(IpAddr::from([100, 64, 0, 1])));
    assert!(est_range_tailnet(IpAddr::from([100, 127, 255, 254])));
    // Hors de la plage : 100.1.1.1 passait le préfixe textuel du fil
    // (« 100. »), la plage PARCÉE le refuse (C10).
    assert!(!est_range_tailnet(IpAddr::from([100, 1, 1, 1])));
    // Wildcard et adresses publiques/privées : jamais.
    assert!(!est_range_tailnet(IpAddr::from([0, 0, 0, 0])));
    assert!(!est_range_tailnet(IpAddr::from([192, 168, 1, 1])));
    assert!(!est_range_tailnet(IpAddr::from([8, 8, 8, 8])));
    // fd7a:115c:a1e0::/48.
    assert!(est_range_tailnet(
        "fd7a:115c:a1e0::1"
            .parse::<IpAddr>()
            .unwrap_or_else(|cause| panic!("ipv6 : {cause}"))
    ));
    assert!(!est_range_tailnet(
        "fd7a:9999::1"
            .parse::<IpAddr>()
            .unwrap_or_else(|cause| panic!("ipv6 : {cause}"))
    ));
    assert!(!est_range_tailnet(
        "::1"
            .parse::<IpAddr>()
            .unwrap_or_else(|cause| panic!("ipv6 : {cause}"))
    ));
}

/// AUCUNE CLI réelle : le stub répond « absent » — les tests ne touchent
/// jamais au tailnet de la machine.
struct SansTailscale;

impl LanceStatutServe for SansTailscale {
    fn lance(&self, _argv: &[&str], _delai: Duration) -> Result<String, String> {
        Err(String::from("claude pas de CLI dans les tests"))
    }
}

fn configue(env: &mut HashMap<String, String>) -> Config {
    let home = Path::new("/foyer");
    config_depuis_avec(env, home, &SansTailscale)
        .unwrap_or_else(|cause| panic!("config : {cause:?}"))
}

#[test]
fn les_valeurs_par_defaut_sont_exactes() {
    let config = configue(&mut env_dep());
    assert_eq!(
        config.herdr_socket_path,
        Path::new("/foyer/.config/herdr/herdr.sock")
    );
    assert_eq!(
        config.session_roots.pi,
        Path::new("/foyer/.pi/agent/sessions")
    );
    assert_eq!(
        config.session_roots.codex,
        Path::new("/foyer/.codex/sessions")
    );
    assert_eq!(
        config.session_roots.claude,
        Path::new("/foyer/.claude/projects")
    );
    assert_eq!(config.port, PORT_DEFAUT);
    assert_eq!(config.hostname, "127.0.0.1");
    assert_eq!(
        config.opencode_db_path,
        Path::new("/foyer/.local/share/opencode/opencode.db")
    );
    assert_eq!(config.fenetre_deduplication_ms, 60_000);
    assert_eq!(
        config.log_path,
        Path::new("/foyer/.herdr-remote/herdr-remote.log")
    );
    assert_eq!(config.codex_home, Path::new("/foyer/.codex"));
    assert_eq!(
        config.devin_db_path,
        Path::new("/foyer/.local/share/devin/cli/sessions.db")
    );
    assert!(config.racines_fichiers_extra.is_empty());
    // Origines : locale toujours + rien d'autre (pas de tailnet configuré).
    assert_eq!(config.origines_publiques, ["http://127.0.0.1:8791"]);
}

#[test]
fn les_surcharges_sont_lues_et_la_precedence_tenue() {
    let mut env = env_dep();
    env.insert(
        String::from("HERDR_SOCKET_PATH"),
        String::from("/custom/socket.sock"),
    );
    env.insert(String::from("PI_SESSIONS_ROOT"), String::from("/pi"));
    env.insert(String::from("CODEX_SESSION_ROOT"), String::from("/codex"));
    env.insert(
        String::from("CLAUDE_PROJECTS_ROOT"),
        String::from("/claude"),
    );
    env.insert(String::from("OPENCODE_DB"), String::from("/db/opencode.db"));
    env.insert(
        String::from("HERDR_REMOTE_LOG_PATH"),
        String::from("/logs/app.log"),
    );
    env.insert(String::from("CODEX_HOME"), String::from("/codex-home"));
    env.insert(String::from("DEVIN_DB"), String::from("/db/devin.db"));
    env.insert(String::from("HERDR_REMOTE_PORT"), String::from("9000"));
    env.insert(
        String::from("HERDR_SOCKET"),
        String::from("/bus-agents.sock"),
    ); // DOIT rester ignorée
    let config = configue(&mut env);
    assert_eq!(config.herdr_socket_path, Path::new("/custom/socket.sock"));
    assert_eq!(config.port, 9000);
    assert_eq!(config.opencode_db_path, Path::new("/db/opencode.db"));
    assert_eq!(config.log_path, Path::new("/logs/app.log"));
    assert_eq!(config.codex_home, Path::new("/codex-home"));
    assert_eq!(config.devin_db_path, Path::new("/db/devin.db"));
    // HERDR_SOCKET n'a JAMAIS été lue : le socket reste celui de la couche A.
    assert!(
        env.contains_key("HERDR_SOCKET"),
        "l'environnement n'est pas modifié par la lecture"
    );
    assert_eq!(config.origines_publiques[0], "http://127.0.0.1:9000");
}

#[test]
fn le_pluriel_des_origines_prime_sur_le_singulier() {
    let mut env = env_dep();
    env.insert(
        String::from("HERDR_REMOTE_PUBLIC_ORIGINS"),
        String::from("https://a.example, https://b.example"),
    );
    env.insert(
        String::from("HERDR_REMOTE_PUBLIC_ORIGIN"),
        String::from("https://legacy.example"),
    );
    let config = configue(&mut env);
    assert!(
        config
            .origines_publiques
            .contains(&String::from("https://a.example"))
    );
    assert!(
        config
            .origines_publiques
            .contains(&String::from("https://b.example"))
    );
    assert!(
        !config
            .origines_publiques
            .contains(&String::from("https://legacy.example")),
        "le singulier est un REPLI, ignoré quand le pluriel est présent"
    );

    // Sans le pluriel, le singulier sert de repli.
    let mut env = env_dep();
    env.insert(
        String::from("HERDR_REMOTE_PUBLIC_ORIGIN"),
        String::from("https://legacy.example"),
    );
    let config = configue(&mut env);
    assert!(
        config
            .origines_publiques
            .contains(&String::from("https://legacy.example"))
    );
}

#[test]
fn le_port_est_strictement_decimal() {
    for invalide in ["0", "8791abc", "-1", "65536", "vingt", " 8791"] {
        let mut env = env_dep();
        env.insert(String::from("HERDR_REMOTE_PORT"), invalide.to_string());
        match config_depuis_avec(&env, Path::new("/foyer"), &SansTailscale) {
            Err(ErreurConfig { detail }) => {
                assert_eq!(
                    detail,
                    format!("HERDR_REMOTE_PORT invalide : « {invalide} »"),
                    "port « {invalide} » refusé"
                );
            }
            Ok(_) => panic!("port « {invalide} » doit être refusé"),
        }
    }
    for valide in ["1", "8791", "65535"] {
        let mut env = env_dep();
        env.insert(String::from("HERDR_REMOTE_PORT"), valide.to_string());
        assert_eq!(
            configue(&mut env).port,
            valide
                .parse::<u16>()
                .unwrap_or_else(|cause| panic!("u16 : {cause}"))
        );
    }
}

#[test]
fn le_bind_est_strict_et_tailnet_seulement() {
    // Wildcard, publique, privée, hors plage, non analyse : jamais.
    for refus in [
        "0.0.0.0",
        "192.168.1.1",
        "8.8.8.8",
        "100.1.1.1",
        "fd7a:9999::1",
        "::",
        "localhost",
        "pas-une-ip",
    ] {
        let mut env = env_dep();
        env.insert(String::from("HERDR_REMOTE_BIND"), refus.to_string());
        match config_depuis_avec(&env, Path::new("/foyer"), &SansTailscale) {
            Err(ErreurConfig { detail }) => {
                assert!(detail.contains("refusé"), "bind « {refus} » : {detail}");
            }
            Ok(_) => panic!("bind « {refus} » doit être refusé"),
        }
    }
    for accepte in [
        "127.0.0.1",
        "100.64.1.1",
        "100.127.0.1",
        "fd7a:115c:a1e0::1",
    ] {
        let mut env = env_dep();
        env.insert(String::from("HERDR_REMOTE_BIND"), accepte.to_string());
        let config = configue(&mut env);
        assert_eq!(config.hostname, accepte);
        assert!(
            accepte == "127.0.0.1"
                || config
                    .origines_publiques
                    .contains(&format!("http://{}:8791", hote_url(accepte))),
            "l'origine du tailnet direct est ajoutée pour {accepte}"
        );
    }
}

#[test]
fn l_argente_et_le_delai_de_la_cli_sont_ceux_du_fil() {
    struct FauxLanceur {
        argv_vu: std::sync::Mutex<Vec<String>>,
        delai_vu: std::sync::Mutex<Duration>,
        sortie: String,
    }
    impl herdrchat::config::LanceStatutServe for FauxLanceur {
        fn lance(&self, argv: &[&str], delai: Duration) -> Result<String, String> {
            *self
                .argv_vu
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                argv.iter().map(|a| String::from(*a)).collect();
            *self
                .delai_vu
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = delai;
            Ok(self.sortie.clone())
        }
    }
    let lanceur = FauxLanceur {
        argv_vu: std::sync::Mutex::new(Vec::new()),
        delai_vu: std::sync::Mutex::new(Duration::ZERO),
        sortie: reel().to_string(),
    };
    let origines = origines_tailscale_avec(PORT, &lanceur);
    assert_eq!(
        origines,
        ["https://macbook-pro-de-thomas.tailae2442.ts.net:8790"]
    );
    assert_eq!(
        *lanceur
            .argv_vu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        ["serve", "status", "--json"]
    );
    assert_eq!(
        *lanceur
            .delai_vu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        Duration::from_secs(5)
    );
}

#[test]
fn l_absence_de_la_cli_n_est_pas_une_erreur() {
    struct Absent;
    impl herdrchat::config::LanceStatutServe for Absent {
        fn lance(&self, _argv: &[&str], _delai: Duration) -> Result<String, String> {
            Err(String::from("introuvable"))
        }
    }
    assert_eq!(origines_tailscale_avec(PORT, &Absent), Vec::<String>::new());
    // Le chemin résolu est un chemin absolu connu OU le recours PATH —
    // selon la machine (Tailscale peut être installé ici).
    let chemin = resolve_tailscale_bin();
    assert!(
        chemin == "tailscale"
            || (chemin.starts_with('/') && std::path::Path::new(&chemin).exists()),
        "chemin résolu inattendu : {chemin}"
    );
}

#[test]
fn une_sortie_illisible_de_la_cli_ne_fait_pas_tomber_le_demarrage() {
    struct Bruit;
    impl herdrchat::config::LanceStatutServe for Bruit {
        fn lance(&self, _argv: &[&str], _delai: Duration) -> Result<String, String> {
            Ok(String::from("pas-du-json"))
        }
    }
    assert_eq!(origines_tailscale_avec(PORT, &Bruit), Vec::<String>::new());
}

#[test]
fn chaque_famille_recoit_sa_propre_racine_de_sessions() {
    // La composition prenait `session_roots.first()` pour Claude : la racine
    // Pi. Toutes les sessions Claude étaient « absentes ».
    let config = configue(&mut env_dep());
    let racines = herdrchat::assemblage::racines_de_sessions(&config);
    assert_eq!(racines.pi_sessions, Path::new("/foyer/.pi/agent/sessions"));
    assert_eq!(
        racines.claude_projects,
        Path::new("/foyer/.claude/projects")
    );
    assert_eq!(racines.codex_sessions, Path::new("/foyer/.codex/sessions"));
    assert_eq!(racines.codex_home, Path::new("/foyer/.codex"));
}

/// Le sujet VAPID (le `sub` de chaque JWT push) : explicite, puis première
/// origine HTTPS du PLURIEL, puis le `mailto:` du fil — jamais le défaut
/// `mailto:example@example.com` du crate `web-push`.
#[test]
fn le_sujet_vapid_suit_la_precedence_du_fil() {
    let mut env = env_dep();
    assert_eq!(
        configue(&mut env).vapid_sujet_resolu,
        "mailto:herdr-remote@example.com"
    );

    env.insert(
        String::from("HERDR_REMOTE_PUBLIC_ORIGINS"),
        String::from("http://100.64.0.2:8791, https://herdr.exemple.ts.net:8790"),
    );
    assert_eq!(
        configue(&mut env).vapid_sujet_resolu,
        "https://herdr.exemple.ts.net:8790"
    );

    env.insert(
        String::from("HERDR_REMOTE_VAPID_SUBJECT"),
        String::from("mailto:moi@exemple.test"),
    );
    assert_eq!(
        configue(&mut env).vapid_sujet_resolu,
        "mailto:moi@exemple.test"
    );

    // Un sujet explicite VIDE n'est pas signé tel quel.
    env.insert(
        String::from("HERDR_REMOTE_VAPID_SUBJECT"),
        String::from("  "),
    );
    assert_eq!(
        configue(&mut env).vapid_sujet_resolu,
        "https://herdr.exemple.ts.net:8790"
    );
}

/// Le singulier (`HERDR_REMOTE_PUBLIC_ORIGIN`) n'entre pas dans le sujet :
/// le fil ne lisait que le pluriel.
#[test]
fn le_sujet_vapid_ignore_le_singulier() {
    let mut env = env_dep();
    env.insert(
        String::from("HERDR_REMOTE_PUBLIC_ORIGIN"),
        String::from("https://herdr.exemple.ts.net"),
    );
    assert_eq!(
        configue(&mut env).vapid_sujet_resolu,
        "mailto:herdr-remote@example.com"
    );
}
