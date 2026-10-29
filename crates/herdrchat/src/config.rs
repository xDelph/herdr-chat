//! La configuration immuable du démon (T048, C10) : les 17 variables de
//! l'environnement, la précédence existante, HOME/PATH **injectés** (aucun
//! environnement n'est lu dans les bibliothèques — seulement ici), le bind
//! strict, le port strict, les origines Serve normalisées.
//!
//! ⚠️ Deux variables aux noms dangereusement proches ne doivent jamais être
//! confondues (D008, écart E5) : `HERDR_SOCKET_PATH` → la couche A (l'API
//! socket de Herdr, ce qu'on utilise), `HERDR_SOCKET` → la couche B (le bus
//! d'agents, hors périmètre). **`HERDR_SOCKET` n'est jamais lue.**

use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Le port local par défaut : `tailscale serve` retransmet HTTPS 8790 vers
/// le backend 8791 (`packages/shared/src/port.ts`).
pub const PORT_DEFAUT: u16 = 8791;

/// La fenêtre de déduplication des envois identiques (D007.2) — la valeur
/// du contrat partagé.
pub const FENETRE_DEDUPLICATION_MS: u64 = 60_000;

/// Le délai d'interrogation de la CLI Tailscale, une seule fois au
/// démarrage (CURRENT §8 : 5 s).
pub const DELAI_TAILSCALE: Duration = Duration::from_secs(5);

/// Le port HTTPS par défaut : le navigateur l'**omet** de `Origin`.
const PORT_HTTPS_DEFAUT: &str = "443";

/// Le placeholder d'écoute : l'adresse sera substituée par Tailscale.
/// L'hôte d'écoute par défaut : le loopback (le code du fil ;
/// les docs écrivent « [IP_ADDRESS] » par convention).
const BIND_DEFAUT: &str = "127.0.0.1";

/// Une erreur de configuration — la cause exacte du fil.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ErreurConfig {
    pub detail: String,
}

/// Les racines de sessions des trois familles qui écrivent des fichiers.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RacinesDeSessions {
    /// `PI_SESSIONS_ROOT`.
    pub pi: PathBuf,
    /// `CODEX_SESSION_ROOT` — les `rollout-*.jsonl`, pas `CODEX_HOME`.
    pub codex: PathBuf,
    /// `CLAUDE_PROJECTS_ROOT`.
    pub claude: PathBuf,
}

/// La configuration — **immuable** : aucun setter, chaque valeur figée à la
/// lecture. Les 17 variables de CURRENT §8.
#[derive(Clone, Debug)]
pub struct Config {
    /// Chemin du socket de l'API Herdr (couche A).
    pub herdr_socket_path: PathBuf,
    /// Racines des sessions — Pi, Codex, Claude, **nommées**. Jamais
    /// devinées par projet : Herdr fournit le chemin.
    ///
    /// ⚠️ C'était un `Vec` positionnel : la composition prenait `first()`
    /// pour Claude et recevait la racine Pi — toutes les sessions Claude
    /// étaient introuvables. Un champ nommé rend l'erreur impossible.
    pub session_roots: RacinesDeSessions,
    /// Le port d'écoute — strictement décimal, 1..65535 (C10).
    pub port: u16,
    /// L'hôte d'écoute : `[IP_ADDRESS]` par défaut, sinon une adresse du
    /// tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48) — jamais une adresse
    /// publique ou wildcard (C10).
    pub hostname: String,
    /// Base SQLite d'opencode — UNE base, pas un dossier de sessions.
    pub opencode_db_path: PathBuf,
    /// Fenêtre de déduplication des envois identiques consécutifs (D007.2).
    pub fenetre_deduplication_ms: u64,
    /// Chemin du journal d'erreurs.
    pub log_path: PathBuf,
    /// Origines publiques : la liste explicite (pluriel préféré), puis
    /// l'origine locale, puis le tailnet direct, puis Serve.
    pub origines_publiques: Vec<String>,
    /// Racines de fichiers ADDITIONNELLES (chaque dossier de projet reste
    /// autorisé) — seules celles qui existent à la lecture.
    pub racines_fichiers_extra: Vec<PathBuf>,
    /// `CODEX_HOME` — l'état versionné, indépendant de `CODEX_SESSION_ROOT`.
    pub codex_home: PathBuf,
    /// `DEVIN_DB` — la base de sessions DeVin.
    pub devin_db_path: PathBuf,
    /// `HERDR_REMOTE_PUSH_STORE` — clés et abonnements push, indépendant du
    /// journal configuré.
    pub push_store_path: PathBuf,
    /// `HERDR_REMOTE_READS_STORE` — les lectures partagées entre appareils
    /// (H22) ; par défaut `reads.json` à côté du magasin push.
    pub lectures_store_path: PathBuf,
    /// `HERDR_REMOTE_VAPID_SUBJECT` — brut ; la dérivation (HTTPS configuré,
    /// puis mailto) vit dans les abonnements (T052).
    pub vapid_sujet: Option<String>,
    /// Le sujet VAPID **résolu** — le `sub` du JWT de chaque envoi push :
    /// `HERDR_REMOTE_VAPID_SUBJECT`, sinon la première origine HTTPS de
    /// `HERDR_REMOTE_PUBLIC_ORIGINS` (le pluriel seul, comme le fil), sinon
    /// `mailto:herdr-remote@example.com` (CURRENT §6).
    pub vapid_sujet_resolu: String,
    /// `HERDR_REMOTE_VAPID_PUBLIC_KEY` — brut ; les deux surcharges doivent
    /// venir ENSEMBLE (une paire partielle est une erreur, T044).
    pub vapid_cle_publique: Option<String>,
    /// `HERDR_REMOTE_VAPID_PRIVATE_KEY` — brut.
    pub vapid_cle_privee: Option<String>,
}

/// Lit la configuration depuis l'environnement injecté et le domicile —
/// la SEULE fonction qui touche aux variables ; les bibliothèques ne lisent
/// jamais l'environnement. Le lanceur Tailscale est le RÉEL — un test passe
/// par `config_depuis_avec` pour ne jamais toucher au tailnet.
pub fn config_depuis(env: &HashMap<String, String>, home: &Path) -> Result<Config, ErreurConfig> {
    config_depuis_avec(
        env,
        home,
        &LanceurServeReel::nouveau(resolve_tailscale_bin()),
    )
}

/// La variante injectée — l'argv et le délai de la CLI restent du ressort
/// du trait, observés par les tests sans tailnet.
pub fn config_depuis_avec(
    env: &HashMap<String, String>,
    home: &Path,
    lanceur: &dyn LanceStatutServe,
) -> Result<Config, ErreurConfig> {
    let socket_path = env.get("HERDR_SOCKET_PATH").cloned().unwrap_or_else(|| {
        home.join(".config/herdr/herdr.sock")
            .to_string_lossy()
            .into_owned()
    });

    let brut_port = env
        .get("HERDR_REMOTE_PORT")
        .cloned()
        .unwrap_or_else(|| PORT_DEFAUT.to_string());
    // Strict décimal (C10) : « 8791abc » est refusé — pas d'`parseInt`
    // permissif, et 0 est refusé (1..65535).
    let port = brut_port
        .parse::<u16>()
        .ok()
        .filter(|port| *port >= 1)
        .ok_or_else(|| ErreurConfig {
            detail: format!("HERDR_REMOTE_PORT invalide : « {brut_port} »"),
        })?;

    let bind = env
        .get("HERDR_REMOTE_BIND")
        .cloned()
        .unwrap_or_else(|| String::from(BIND_DEFAUT));
    valide_bind(&bind).map_err(|detail| ErreurConfig { detail })?;
    let est_tailnet = est_adresse_tailnet(&bind);

    let origines_explicites: Vec<String> = env
        .get("HERDR_REMOTE_PUBLIC_ORIGINS")
        .or_else(|| env.get("HERDR_REMOTE_PUBLIC_ORIGIN"))
        .map(|valeurs| {
            valeurs
                .split(',')
                .map(|origine| origine.trim().to_string())
                .filter(|origine| !origine.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let racines_fichiers_extra: Vec<PathBuf> = env
        .get("HERDR_REMOTE_FILES_ROOTS")
        .map(|valeurs| {
            valeurs
                .split(':')
                .map(|entree| entree.trim().to_string())
                .filter(|entree| !entree.is_empty() && Path::new(entree).is_dir())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default();

    // ⚠️ ES-tu LISTE : l'origine locale est toujours légitime. `localhost`
    // n'a pas à être listé : le garde accepte tout le loopback.
    let mut origines_publiques = origines_explicites;
    // Origine locale, toujours légitime. `localhost` n'a pas à être listé :
    // le garde accepte tout le loopback.
    origines_publiques.push(format!("http://{BIND_DEFAUT}:{port}"));
    if est_tailnet {
        origines_publiques.push(format!("http://{}:{port}", hote_url(&bind)));
    }
    origines_publiques.extend(origines_tailscale_avec(port, lanceur));

    Ok(Config {
        herdr_socket_path: PathBuf::from(socket_path),
        session_roots: RacinesDeSessions {
            pi: PathBuf::from(env.get("PI_SESSIONS_ROOT").cloned().unwrap_or_else(|| {
                home.join(".pi/agent/sessions")
                    .to_string_lossy()
                    .into_owned()
            })),
            codex: PathBuf::from(
                env.get("CODEX_SESSION_ROOT")
                    .cloned()
                    .unwrap_or_else(|| home.join(".codex/sessions").to_string_lossy().into_owned()),
            ),
            claude: PathBuf::from(
                env.get("CLAUDE_PROJECTS_ROOT").cloned().unwrap_or_else(|| {
                    home.join(".claude/projects").to_string_lossy().into_owned()
                }),
            ),
        },
        port,
        hostname: bind,
        opencode_db_path: PathBuf::from(env.get("OPENCODE_DB").cloned().unwrap_or_else(|| {
            home.join(".local/share/opencode/opencode.db")
                .to_string_lossy()
                .into_owned()
        })),
        fenetre_deduplication_ms: FENETRE_DEDUPLICATION_MS,
        log_path: PathBuf::from(
            env.get("HERDR_REMOTE_LOG_PATH")
                .cloned()
                .unwrap_or_else(|| {
                    home.join(".herdr-remote/herdr-remote.log")
                        .to_string_lossy()
                        .into_owned()
                }),
        ),
        origines_publiques,
        racines_fichiers_extra,
        codex_home: PathBuf::from(
            env.get("CODEX_HOME")
                .cloned()
                .unwrap_or_else(|| home.join(".codex").to_string_lossy().into_owned()),
        ),
        devin_db_path: PathBuf::from(env.get("DEVIN_DB").cloned().unwrap_or_else(|| {
            home.join(".local/share/devin/cli/sessions.db")
                .to_string_lossy()
                .into_owned()
        })),
        push_store_path: PathBuf::from(env.get("HERDR_REMOTE_PUSH_STORE").cloned().unwrap_or_else(
            || {
                home.join(".herdr-remote/push.json")
                    .to_string_lossy()
                    .into_owned()
            },
        )),
        lectures_store_path: env.get("HERDR_REMOTE_READS_STORE").map_or_else(
            || {
                PathBuf::from(
                    env.get("HERDR_REMOTE_PUSH_STORE")
                        .cloned()
                        .unwrap_or_else(|| {
                            home.join(".herdr-remote/push.json")
                                .to_string_lossy()
                                .into_owned()
                        }),
                )
                .with_file_name("reads.json")
            },
            PathBuf::from,
        ),
        vapid_sujet: env.get("HERDR_REMOTE_VAPID_SUBJECT").cloned(),
        vapid_sujet_resolu: sujet_vapid(env),
        vapid_cle_publique: env.get("HERDR_REMOTE_VAPID_PUBLIC_KEY").cloned(),
        vapid_cle_privee: env.get("HERDR_REMOTE_VAPID_PRIVATE_KEY").cloned(),
    })
}

/// Le sujet VAPID résolu (CURRENT §6) : explicite, puis première origine
/// HTTPS du pluriel `HERDR_REMOTE_PUBLIC_ORIGINS`, puis le `mailto:` du fil.
///
/// ⚠️ Divergence assumée : un sujet explicite **vide** n'est pas retenu (le
/// fil l'aurait signé tel quel, un JWT au `sub` vide que les services push
/// refusent) — on passe alors au repli suivant.
#[must_use]
pub fn sujet_vapid(env: &HashMap<String, String>) -> String {
    if let Some(sujet) = env
        .get("HERDR_REMOTE_VAPID_SUBJECT")
        .map(|sujet| sujet.trim())
        .filter(|sujet| !sujet.is_empty())
    {
        return sujet.to_string();
    }
    env.get("HERDR_REMOTE_PUBLIC_ORIGINS")
        .and_then(|origines| {
            origines
                .split(',')
                .map(str::trim)
                .find(|origine| origine.starts_with("https://"))
                .map(str::to_string)
        })
        .unwrap_or_else(|| String::from(notifications::webpush::SUJET_PAR_DEFAUT))
}

/// Valide le bind (C10) : le loopback par défaut, sinon une adresse PARCÉE
/// dans les plages tailnet — jamais un préfixe textuel, jamais une adresse
/// publique ou wildcard.
fn valide_bind(bind: &str) -> Result<(), String> {
    if bind == BIND_DEFAUT {
        return Ok(());
    }
    let ip: std::net::IpAddr = bind
        .parse()
        .map_err(|_| format!("HERDR_REMOTE_BIND = « {bind} » refusé. {BIND_DEFAUT} ou une adresse du tailnet (100.64.0.0/10 / fd7a:115c:a1e0::/48) sont attendus. Jamais une adresse publique."))?;
    if !est_range_tailnet(ip) {
        return Err(format!(
            "HERDR_REMOTE_BIND = « {bind} » refusé : hors des plages tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48). Jamais une adresse publique."
        ));
    }
    Ok(())
}

/// `true` si l'adresse est dans les plages tailnet PARCÉES (C10) :
/// 100.64.0.0/10 et fd7a:115c:a1e0::/48. Le préfixe textuel du fil
/// (« 100. » / « fd7a: ») est remplacé par ces plages.
#[must_use]
pub fn est_range_tailnet(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            let [a, b, _, _] = v4.octets();
            a == 100 && b & 0b1100_0000 == 0b0100_0000
        }
        std::net::IpAddr::V6(v6) => {
            const PREFIXE: [u8; 6] = [0xfd, 0x7a, 0x11, 0x5c, 0xa1, 0xe0];
            v6.octets()[..6] == PREFIXE
        }
    }
}

#[must_use]
fn est_adresse_tailnet(bind: &str) -> bool {
    bind.parse::<std::net::IpAddr>()
        .map(est_range_tailnet)
        .unwrap_or(false)
}

/// Un hôte mis en forme pour une URL — une adresse IPv6 se met entre
/// crochets : `fd7a:…:1` seule donnerait une URL inanalysable.
#[must_use]
pub fn hote_url(hote: &str) -> String {
    if hote.contains(':') && !hote.starts_with('[') {
        format!("[{hote}]")
    } else {
        String::from(hote)
    }
}

/// L'origine que le navigateur enverra pour un `host:port` de Serve.
/// Le port 443 disparaît de `Origin` (le navigateur l'omet).
fn origine_https(hote_port: &str) -> Option<String> {
    // Un hôte SANS port : l'origine est l'hôte tel quel.
    let Some(dernier) = hote_port.rfind(':') else {
        return Some(format!("https://{hote_port}"));
    };
    if dernier == 0 {
        return None;
    }
    let port = &hote_port[dernier + 1..];
    if port == PORT_HTTPS_DEFAUT {
        Some(format!("https://{}", &hote_port[..dernier]))
    } else {
        Some(format!("https://{hote_port}"))
    }
}

/// `true` si un handler de Serve pointe vers NOTRE backend : hôte local
/// (le placeholder `[IP_ADDRESS]`, `localhost`, `::1`) ET port exact.
///
/// ⚠️ Le port est comparé exactement : un autre service proxifié n'a pas à
/// être autorisé — c'est ce qui distingue « la même machine » de « le même
/// backend ». La comparaison porte sur l'hôte et le port, jamais la chaîne.
fn pointe_vers_backend(proxy: &str, port: u16) -> bool {
    let sans_schema = if let Some(apres) = proxy.strip_prefix("http://") {
        apres
    } else if let Some(apres) = proxy.strip_prefix("https://") {
        apres
    } else {
        return false;
    };
    // L'autorité jusqu'au premier `/` (une barre finale ne change rien).
    let Some(autorite) = sans_schema.split('/').next() else {
        return false;
    };
    let (hote, port_texte) = if let Some(apres_crochet) = autorite.strip_prefix('[') {
        let Some(fermeture) = apres_crochet.find(']') else {
            return false;
        };
        let hote = &apres_crochet[..fermeture];
        let reste = &apres_crochet[fermeture + 1..];
        let port_texte = reste.strip_prefix(':').unwrap_or_default();
        (hote, port_texte)
    } else {
        // Une cible sans port est écartée — comme dans le fil.
        let Some(deux_points) = autorite.rfind(':') else {
            return false;
        };
        let hote = &autorite[..deux_points];
        let port_texte = &autorite[deux_points + 1..];
        // Une adresse IPv6 BRUTE (sans crochets) est malformée : écartée.
        if hote.contains(':') {
            return false;
        }
        (hote, port_texte)
    };
    let local = hote.eq_ignore_ascii_case("127.0.0.1")
        || hote.eq_ignore_ascii_case("localhost")
        || hote == "::1";
    // Le port doit être exact — aucune tolérance de voisinage.
    local && port_texte == port.to_string()
}

/// Origines HTTPS de cette machine sur son tailnet, dérivées de la
/// configuration de Serve — la partie PURE et testée.
///
/// Un relevé illisible ne fait pas tomber le démarrage : la liste locale
/// suffit. Serve non configuré, ou format inattendu : liste vide.
#[must_use]
pub fn origines_de_serve(statut: &Value, port: u16) -> Vec<String> {
    let Some(web) = statut.get("Web").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut origines = Vec::new();
    for (hote_port, entree) in web {
        let Some(mains) = entree.get("Handlers").and_then(Value::as_object) else {
            continue;
        };
        let vise_notre_backend = mains.values().any(|main| {
            main.get("Proxy")
                .and_then(Value::as_str)
                .is_some_and(|proxy| pointe_vers_backend(proxy, port))
        });
        if !vise_notre_backend {
            continue;
        }
        if let Some(origine) = origine_https(hote_port) {
            origines.push(origine);
        }
    }
    origines
}

/// Le lanceur de `tailscale serve status` — injecté pour les tests (l'argv
/// et le délai restent mesurables sans tailnet).
pub trait LanceStatutServe: Send + Sync {
    /// Exécute la CLI, borné à `delai` — `Ok(sortie)` ou la cause.
    fn lance(&self, argv: &[&str], delai: Duration) -> Result<String, String>;
}

/// Le lanceur RÉEL : `tailscale serve status --json`, délai borné par
/// interrogation (`try_wait`) — le processus tardif est tué, la sortie
/// ne s'étire pas.
pub struct LanceurServeReel {
    chemin: String,
}

impl LanceurServeReel {
    #[must_use]
    pub fn nouveau(chemin: String) -> Self {
        Self { chemin }
    }
}

impl LanceStatutServe for LanceurServeReel {
    fn lance(&self, argv: &[&str], delai: Duration) -> Result<String, String> {
        let mut enfant = std::process::Command::new(&self.chemin)
            .args(argv)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|cause| cause.to_string())?;
        let debut = std::time::Instant::now();
        loop {
            match enfant.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if debut.elapsed() > delai {
                        // Le processus tardif est tué, la sortie ne s'étire pas.
                        let _ = enfant.kill();
                        let _ = enfant.wait();
                        return Err(String::from("tailscale serve status: timed out"));
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(cause) => return Err(cause.to_string()),
            }
        }
        let mut sortie = Vec::new();
        use std::io::Read;
        enfant
            .stdout
            .take()
            .ok_or_else(|| String::from("stdout unavailable"))?
            .read_to_end(&mut sortie)
            .map_err(|cause| cause.to_string())?;
        String::from_utf8(sortie).map_err(|cause| cause.to_string())
    }
}

/// Chemins connus de la CLI Tailscale — macOS et Linux (sous `systemd` le
/// PATH est minimal : sans ces chemins, aucune origine, toute la PWA en 403).
const CHEMINS_TAILSCALE: &[&str] = &[
    // macOS
    "/opt/homebrew/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/tailscale",
    // Linux et autres
    "/usr/bin/tailscale",
    "/usr/sbin/tailscale",
    "/usr/local/bin/tailscale",
    "/home/linuxbrew/.linuxbrew/bin/tailscale",
    "/snap/bin/tailscale",
    "/opt/bin/tailscale",
];

/// Résout la CLI Tailscale par chemin absolu — le PATH est le dernier
/// recours (lancement interactif).
#[must_use]
pub fn resolve_tailscale_bin() -> String {
    for chemin in CHEMINS_TAILSCALE {
        if Path::new(chemin).exists() {
            return String::from(*chemin);
        }
    }
    String::from("tailscale")
}

/// Interroge la CLI Tailscale, UNE SEULE fois au démarrage — son absence
/// n'est pas une erreur : sans Serve, la liste locale suffit (confort, pas
/// dépendance). L'argv exact et le délai sont ceux du fil.
#[must_use]
pub fn origines_tailscale(port: u16) -> Vec<String> {
    origines_tailscale_avec(port, &LanceurServeReel::nouveau(resolve_tailscale_bin()))
}

/// La variante injectée — l'argv exact et le délai restent du ressort du
/// trait, observés par les tests.
#[must_use]
pub fn origines_tailscale_avec(port: u16, lanceur: &dyn LanceStatutServe) -> Vec<String> {
    let argv = ["serve", "status", "--json"];
    match lanceur.lance(&argv, DELAI_TAILSCALE) {
        Ok(sortie) => serde_json::from_str(&sortie)
            .map(|valeur: Value| origines_de_serve(&valeur, port))
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}
