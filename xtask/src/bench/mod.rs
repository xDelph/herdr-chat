//! `bench` — le banc d'essai TS/Rust (T065).
//!
//! ⚠️ **Les deux piles, la même fixture, le même hôte.** Le serveur mesuré est
//! lancé par le banc, avec un socket Herdr **faux** et des sessions écrites par
//! le banc : les deux piles voient exactement les mêmes panes et les mêmes
//! fichiers. Sans cette égalité, un écart de latence mesurerait la différence
//! de données, pas celle du code.
//!
//! ⚠️ **Aucun chiffre n'est publié sans sa commande.** Le rapport JSON porte la
//! ligne de commande, les routes demandées, le nombre de demandes réellement
//! servies et l'empreinte du processus. Un banc qui affiche « plus rapide »
//! sans ces traces n'est pas un banc, c'est un slogan.

pub mod charge;
pub mod fixture;
pub mod mesure;

use serde_json::{Value, json};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Ce que le banc reçoit en ligne de commande.
#[derive(Clone, Debug)]
pub struct Options {
    /// `rust`, `ts` ou `both`.
    pub pile: String,
    pub panes: usize,
    pub clients: usize,
    pub runs: usize,
    pub secondes: u64,
    /// `base` (petites sessions) ou `delta32` (32 Mio par session).
    pub scenario: String,
    pub racine: PathBuf,
    /// Garde le dossier temporaire et le journal du serveur — un banc qui
    /// efface ses traces interdit de comprendre un échec.
    pub keep: bool,
}

impl Options {
    /// Lit les options ; une valeur absente prend le défaut, une valeur
    /// illisible est **refusée** (un banc qui devine mesure autre chose).
    pub fn depuis(arguments: &[String], racine: &Path) -> Result<Self, String> {
        let mut options = Self {
            pile: String::from("both"),
            panes: 1,
            clients: 1,
            runs: 5,
            secondes: 5,
            scenario: String::from("base"),
            racine: racine.to_path_buf(),
            keep: false,
        };
        let mut iterateur = arguments.iter();
        while let Some(argument) = iterateur.next() {
            // Un drapeau sans valeur ne consomme pas l'argument suivant.
            if argument == "--keep" {
                options.keep = true;
                continue;
            }
            let (cle, valeur) = match argument.split_once('=') {
                Some((cle, valeur)) => (cle, valeur.to_string()),
                None => (
                    argument.as_str(),
                    iterateur
                        .next()
                        .ok_or_else(|| format!("{argument} attend une valeur"))?
                        .clone(),
                ),
            };
            match cle {
                "--stack" | "--pile" => options.pile = valeur,
                "--panes" => options.panes = nombre(&valeur, "--panes")?,
                "--clients" => options.clients = nombre(&valeur, "--clients")?,
                "--runs" => options.runs = nombre(&valeur, "--runs")?,
                "--seconds" => options.secondes = nombre(&valeur, "--seconds")? as u64,
                "--scenario" => options.scenario = valeur,
                "--keep" => options.keep = true,
                autre => return Err(format!("option inconnue : {autre}")),
            }
        }
        if !matches!(options.pile.as_str(), "rust" | "ts" | "both") {
            return Err(format!("pile inconnue : {}", options.pile));
        }
        if options.panes == 0 || options.clients == 0 || options.runs == 0 {
            return Err(String::from("panes, clients et runs doivent être ≥ 1"));
        }
        Ok(options)
    }
}

fn nombre(texte: &str, cle: &str) -> Result<usize, String> {
    texte
        .parse::<usize>()
        .map_err(|cause| format!("{cle} : {cause}"))
}

/// Lance le banc et écrit son rapport.
pub fn execute(options: &Options) -> Result<(), String> {
    let atelier = Atelier::prepare(options)?;
    let mut messages = Vec::new();
    for pile in piles(&options.pile) {
        messages.push(mesure_pile(options, pile, &atelier)?);
    }
    let rapport = json!({
        "schemaVersion": 1,
        "fixture": {
            "bundle": "compatibility/benchmark/fixtures",
            "fichiers_verifies": atelier.verifies,
            "delta_verifie": atelier.delta_verifie,
        },
        "hote": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "panes": options.panes,
        "clients": options.clients,
        "runs": options.runs,
        "secondes": options.secondes,
        "scenario": options.scenario,
        "piles": messages,
    });
    let dossier = options.racine.join("compatibility/results");
    std::fs::create_dir_all(&dossier).map_err(|cause| format!("dossier de résultats : {cause}"))?;
    let nom = format!(
        "bench-{}p-{}c-{}.json",
        options.panes, options.clients, options.scenario
    );
    let chemin = dossier.join(&nom);
    let texte = serde_json::to_string_pretty(&rapport)
        .map_err(|cause| format!("sérialisation : {cause}"))?;
    std::fs::write(&chemin, format!("{texte}\n"))
        .map_err(|cause| format!("écriture {nom} : {cause}"))?;
    println!("rapport : {}", chemin.display());
    Ok(())
}

fn piles(demande: &str) -> Vec<&'static str> {
    match demande {
        "rust" => vec!["rust"],
        "ts" => vec!["ts"],
        _ => vec!["rust", "ts"],
    }
}

/// La fixture : le **bundle gelé** `compatibility/benchmark/fixtures`, vérifié
/// avant toute mesure.
///
/// ⚠️ **Les empreintes sont vérifiées, sinon rien n'est mesuré.** Le bundle a
/// été gelé à T001 avec un manifeste de 78 sha256 ; le README dit que « a
/// mismatch means the bundle was altered and measurements are void ». Un banc
/// qui mesure un corpus modifié compare autre chose que ce qu'il prétend.
///
/// ⚠️ **Aucun fichier gelé n'est écrit.** Les sessions mesurées sont des
/// **copies** dans un dossier temporaire : le scénario `delta32` ajoute 32 Mio
/// à une copie, jamais au fichier du bundle.
pub struct Atelier {
    pub racine: PathBuf,
    pub sessions: Vec<PathBuf>,
    /// Le nombre de fichiers vérifiés — le rapport le porte, pour qu'on sache
    /// ce qui a été contrôlé et pas seulement ce qui a été mesuré.
    pub verifies: usize,
    pub delta_verifie: bool,
    /// Garde le dossier après l'exécution (diagnostic d'un résultat vide).
    pub garder: bool,
}

/// Les sessions du bundle, triées : la fixture est déterministe, l'ordre aussi.
fn sessions_du_bundle(fixtures: &Path, panes: usize) -> Result<Vec<PathBuf>, String> {
    let dossier = fixtures.join("pi");
    let mut trouvees: Vec<PathBuf> = std::fs::read_dir(&dossier)
        .map_err(|cause| format!("dossier {} : {cause}", dossier.display()))?
        .filter_map(|entree| entree.ok().map(|entree| entree.path()))
        .filter(|chemin| {
            chemin
                .extension()
                .is_some_and(|extension| extension == "jsonl")
        })
        .collect();
    trouvees.sort();
    if trouvees.is_empty() {
        return Err(format!("aucune session dans {}", dossier.display()));
    }
    // `panes` peut dépasser le nombre de fichiers : on refait le tour plutôt
    // que d'inventer des sessions qui n'existent pas dans le bundle.
    Ok((0..panes)
        .map(|indice| trouvees[indice % trouvees.len()].clone())
        .collect())
}

/// Vérifie le manifeste : chaque fichier existe, a sa taille et son empreinte.
fn verifie_manifeste(fixtures: &Path) -> Result<usize, String> {
    let chemin = fixtures.join("manifest.json");
    let texte = std::fs::read_to_string(&chemin)
        .map_err(|cause| format!("manifeste {} : {cause}", chemin.display()))?;
    let manifeste: Value =
        serde_json::from_str(&texte).map_err(|cause| format!("manifeste illisible : {cause}"))?;
    let fichiers = manifeste
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| String::from("manifeste : liste `files` absente"))?;
    if fichiers.is_empty() {
        return Err(String::from("manifeste : aucun fichier à vérifier"));
    }
    let mut verifies = 0_usize;
    for fichier in fichiers {
        let chemin_relatif = fichier
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| String::from("manifeste : fichier sans chemin"))?;
        let attendu = fichier
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("manifeste : {chemin_relatif} sans empreinte"))?;
        let octets_attendus = fichier.get("bytes").and_then(Value::as_u64).unwrap_or(0);
        // Les chemins du manifeste sont relatifs à `compatibility/benchmark`.
        let complet = fixtures.join(
            chemin_relatif
                .strip_prefix("fixtures/")
                .unwrap_or(chemin_relatif),
        );
        let contenu = std::fs::read(&complet)
            .map_err(|cause| format!("fixture {} : {cause}", complet.display()))?;
        if contenu.len() as u64 != octets_attendus {
            return Err(format!(
                "{chemin_relatif} : {} octets, {} attendus — le bundle a été modifié",
                contenu.len(),
                octets_attendus
            ));
        }
        if empreinte_sha256(&contenu) != attendu {
            return Err(format!(
                "{chemin_relatif} : empreinte différente du manifeste — mesures nulles"
            ));
        }
        verifies += 1;
    }
    Ok(verifies)
}

fn empreinte_sha256(contenu: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(contenu);
    digest.iter().map(|octet| format!("{octet:02x}")).collect()
}

impl Atelier {
    /// Prépare la fixture : bundle vérifié, sessions copiées, delta optionnel.
    pub fn prepare(options: &Options) -> Result<Self, String> {
        let fixtures = options.racine.join("compatibility/benchmark/fixtures");
        let verifies = verifie_manifeste(&fixtures)?;
        let sources = sessions_du_bundle(&fixtures, options.panes)?;
        let racine = dossier_court("herdr-banc");

        let dossier = racine.join("sessions");
        std::fs::create_dir_all(&dossier)
            .map_err(|cause| format!("dossier de sessions : {cause}"))?;
        // Le delta n'est PAS commité : il se régénère, et son empreinte est
        // dans le manifeste. Absent, le scénario est refusé — jamais remplacé
        // par une donnée inventée.
        let mut delta_verifie = false;
        let delta = if options.scenario == "delta32" {
            let chemin = fixtures.join("delta/append-pi.jsonl");
            let contenu = std::fs::read(&chemin).map_err(|cause| {
                format!(
                    "delta absent ({cause}) — le générer : bun compatibility/benchmark/generate.ts --delta"
                )
            })?;
            let manifeste: Value = serde_json::from_str(
                &std::fs::read_to_string(fixtures.join("manifest.json"))
                    .map_err(|cause| format!("manifeste : {cause}"))?,
            )
            .map_err(|cause| format!("manifeste illisible : {cause}"))?;
            let attendu = manifeste
                .get("delta")
                .and_then(|delta| delta.get("sha256Expected"))
                .and_then(Value::as_str)
                .ok_or_else(|| String::from("manifeste : delta sans empreinte attendue"))?;
            if empreinte_sha256(&contenu) != attendu {
                return Err(String::from(
                    "delta : empreinte différente du manifeste — mesures nulles",
                ));
            }
            delta_verifie = true;
            Some(contenu)
        } else {
            None
        };
        let mut sessions = Vec::new();
        for (indice, source) in sources.iter().enumerate() {
            let nom = format!("banc-{indice}.jsonl");
            let destination = dossier.join(&nom);
            std::fs::copy(source, &destination)
                .map_err(|cause| format!("copie de {} : {cause}", source.display()))?;
            // ⚠️ Le delta s'ajoute à **une** session : 50 × 32 Mio feraient
            // 1,6 Gio de fichier temporaire pour mesurer un rattrapage.
            if let (Some(delta), 0) = (delta.as_ref(), indice) {
                use std::io::Write as _;
                let mut fichier = std::fs::OpenOptions::new()
                    .append(true)
                    .open(&destination)
                    .map_err(|cause| format!("ouverture pour delta : {cause}"))?;
                fichier
                    .write_all(delta)
                    .map_err(|cause| format!("ajout du delta : {cause}"))?;
            }
            sessions.push(destination);
        }
        Ok(Self {
            racine,
            sessions,
            verifies,
            delta_verifie,
            garder: options.keep,
        })
    }
}

impl Atelier {
    /// Le journal du serveur mesuré, pour expliquer un résultat vide.
    #[must_use]
    pub fn journal(&self) -> String {
        std::fs::read_to_string(self.racine.join("banc.log")).unwrap_or_default()
    }
}

impl Drop for Atelier {
    fn drop(&mut self) {
        if self.garder {
            eprintln!("banc : dossier conservé {}", self.racine.display());
            return;
        }
        let _ = std::fs::remove_dir_all(&self.racine);
    }
}

/// Un dossier temporaire **court** : un socket Unix a une longueur maximale
/// (`SUN_LEN`, 104 octets sur macOS) et le dossier temporaire du système
/// (`/var/folders/…`) la dépasse dès qu'on y ajoute un nom.
fn dossier_court(prefixe: &str) -> PathBuf {
    let base = if Path::new("/tmp").is_dir() {
        PathBuf::from("/tmp")
    } else {
        std::env::temp_dir()
    };
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duree| duree.as_nanos())
        .unwrap_or(0);
    base.join(format!("{prefixe}-{}-{unique}", std::process::id()))
}

/// Un port libre sur le loopback — choisi par le système, jamais deviné.
fn port_libre() -> Result<u16, String> {
    let ecoute =
        TcpListener::bind("127.0.0.1:0").map_err(|cause| format!("port libre : {cause}"))?;
    let port = ecoute
        .local_addr()
        .map_err(|cause| format!("adresse locale : {cause}"))?
        .port();
    drop(ecoute);
    Ok(port)
}

/// La commande d'une pile, avec l'environnement qui la rend comparable.
fn commande(
    options: &Options,
    pile: &str,
    port: u16,
    atelier: &Atelier,
) -> Result<Command, String> {
    let mut commande = match pile {
        "rust" => {
            let release = options.racine.join("target/release/herdrchat");
            let debug = options.racine.join("target/debug/herdrchat");
            let binaire = if release.is_file() { release } else { debug };
            if !binaire.is_file() {
                return Err(format!(
                    "binaire absent : {} (cargo build -p herdrchat)",
                    binaire.display()
                ));
            }
            Command::new(binaire)
        }
        _ => {
            let mut commande = Command::new("bun");
            commande
                .arg("run")
                .arg(options.racine.join("apps/server/src/main.ts"));
            commande
        }
    };
    commande
        .env(
            "HERDR_SOCKET_PATH",
            atelier.racine.join("herdr-fixture.sock"),
        )
        .env("HERDR_REMOTE_PORT", port.to_string())
        .env("HERDR_REMOTE_BIND", "127.0.0.1")
        .env("HERDR_REMOTE_LOG_PATH", atelier.racine.join("banc.log"))
        .env("HERDR_REMOTE_PUSH_STORE", atelier.racine.join("push.json"))
        .env("PI_SESSIONS_ROOT", atelier.racine.join("sessions"))
        .env("CLAUDE_PROJECTS_ROOT", atelier.racine.join("sessions"))
        .stdout(Stdio::null())
        .stderr(if options.keep {
            Stdio::from(
                std::fs::File::create(atelier.racine.join("serveur.err"))
                    .map_err(|cause| format!("journal du serveur : {cause}"))?,
            )
        } else {
            Stdio::null()
        });
    Ok(commande)
}

fn mesure_pile(options: &Options, pile: &str, atelier: &Atelier) -> Result<Value, String> {
    let fausse = fixture::Fausse::demarre(
        &atelier.racine,
        fixture::Plan {
            panes: options.panes,
            sessions: atelier.sessions.clone(),
        },
    )?;
    let port = port_libre()?;
    let mut serveur = commande(options, pile, port, atelier)?
        .spawn()
        .map_err(|cause| {
            format!("lancement de la pile {pile} : {cause} (le banc lance le serveur lui-même)")
        })?;
    let pid = serveur.id();
    let racine_http = format!("127.0.0.1:{port}");
    let attente = mesure::attend_pret(&racine_http, "/api/health", Duration::from_secs(120))
        .map_err(|cause| format!("pile {pile} : {cause}"))?;

    let routes = vec![
        String::from("/api/overview"),
        String::from("/api/conversations"),
    ];
    // La sonde : ce que la pile rend AVANT la charge. Une mesure sur des 500
    // ne mesure pas une latence, elle mesure un échec.
    let mut sondes = Vec::new();
    for route in &routes {
        match mesure::sonde(&racine_http, route) {
            Ok((statut, corps)) => sondes.push(json!({
                "route": route,
                "statut": statut,
                "corps": corps,
            })),
            Err(cause) => sondes.push(json!({ "route": route, "erreur": cause })),
        }
    }
    let mut runs = Vec::new();
    for indice in 0..options.runs {
        let plan = charge::PlanDeCharge {
            racine: racine_http.clone(),
            routes: routes.clone(),
            duree: Duration::from_secs(options.secondes),
        };
        let echantillonneur = mesure::Echantillonneur::demarre(pid);
        let mesures = charge::lance(&plan, options.clients);
        let empreinte = echantillonneur.termine();
        let mut latences: Vec<u128> = Vec::new();
        let mut par_route: std::collections::BTreeMap<String, Vec<u128>> =
            std::collections::BTreeMap::new();
        let mut octets = 0_usize;
        let mut non_200 = 0_usize;
        for mesure in &mesures {
            for reponse in &mesure.reponses {
                latences.push(reponse.micros);
                par_route
                    .entry(reponse.route.clone())
                    .or_default()
                    .push(reponse.micros);
                octets += reponse.octets;
                if reponse.statut != 200 {
                    non_200 += 1;
                }
            }
        }
        let centiles = mesure::centiles(latences);
        let routes_mesurees: Value = par_route
            .iter()
            .map(|(route, valeurs)| {
                let c = mesure::centiles(valeurs.clone());
                (
                    route.clone(),
                    json!({
                        "n": c.n,
                        "p50_us": c.p50,
                        "p95_us": c.p95,
                        "p99_us": c.p99,
                        "max_us": c.max,
                    }),
                )
            })
            .collect::<serde_json::Map<String, Value>>()
            .into();
        runs.push(json!({
            "run": indice,
            "froid": indice == 0,
            "requetes": centiles.n,
            "non_200": non_200,
            "octets": octets,
            "p50_us": centiles.p50,
            "p95_us": centiles.p95,
            "p99_us": centiles.p99,
            "max_us": centiles.max,
            "rss_max_kio": empreinte.rss_max_kio,
            "cpu_ms": empreinte.cpu_ms,
            "echantillons": empreinte.echantillons,
            "par_route": routes_mesurees,
        }));
    }
    let demandes_fixture = fausse.servies();
    let _ = serveur.kill();
    let _ = serveur.wait();
    Ok(json!({
        "pile": pile,
        "commande": format!(
            "HERDR_SOCKET_PATH=<fixture>/herdr-fixture.sock HERDR_REMOTE_PORT={port} HERDR_REMOTE_BIND=127.0.0.1 {}",
            if pile == "rust" { "target/{release,debug}/herdrchat" } else { "bun run apps/server/src/main.ts" }
        ),
        "pret_ms": attente.as_millis(),
        "routes": routes,
        "sondes": sondes,
        "journal_serveur": if options.keep { atelier.journal() } else { String::new() },
        "dossier": if options.keep { atelier.racine.display().to_string() } else { String::new() },
        "demandes_fixture": demandes_fixture,
        "runs": runs,
    }))
}

/// Le point d'entrée du sous-commande, pour `xtask bench`.
pub fn entree(racine: &Path, arguments: &[String]) -> Result<(), String> {
    let options = Options::depuis(arguments, racine)?;
    let debut = Instant::now();
    execute(&options)?;
    println!("banc terminé en {:?}", debut.elapsed());
    Ok(())
}
