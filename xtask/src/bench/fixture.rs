//! La **fausse Herdr** du banc d'essai (T065).
//!
//! ⚠️ **Pourquoi une fausse, alors qu'un vrai socket existe.** Un banc d'essai
//! doit être reproductible : mêmes panes, mêmes sessions, même taille de
//! fichier, sur les deux piles et sur n'importe quelle machine. Le vrai Herdr
//! de l'utilisateur change sous nos pieds (les agents travaillent), et on ne
//! pilote pas son état : le mesurer reviendrait à mesurer autre chose à chaque
//! exécution.
//!
//! ⚠️ **Le fil est celui qu'on a MESURÉ** (T056) : une connexion par demande
//! (Herdr ferme après chaque réponse), identifiant en **chaîne**, résultat de
//! `session.snapshot` en **enveloppe** `{type, snapshot}`. Un faux qui
//! accepterait une autre forme mesurerait un protocole qui n'existe pas.
//!
//! Ce que la fausse sert : `ping`, `session.snapshot`, `agent.list`,
//! `integration.list`, `agent.read`. Le reste est refusé **nommément** — une
//! méthode inconnue ne rend pas un succès vide.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;

/// Le nombre de panes que la fausse annonce, et la session que chacun publie.
pub struct Plan {
    pub panes: usize,
    /// Les fichiers de session publiés, un par pane (cyclique).
    pub sessions: Vec<PathBuf>,
}

/// Une fausse Herdr en cours d'exécution.
pub struct Fausse {
    chemin: PathBuf,
    arret: Arc<AtomicBool>,
    /// Le nombre de demandes servies — le compteur qui dit si la charge a
    /// réellement eu lieu (un banc qui mesure 0 requête ne mesure rien).
    servies: Arc<AtomicU64>,
}

impl Fausse {
    /// Lie le socket et sert en tâche de fond. Le fichier est supprimé à la
    /// création : un socket laissé par une exécution précédente ferait échouer
    /// `bind` pour une raison sans rapport.
    pub fn demarre(racine: &Path, plan: Plan) -> Result<Self, String> {
        let chemin = racine.join("herdr-fixture.sock");
        let _ = std::fs::remove_file(&chemin);
        let ecoute = UnixListener::bind(&chemin)
            .map_err(|cause| format!("bind de la fausse Herdr : {cause}"))?;
        let arret = Arc::new(AtomicBool::new(false));
        let servies = Arc::new(AtomicU64::new(0));
        let plan = Arc::new(plan);
        let arret_fils = Arc::clone(&arret);
        let servies_fils = Arc::clone(&servies);
        thread::spawn(move || {
            for flux in ecoute.incoming() {
                if arret_fils.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(flux) = flux else { break };
                let plan = Arc::clone(&plan);
                let compteur = Arc::clone(&servies_fils);
                thread::spawn(move || {
                    let _ = sert(flux, &plan, &compteur);
                });
            }
        });
        Ok(Self {
            chemin,
            arret,
            servies,
        })
    }

    #[must_use]
    pub fn chemin(&self) -> &Path {
        &self.chemin
    }

    #[must_use]
    pub fn servies(&self) -> u64 {
        self.servies.load(Ordering::SeqCst)
    }
}

impl Drop for Fausse {
    fn drop(&mut self) {
        self.arret.store(true, Ordering::SeqCst);
        // Un `connect` réveille l'accept bloqué : sans lui, le fil de service
        // survivrait au test et garderait le socket.
        let _ = UnixStream::connect(&self.chemin);
        let _ = std::fs::remove_file(&self.chemin);
    }
}

fn sert(flux: UnixStream, plan: &Plan, compteur: &AtomicU64) -> std::io::Result<()> {
    let lecteur = BufReader::new(flux.try_clone()?);
    let mut ecriture = flux;
    let mut ligne = String::new();
    let mut lecteur = lecteur;
    if lecteur.read_line(&mut ligne)? == 0 {
        return Ok(());
    }
    let demande: Value = serde_json::from_str(ligne.trim()).unwrap_or(Value::Null);
    // ⚠️ Mesuré : l'identifiant du fil est une CHAÎNE. On le rend tel quel.
    let identifiant = demande
        .get("id")
        .cloned()
        .unwrap_or_else(|| Value::String(String::from("0")));
    let methode = demande
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let resultat = match methode {
        "ping" => Ok(json!({ "protocol": 22, "version": "0.9.3" })),
        "session.snapshot" => Ok(json!({
            "type": "snapshot",
            "snapshot": photo(plan),
        })),
        "agent.list" => Ok(json!({ "agents": agents(plan) })),
        "integration.list" => Ok(json!({ "integrations": integrations() })),
        "agent.read" => Ok(json!({
            "read": { "text": "écran de banc d'essai\n", "truncated": false }
        })),
        autre => Err(format!("méthode non servie par la fausse : {autre}")),
    };
    let reponse = match resultat {
        Ok(valeur) => json!({ "id": identifiant, "result": valeur }),
        Err(message) => json!({
            "id": identifiant,
            "error": { "code": -32_601, "message": message }
        }),
    };
    compteur.fetch_add(1, Ordering::SeqCst);
    writeln!(ecriture, "{reponse}")?;
    ecriture.flush()
}

/// La photo : `agents`, `workspaces`, `protocol`, `version`, focus omis.
fn photo(plan: &Plan) -> Value {
    let workspaces: Vec<Value> = (0..plan.panes.div_ceil(4))
        .map(|indice| {
            let ident = format!("w{indice}");
            json!({
                "workspace_id": ident,
                "label": format!("banc-{indice}"),
                "tab_count": 1,
                "pane_count": 4,
                "focused": false,
            })
        })
        .collect();
    json!({
        "agents": agents(plan),
        "protocol": 22,
        "version": "0.9.3",
        "workspaces": workspaces,
    })
}

fn agents(plan: &Plan) -> Vec<Value> {
    (0..plan.panes)
        .map(|indice| {
            let session = plan
                .sessions
                .get(indice % plan.sessions.len().max(1))
                .map(|chemin| chemin.to_string_lossy().to_string());
            let mut agent = json!({
                "pane_id": format!("w{}:p{}", indice / 4, indice % 4 + 1),
                "tab_id": format!("w{}:t1", indice / 4),
                "workspace_id": format!("w{}", indice / 4),
                "terminal_id": format!("t{indice}"),
                "agent": "pi",
                "agent_status": "idle",
                "revision": 0,
                "focused": false,
                "cwd": "/tmp/banc",
                "terminal_title": format!("banc {indice} — essai"),
            });
            if let (Some(chemin), Some(objet)) = (session, agent.as_object_mut()) {
                objet.insert(
                    "agent_session".to_string(),
                    json!({
                        "agent": "pi",
                        "kind": "path",
                        "source": "published",
                        "value": chemin
                    }),
                );
            }
            agent
        })
        .collect()
}

fn integrations() -> Vec<Value> {
    ["pi", "claude", "codex", "cursor", "devin"]
        .iter()
        .map(|commande| {
            json!({
                "available": true,
                "command": commande,
                "label": commande,
                "state": "current",
                "target": commande,
            })
        })
        .collect()
}
