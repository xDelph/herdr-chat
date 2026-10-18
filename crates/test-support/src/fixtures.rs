//! Charges synthétiques : snapshot canonique, écran de référence, lignes JSONL
//! déterministes et le faux processus de catalogue.
//!
//! ⚠️ **Tout est généré, rien n'est déduit du monde réel.** Les charges sont
//! fonctions d'une graine (xorshift, sans dépendance) : la même graine rend
//! les mêmes octets — la reproductibilité se teste, elle ne se promet pas.
//!
//! ⚠️ Les charges **classées** portent leur classement dans leur chemin :
//! `{stockage}/{famille}/{agent}/version-{n}` — le tri par dossiers est la
//! mémoire de ce qui a été simulé.

use crate::temp_stores::RacineJetable;
use domain::ids::{AgentKind, AgentName, PaneId, TabId, WorkspaceId};
use domain::observation::{
    AgentObservation, AgentSessionRef, LayoutPane, PaneLayoutObservation, ReadSource, RectCell,
    ScreenObservation, SessionRefKind, Snapshot, SnapshotProvenance, TabObservation,
    WorkspaceObservation,
};
use domain::status::AgentStatus;
use serde_json::json;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// La graine du corpus de référence (T001) — même nombre, même intention.
pub const GRAINE_DU_CORPUS: u64 = 20_240_310;

/// Les cinq panes de la disposition mesurée, en ordre de lecture :
/// `p1`, `p2` (rangée du haut), `p4`, `p3` (rangée du milieu — **l'ordre
/// visuel n'est pas l'ordre des identifiants**), puis `p5` pleine largeur.
/// 95+95 colonnes, 26+28+28 lignes : la fenêtre mesurée 190×82.
pub(crate) const GRANDE_AFFICHAGE_RECTS: [(&str, i64, i64, i64, i64, bool); 5] = [
    ("p1", 0, 0, 95, 26, true),
    ("p2", 95, 0, 95, 26, false),
    ("p4", 0, 26, 95, 28, false),
    ("p3", 95, 26, 95, 28, false),
    ("p5", 0, 54, 190, 28, false),
];

/// Un générateur déterministe (xorshift64) — la graine zéro est interdite
/// (elle resterait zéro) et est réduite à 1.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Graine(u64);

impl Graine {
    /// La graine par défaut, celle du corpus de référence.
    #[must_use]
    pub fn par_defaut() -> Self {
        Self(GRAINE_DU_CORPUS)
    }

    /// Une graine explicite — testable, jamais aléatoire.
    #[must_use]
    pub fn de(valeur: u64) -> Self {
        Self(valeur.max(1))
    }

    /// Le mot suivant de 64 bits. Une suite fixe : reproductible par construction.
    #[must_use]
    pub fn suivant(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
}

/// L'axe « stockage » d'une charge — le seul axe binaire.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Stockage {
    /// Session en JSONL, canal texte.
    Jsonl,
    /// Magasin de session en SQLite (fichier réel, librairie réelle).
    Sqlite,
}

/// Un classement de charge : le chemin dit tout.
///
/// `jsonl/pi/faux-1/version-2/…` — on lit le stockage, la famille, l'agent
/// simulé et la version sans ouvrir le fichier.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Classement {
    pub stockage: Stockage,
    /// La famille de source simulée (`pi`, `codex`, …) — une valeur de test,
    /// jamais une liste d'instances réelles.
    pub famille: String,
    /// L'agent simulé.
    pub agent: String,
    /// La version du magasin simulé.
    pub version: u64,
}

impl Classement {
    /// Le chemin relatif sous une racine — à passer aux magasins.
    #[must_use]
    pub fn relatif(&self) -> String {
        let stockage = match self.stockage {
            Stockage::Jsonl => "jsonl",
            Stockage::Sqlite => "sqlite",
        };
        format!(
            "{stockage}/{}/{}/version-{}",
            self.famille, self.agent, self.version
        )
    }

    /// Le chemin absolu sous la racine — pour les assertions.
    #[must_use]
    pub fn chemin_sous(&self, racine: &Path) -> PathBuf {
        racine.join(self.relatif())
    }
}

/// Le snapshot canonique : un workspace, un tab, la disposition mesurée à
/// cinq panes, trois agents placés dessus.
///
/// ⚠️ Champs d'absence volontaires : le worktree du workspace est absent
/// (le repli D02 par `cwd` de pane s'exercera alors au T039), l'agent du
/// `p2` n'a ni nom, ni session simulée — une **absence**, pas une valeur vide.
#[must_use]
pub fn snapshot_de_base() -> Snapshot {
    let workspace = WorkspaceId::from(String::from("wA"));
    let tab = TabId::from(String::from("tA"));

    let agents = vec![
        AgentObservation {
            pane_id: PaneId::from(String::from("p1")),
            tab_id: tab.clone(),
            workspace_id: workspace.clone(),
            terminal_id: String::from("term-1"),
            revision: 0,
            status: AgentStatus::Working,
            focused: true,
            agent: Some(AgentKind::from(String::from("pi"))),
            name: Some(AgentName::from(String::from("atelier-un"))),
            terminal_title: Some(String::from("atelier-un — pi")),
            cwd: Some(String::from("/projets/atelier")),
            foreground_cwd: Some(String::from("/projets/atelier")),
            completion_seq: Some(2),
            state_change_seq: Some(1),
            session: Some(AgentSessionRef {
                kind: SessionRefKind::Path,
                value: String::from("/fixtures-fausses/pi/atelier-un.jsonl"),
            }),
        },
        AgentObservation {
            pane_id: PaneId::from(String::from("p2")),
            tab_id: tab.clone(),
            workspace_id: workspace.clone(),
            terminal_id: String::from("term-2"),
            revision: 0,
            status: AgentStatus::Idle,
            focused: false,
            agent: Some(AgentKind::from(String::from("codex"))),
            name: None,
            terminal_title: Some(String::from("● codex")),
            cwd: Some(String::from("/projets/autre")),
            foreground_cwd: Some(String::from("/projets/autre")),
            completion_seq: None,
            state_change_seq: None,
            session: None,
        },
        AgentObservation {
            pane_id: PaneId::from(String::from("p3")),
            tab_id: tab.clone(),
            workspace_id: workspace.clone(),
            terminal_id: String::from("term-3"),
            revision: 0,
            status: AgentStatus::Done,
            focused: false,
            agent: Some(AgentKind::from(String::from("pi"))),
            name: Some(AgentName::from(String::from("atelier-deux"))),
            terminal_title: Some(String::from("❯ atelier-deux")),
            cwd: Some(String::from("/projets/troisieme")),
            foreground_cwd: Some(String::from("/projets/troisieme")),
            completion_seq: Some(5),
            state_change_seq: Some(3),
            session: Some(AgentSessionRef {
                kind: SessionRefKind::Path,
                value: String::from("/fixtures-fausses/pi/atelier-deux.jsonl"),
            }),
        },
    ];

    let workspaces = vec![WorkspaceObservation {
        workspace_id: workspace.clone(),
        label: Some(String::from("atelier")),
        agent_status: Some(AgentStatus::Working),
        focused: Some(true),
        number: Some(1),
        pane_count: Some(3),
        tab_count: Some(1),
        active_tab_id: Some(tab.clone()),
        worktree: None,
    }];

    let tabs = vec![TabObservation {
        tab_id: tab.clone(),
        workspace_id: workspace.clone(),
        label: Some(String::from("atelier — principal")),
        number: 1,
        agent_status: Some(String::from("working")),
        pane_count: Some(5),
    }];

    let panes = GRANDE_AFFICHAGE_RECTS
        .iter()
        .map(|(identifiant, x, y, width, height, focused)| LayoutPane {
            pane_id: PaneId::from(String::from(*identifiant)),
            focused: *focused,
            rect: RectCell {
                x: *x,
                y: *y,
                width: *width,
                height: *height,
            },
        })
        .collect();

    let layouts = vec![PaneLayoutObservation {
        tab_id: tab.clone(),
        workspace_id: workspace.clone(),
        focused_pane_id: PaneId::from(String::from("p1")),
        panes,
    }];

    Snapshot {
        agents,
        workspaces,
        tabs: Some(tabs),
        layouts: Some(layouts),
        focused_pane: Some(PaneId::from(String::from("p1"))),
        focused_tab: Some(tab),
        focused_workspace: Some(workspace),
        provenance: Some(SnapshotProvenance {
            version: String::from("0.9.3"),
            protocol: 22,
        }),
    }
}

/// L'écran canonique du `p1` : une invite, un texte fixé d'avance, pas
/// tronqué, source `visible`.
#[must_use]
pub fn ecran_de_base() -> ScreenObservation {
    ScreenObservation {
        pane_id: PaneId::from(String::from("p1")),
        text: Some(String::from(
            "❯ atelier — pi\n> écris le rapport\n● travail en cours\n",
        )),
        truncated: Some(false),
        source: Some(ReadSource::Visible),
    }
}

/// Les horodatages canoniques, cinq secondes d'intervalle dans la même
/// heure — une table fixe : aucun calcul de date, aucune dépendance.
const HORODATAGES: [&str; 12] = [
    "2024-03-05T08:00:00.000Z",
    "2024-03-05T08:00:05.000Z",
    "2024-03-05T08:00:10.000Z",
    "2024-03-05T08:00:15.000Z",
    "2024-03-05T08:00:20.000Z",
    "2024-03-05T08:00:25.000Z",
    "2024-03-05T08:00:30.000Z",
    "2024-03-05T08:00:35.000Z",
    "2024-03-05T08:00:40.000Z",
    "2024-03-05T08:00:45.000Z",
    "2024-03-05T08:00:50.000Z",
    "2024-03-05T08:00:55.000Z",
];

const MOTS: [&str; 10] = [
    "corrélation",
    "dédup",
    "repli",
    "écran",
    "verdict",
    "cause",
    "pane",
    "octets",
    "relecture",
    "empirique",
];

/// Charge JSONL déterministe : messages « à plat » (utilisateur) et
/// « enveloppés » (assistant, pensée incluse) — **les deux formes mesurées
/// sur le corpus T001** — plus une ligne au type `opaque-reste` (une sur
/// cinq), volontairement hors de toute famille connue : son sort appartient
/// au lecteur (T023), jamais au générateur.
///
/// ⚠️ Même graine, mêmes octets. Identités `msg-{i}-u` / `msg-{i}-a`.
#[must_use]
pub fn charges_pi(graine: &mut Graine, quantite: usize) -> Vec<String> {
    let mut charges = Vec::with_capacity(quantite);
    for index in 0..quantite {
        let premier = MOTS[(graine.suivant() % MOTS.len() as u64) as usize];
        let second = MOTS[(graine.suivant() % MOTS.len() as u64) as usize];
        let horodatage = HORODATAGES[index % HORODATAGES.len()];
        let charge = if index % 5 == 4 {
            json!({
                "type": "opaque-reste",
                "index": index,
                "graine": graine.suivant() % 1_000,
            })
        } else if index % 2 == 0 {
            json!({
                "type": "message",
                "id": format!("msg-{index}-u"),
                "role": "user",
                "timestamp": horodatage,
                "content": [{ "type": "text", "text": format!("charge {index} — {premier}") }],
            })
        } else {
            json!({
                "type": "message",
                "id": format!("msg-{index}-a"),
                "timestamp": horodatage,
                "message": {
                    "role": "assistant",
                    "model": "faux-modele",
                    "provider": "faux-fournisseur",
                    "content": [
                        { "type": "thinking", "thinking": format!("compte tenu de {premier} et de {second}") },
                        { "type": "text", "text": format!("réponse {index} — {second}") },
                    ],
                },
            })
        };
        charges.push(charge.to_string());
    }
    charges
}

/// Le snapshot canonique, chargé à `quantite` agents.
///
/// ⚠️ Le canonique porte la disposition mesurée à cinq panes : les agents
/// surnuméraires occupent d'abord les panes libres **connus** (`p4`, `p5`),
/// puis gagnent des rangées de bas de page `p6`, `p7`, … (14 lignes de
/// haut, pleine largeur). Nommage `spawn-{n}` aligné sur la pane, genre
/// `pi`/`codex` en alternance, statuts en rotation, session simulée pour
/// un pane sur deux. `quantite` plus petit que le canonique **tronque** :
/// garder la tête, couper la queue.
#[must_use]
pub fn charges_snapshot(quantite: usize) -> Snapshot {
    let mut snap = snapshot_de_base();
    if quantite < snap.agents.len() {
        snap.agents.truncate(quantite);
        return snap;
    }
    let workspace = WorkspaceId::from(String::from("wA"));
    let tab = TabId::from(String::from("tA"));
    let mut libres: std::collections::VecDeque<String> =
        std::collections::VecDeque::from(vec![String::from("p4"), String::from("p5")]);
    let mut index_pane = 5_u64;
    while snap.agents.len() < quantite {
        let nom_pane = match libres.pop_front() {
            Some(nom) => nom,
            None => {
                index_pane += 1;
                format!("p{index_pane}")
            }
        };
        let num = nom_pane.trim_start_matches('p').to_string();
        let rang = snap.agents.len() as u64;
        let genre = if rang.is_multiple_of(2) {
            "pi"
        } else {
            "codex"
        };
        let statut = [
            AgentStatus::Working,
            AgentStatus::Idle,
            AgentStatus::Blocked,
            AgentStatus::Done,
        ][rang as usize % 4];
        let pane = PaneId::from(nom_pane.clone());
        let sur_libre = nom_pane == "p4" || nom_pane == "p5";
        let rangee = (!sur_libre).then(|| LayoutPane {
            pane_id: pane.clone(),
            focused: false,
            rect: RectCell {
                x: 0,
                y: 82 + (rang - 5) as i64 * 14,
                width: 190,
                height: 14,
            },
        });
        if let Some(rangee) = rangee {
            match snap.layouts.as_mut() {
                Some(layouts) => match layouts.first_mut() {
                    Some(premiere) => premiere.panes.push(rangee),
                    None => {
                        panic!("le snapshot canonique porte une disposition à au moins une rangée")
                    }
                },
                None => panic!("le snapshot canonique porte une disposition"),
            }
        }
        snap.agents.push(AgentObservation {
            pane_id: pane,
            tab_id: tab.clone(),
            workspace_id: workspace.clone(),
            terminal_id: format!("term-{num}"),
            revision: 0,
            status: statut,
            focused: false,
            agent: Some(AgentKind::from(genre.to_string())),
            name: Some(AgentName::from(format!("spawn-{num}"))),
            terminal_title: Some(format!("spawn-{num} — {genre}")),
            cwd: Some(String::from("/projets/atelier")),
            foreground_cwd: Some(String::from("/projets/atelier")),
            completion_seq: Some(rang),
            state_change_seq: Some(1),
            session: if rang.is_multiple_of(2) {
                Some(AgentSessionRef {
                    kind: SessionRefKind::Path,
                    value: format!("/fixtures-fausses/pi/spawn-{num}.jsonl"),
                })
            } else {
                None
            },
        });
    }
    snap
}

/// Un processus de catalogue factice : un script `sh` **réel**, écrit sous
/// la racine jetable, qui note chaque argument dans un journal frère puis
/// rend la sortie programmée avec son code. Le spawn revient au
/// consommateur (test ou crate catalogue, T031) — ici, le mécanisme.
///
/// ⚠️ Aucun CLI d'agent, aucun socket, aucune entrée à un agent : le script
/// ne touche que son journal et sa sortie, tous deux sous la racine.
pub struct ProcessusFaux {
    racine: Arc<RacineJetable>,
    /// Le script à invoquer (`/bin/sh {chemin_script} …`).
    pub chemin_script: PathBuf,
    /// Le journal des arguments — une ligne par argument, d'une invocation
    /// à l'autre (jamais tronqué ; la lecture à vide veut dire « aucune
    /// invocation », pas une panne).
    pub chemin_journal: PathBuf,
}

/// Le délimiteur du heredoc — choisi pour n'appartenir à aucun JSON de
/// catalogue réel.
const DELIMITEUR_HEREDOC: &str = "ERRATA-JETABLE-2024";

impl ProcessusFaux {
    /// Crée le script. La sortie est rendue **telle quelle** ; une sortie
    /// vide tient en une ligne vide (le heredoc rend toujours son saut de
    /// ligne final). Un texte contenant le délimiteur est un refus, pas une
    /// réécriture silencieuse.
    pub fn nouveau(racine: &Arc<RacineJetable>, sortie: &str, code: i32) -> io::Result<Self> {
        if sortie.contains(DELIMITEUR_HEREDOC) {
            return Err(io::Error::other("la sortie contient le délimiteur heredoc"));
        }
        let dossier = racine.chemin().join("catalogue-faux");
        fs::create_dir_all(&dossier)?;
        let chemin_script = dossier.join("faux.sh");
        let chemin_journal = dossier.join("argv-journal");
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$(dirname \"$0\")/argv-journal\"\ncat <<'{delimiteur}'\n{sortie}\n{delimiteur}\nexit {code}\n",
            delimiteur = DELIMITEUR_HEREDOC,
            sortie = sortie,
            code = code,
        );
        fs::write(&chemin_script, script)?;
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&chemin_script)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&chemin_script, permissions)?;
        Ok(Self {
            racine: racine.clone(),
            chemin_script,
            chemin_journal,
        })
    }

    /// La racine qui porte le script — le consommateur peut garder la main
    /// sur la durée de vie et prouver l'isolation.
    #[must_use]
    pub fn racine(&self) -> &Arc<RacineJetable> {
        &self.racine
    }

    /// Les arguments notés par les invocations passées — une ligne par
    /// argument, ordre conservé. Aucune invocation = aucune ligne, pas
    /// d'erreur ; toute autre panne de lecture est rapportée telle quelle.
    pub fn arguments(&self) -> io::Result<Vec<String>> {
        match fs::read_to_string(&self.chemin_journal) {
            Ok(texte) => Ok(texte.lines().map(String::from).collect()),
            Err(cause) if cause.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(cause) => Err(cause),
        }
    }
}
