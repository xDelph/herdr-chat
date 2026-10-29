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
use std::process::{Child, Command, Stdio};
use std::thread;
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
    /// La racine d'un checkout qui contient encore le démon TS
    /// (`apps/server/src/main.ts`). T068 l'a retiré de cet arbre : la pile
    /// `ts` se mesure depuis un worktree de l'historique (`--ts-root <dir>`,
    /// voir `compatibility/benchmark/README.md`). `None` = la racine courante.
    pub racine_ts: Option<PathBuf>,
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
            racine_ts: None,
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
                "--ts-root" => options.racine_ts = Some(PathBuf::from(valeur)),
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
    /// Une **copie** de la base opencode du bundle (`lockDB`) et l'identifiant
    /// de session relevé dedans — le bundle gelé n'est jamais écrit.
    pub opencode_db: Option<PathBuf>,
    pub opencode_session: Option<String>,
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

        // ⚠️ Chemin **canonique** : `/tmp` est un lien vers `/private/tmp` sur
        // macOS, et une racine non canonique fait refuser les fichiers par la
        // référence (« no usable session path ») alors qu'ils sont dedans.
        let racine = std::fs::canonicalize(&racine).unwrap_or(racine);
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
        // `lockDB` : la base du bundle est **copiée** (le détenteur de
        // transaction écrit dedans) et l'identifiant de session est **relevé**
        // dans la copie, jamais supposé.
        let (opencode_db, opencode_session) = if options.scenario == "lockDB" {
            let source = fixtures.join("opencode/opencode.db");
            let copie = racine.join("opencode.db");
            std::fs::copy(&source, &copie)
                .map_err(|cause| format!("copie de {} : {cause}", source.display()))?;
            let identifiant = premiere_session_sqlite(&copie)?;
            (Some(copie), Some(identifiant))
        } else {
            (None, None)
        };
        Ok(Self {
            racine,
            sessions,
            verifies,
            delta_verifie,
            garder: options.keep,
            opencode_db,
            opencode_session,
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

/// Le premier identifiant de session d'une base opencode — lu, pas deviné.
fn premiere_session_sqlite(chemin: &Path) -> Result<String, String> {
    let sortie = Command::new("sqlite3")
        .arg(chemin)
        .arg("select id from session_v2 order by id limit 1;")
        .output()
        .map_err(|cause| format!("sqlite3 : {cause}"))?;
    let identifiant = String::from_utf8_lossy(&sortie.stdout).trim().to_string();
    if identifiant.is_empty() {
        return Err(format!(
            "aucune session dans {} : {}",
            chemin.display(),
            String::from_utf8_lossy(&sortie.stderr).trim()
        ));
    }
    Ok(identifiant)
}

/// Le **détenteur de transaction** du scénario `lockDB` : une transaction
/// d'écriture tenue ouverte pendant les lectures.
///
/// ⚠️ Il écrit dans la **copie** de la base, jamais dans le bundle. Le but est
/// d'éprouver le chemin du `busy_timeout` : une lecture qui trouve la base
/// verrouillée doit soit attendre puis réussir, soit échouer **nommément** —
/// dans les deux cas, aucune réponse inventée.
struct Detenteur {
    enfant: Child,
    /// Le tuyau reste **ouvert** tant que le détenteur vit : le fermer
    /// enverrait `COMMIT` implicite et relâcherait le verrou.
    _entree: std::process::ChildStdin,
}

impl Detenteur {
    /// Vérifie que le verrou est **réellement** tenu : un second écrivain doit
    /// échouer. Sans cette preuve, `lockDB` mesurerait des lectures sans verrou
    /// et ne prouverait rien.
    fn verrou_tenu(base: &Path) -> bool {
        let sortie = Command::new("sqlite3")
            .arg(base)
            .arg("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; ROLLBACK;")
            .output();
        match sortie {
            Ok(sortie) => !sortie.status.success(),
            Err(_) => false,
        }
    }

    fn demarre(base: &Path) -> Result<Self, String> {
        use std::io::Write as _;
        let mut enfant = Command::new("sqlite3")
            .arg(base)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|cause| format!("sqlite3 (détenteur) : {cause}"))?;
        let mut entree = enfant
            .stdin
            .take()
            .ok_or_else(|| String::from("stdin du détenteur indisponible"))?;
        // `IMMEDIATE` prend le verrou d'écriture tout de suite ; l'UPDATE le
        // garde jusqu'à `COMMIT` — qu'on n'envoie pas.
        let script =
            "PRAGMA busy_timeout=0;\nBEGIN IMMEDIATE;\nUPDATE session_v2 SET title = title;\n";
        entree
            .write_all(script.as_bytes())
            .map_err(|cause| format!("script du détenteur : {cause}"))?;
        entree
            .flush()
            .map_err(|cause| format!("flush du détenteur : {cause}"))?;
        thread::sleep(Duration::from_millis(300));
        Ok(Self {
            enfant,
            _entree: entree,
        })
    }
}

impl Drop for Detenteur {
    fn drop(&mut self) {
        let _ = self.enfant.kill();
        let _ = self.enfant.wait();
    }
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
            let entree = options
                .racine_ts
                .as_deref()
                .unwrap_or(&options.racine)
                .join("apps/server/src/main.ts");
            // ⚠️ Le démon TS n'est plus dans l'arbre (T068) : son absence est
            // dite, jamais remplacée par une mesure de l'autre pile.
            if !entree.is_file() {
                return Err(format!(
                    "démon TS absent : {} — retiré à T068 ; mesurer depuis un worktree de l'historique : \
                     `git worktree add /tmp/herdr-ts <commit-avant-T068> && (cd /tmp/herdr-ts && bun install --frozen-lockfile)` \
                     puis `--ts-root /tmp/herdr-ts`",
                    entree.display()
                ));
            }
            let mut commande = Command::new("bun");
            commande.arg("run").arg(entree);
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
        .env(
            "OPENCODE_DB",
            atelier
                .opencode_db
                .clone()
                .unwrap_or_else(|| atelier.racine.join("pas-de-base.db")),
        )
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
            sqlite_session: atelier.opencode_session.clone(),
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
    // Le verrou est posé APRÈS le démarrage : une pile qui ne peut pas ouvrir
    // sa base au démarrage ne mesurerait pas le `busy_timeout`, elle mesurerait
    // un échec de démarrage.
    let (detenteur, verrou) = match atelier.opencode_db.as_ref() {
        Some(base) => {
            let detenteur = Detenteur::demarre(base)?;
            let tenu = Detenteur::verrou_tenu(base);
            (Some(detenteur), Some(tenu))
        }
        None => (None, None),
    };
    let attente = mesure::attend_pret(&racine_http, "/api/health", Duration::from_secs(120))
        .map_err(|cause| format!("pile {pile} : {cause}"))?;

    let mut routes = vec![
        String::from("/api/overview"),
        String::from("/api/conversations"),
    ];
    // `delta32` : la lecture de session entre dans la charge — c'est elle qui
    // relit le fichier après l'ajout de 32 Mio (rattrapage complet).
    if options.scenario == "delta32" || options.scenario == "base" {
        // Le pane du premier agent de la fixture : `w0:p1` (la fausse Herdr
        // numérote les panes par workspace/position, comme le vrai fil).
        routes.push(String::from("/api/agents/w0:p1/session?tail=65536"));
    }
    // `sse-idle` : huit abonnés qui ne demandent rien, ouverts AVANT la charge.
    let flux = if options.scenario == "sse-idle" {
        Some(charge::FluxIdle::ouvre(&racine_http, "/api/events", 8))
    } else {
        None
    };
    // La sonde : ce que la pile rend AVANT la charge. Une mesure sur des 500
    // ne mesure pas une latence, elle mesure un échec.
    let mut sondes = Vec::new();
    // La sonde couvre la route qu'on ne saurait pas interpréter autrement :
    // en `delta32`, une latence sur une réponse d'erreur ne dit rien.
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
            "mode": if indice == 0 { "cold" } else { "warm" },
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
    // Les agrégats par mode : une p50 « froide » est celle du premier run,
    // une p50 « chaude » est la médiane des suivants — les deux sont publiées
    // séparément, parce qu'une moyenne des deux ne décrit aucun des deux.
    let agregats = agregats_par_mode(&runs);
    let demandes_fixture = fausse.servies();
    drop(flux);
    drop(detenteur);
    let _ = serveur.kill();
    let _ = serveur.wait();
    Ok(json!({
        "pile": pile,
        "commande": format!(
            "HERDR_SOCKET_PATH=<fixture>/herdr-fixture.sock HERDR_REMOTE_PORT={port} HERDR_REMOTE_BIND=127.0.0.1 {}",
            if pile == "rust" { "target/{release,debug}/herdrchat" } else { "bun run <ts-root>/apps/server/src/main.ts" }
        ),
        "pret_ms": attente.as_millis(),
        "routes": routes,
        "sondes": sondes,
        "verrou_tenu": verrou,
        "journal_serveur": if options.keep { atelier.journal() } else { String::new() },
        "dossier": if options.keep { atelier.racine.display().to_string() } else { String::new() },
        "demandes_fixture": demandes_fixture,
        "runs": runs,
        "agregats": agregats,
    }))
}

/// La médiane des p50/p95 par mode (`cold` = le premier run, `warm` = les
/// autres) et les totaux de requêtes/CPU/RSS.
fn agregats_par_mode(runs: &[Value]) -> Value {
    let mut sortie = serde_json::Map::new();
    for mode in ["cold", "warm"] {
        let selection: Vec<&Value> = runs
            .iter()
            .filter(|run| run.get("mode").and_then(Value::as_str) == Some(mode))
            .collect();
        if selection.is_empty() {
            continue;
        }
        let mediane = |cle: &str| -> u128 {
            let mut valeurs: Vec<u128> = selection
                .iter()
                .filter_map(|run| run.get(cle).and_then(Value::as_u64))
                .map(u128::from)
                .collect();
            if valeurs.is_empty() {
                return 0;
            }
            valeurs.sort_unstable();
            valeurs[valeurs.len() / 2]
        };
        let somme = |cle: &str| -> u64 {
            selection
                .iter()
                .filter_map(|run| run.get(cle).and_then(Value::as_u64))
                .sum()
        };
        sortie.insert(
            String::from(mode),
            json!({
                "runs": selection.len(),
                "p50_us": mediane("p50_us"),
                "p95_us": mediane("p95_us"),
                "p99_us": mediane("p99_us"),
                "requetes": somme("requetes"),
                "cpu_ms": somme("cpu_ms"),
                "rss_max_kio": selection
                    .iter()
                    .filter_map(|run| run.get("rss_max_kio").and_then(Value::as_u64))
                    .max()
                    .unwrap_or(0),
            }),
        );
    }
    Value::Object(sortie)
}

/// Le point d'entrée du sous-commande, pour `xtask bench`.
pub fn entree(racine: &Path, arguments: &[String]) -> Result<(), String> {
    let options = Options::depuis(arguments, racine)?;
    let debut = Instant::now();
    execute(&options)?;
    println!("banc terminé en {:?}", debut.elapsed());
    Ok(())
}

/// `xtask fixture-daemon` — un démon `herdrchat` RÉEL servi par la fausse
/// Herdr et des sessions synthétiques copiées du bundle (T067/T072).
///
/// ⚠️ **Fixture uniquement.** Le socket est la fausse du banc (elle refuse
/// nommément toute méthode de mutation), les sessions sont des copies dans un
/// dossier temporaire, `HOME` est un dossier temporaire (aucun store, aucune
/// clé, aucun abonnement de l'utilisateur n'est lu), et le `PATH` est réduit
/// (la CLI Tailscale n'est pas interrogée). Le démon écoute sur un port libre
/// du loopback, jamais sur 8791.
///
/// Protocole pour un pilote (navigateur headless) : une ligne
/// `FIXTURE_PRETE http://127.0.0.1:<port>` sur la sortie standard, puis le
/// démon vit jusqu'à la fermeture de l'entrée standard, `--seconds` écoulées
/// ou sa propre sortie. Le banc tue alors le seul processus qu'il a lancé.
pub fn sert_fixture(racine: &Path, arguments: &[String]) -> Result<(), String> {
    use std::io::{BufRead as _, Write as _};
    // Défauts propres à la fixture : 3 panes, 10 minutes au plus.
    let mut avec_defauts = vec![
        String::from("--stack"),
        String::from("rust"),
        String::from("--panes"),
        String::from("3"),
        String::from("--seconds"),
        String::from("600"),
    ];
    avec_defauts.extend_from_slice(arguments);
    let options = Options::depuis(&avec_defauts, racine)?;
    if options.pile != "rust" {
        return Err(String::from(
            "fixture-daemon ne sert que le démon Rust (--stack rust)",
        ));
    }
    let atelier = Atelier::prepare(&options)?;
    let maison = atelier.racine.join("home");
    std::fs::create_dir_all(&maison).map_err(|cause| format!("HOME de fixture : {cause}"))?;
    let fausse = fixture::Fausse::demarre(
        &atelier.racine,
        fixture::Plan {
            panes: options.panes,
            sessions: atelier.sessions.clone(),
            sqlite_session: None,
        },
    )?;
    let port = port_libre()?;
    let mut serveur = commande(&options, "rust", port, &atelier)?
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &maison)
        .env("HERDR_SOCKET_PATH", fausse.chemin())
        .env("HERDR_REMOTE_PORT", port.to_string())
        .env("HERDR_REMOTE_BIND", "127.0.0.1")
        .env("HERDR_REMOTE_LOG_PATH", atelier.racine.join("banc.log"))
        .env("HERDR_REMOTE_PUSH_STORE", atelier.racine.join("push.json"))
        .env("PI_SESSIONS_ROOT", atelier.racine.join("sessions"))
        .env("CLAUDE_PROJECTS_ROOT", atelier.racine.join("sessions"))
        .env("CODEX_SESSION_ROOT", atelier.racine.join("codex-absent"))
        .env("OPENCODE_DB", atelier.racine.join("pas-de-base.db"))
        .env("DEVIN_DB", atelier.racine.join("pas-de-base-devin.db"))
        .spawn()
        .map_err(|cause| format!("lancement du démon de fixture : {cause}"))?;
    let racine_http = format!("127.0.0.1:{port}");
    if let Err(cause) = mesure::attend_pret(&racine_http, "/api/health", Duration::from_secs(60)) {
        let _ = serveur.kill();
        let _ = serveur.wait();
        return Err(format!("démon de fixture non prêt : {cause}"));
    }
    println!("FIXTURE_PRETE http://{racine_http}");
    let _ = std::io::stdout().flush();

    // La fin : entrée standard fermée (le pilote a terminé), délai écoulé, ou
    // sortie du démon lui-même.
    let (envoi, reception) = std::sync::mpsc::channel::<()>();
    thread::spawn(move || {
        let entree = std::io::stdin();
        for ligne in entree.lock().lines() {
            if ligne.is_err() {
                break;
            }
        }
        let _ = envoi.send(());
    });
    let fin = Instant::now() + Duration::from_secs(options.secondes);
    let issue = loop {
        if let Ok(Some(statut)) = serveur.try_wait() {
            break Err(format!("le démon de fixture s'est arrêté seul ({statut})"));
        }
        if reception.try_recv().is_ok() {
            break Ok(());
        }
        if Instant::now() >= fin {
            break Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    };
    let _ = serveur.kill();
    let _ = serveur.wait();
    eprintln!(
        "fixture : {} demande(s) servies par la fausse Herdr",
        fausse.servies()
    );
    drop(fausse);
    issue
}
