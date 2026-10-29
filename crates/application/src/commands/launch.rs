//! Le moteur de lancement (T037/C07/A06–A08) : **tout valider avant
//! l'onglet**, nom généré **réservé**, onglet non focalisé sur le dossier
//! connu, démarrage avec le budget du fil (3 s × 10 sur le seul refus
//! coquille, délai 125 s, budget global 160 s), nettoyage **possédé**
//! seulement, confiance renvoyée **sans réponse automatique**.
//!
//! ⚠️ **C07 — « valider d'abord »** : la validation de la demande (kind,
//! modèle, raisonnement — T030, injectée ici) précède TOUT appel au port ;
//! le projet, le dossier et le nom sont vérifiés sur une observation
//! **fraîche** avant `create_tab`. Une entrée invalide crée **zéro onglet**
//! (le fil créait l'onglet AVANT de construire les args, puis fermait —
//! C07 corrige l'ordre).
//!
//! ⚠️ **Le graphe du workspace** : `application` ne dépend ni de `catalog`
//! ni de `sessions`. La construction des args (T030) et la disponibilité
//! réelle (T013, `integration.list`) sont **injectées** par la composition
//! (herdrchat/T056) ; le moteur n'importe que le port et le nommage.
//!
//! ⚠️ **La réservation de nom** : deux lancements CONCURRENTS du même
//! libellé voient le second décalé (`atelier-1`, `atelier-2`…) même si la
//! photo est la même ; le conflit de nom **amont reste autoritaire** (TECH
//! §4). La réservation vit le temps du budget global et expire d'elle-même.
//!
//! ⚠️ **Le nettoyage possédé** : seul l'onglet **créé par cette opération**
//! est fermé, et seulement quand l'agent n'a **jamais** amorcé (budget
//! coquille épuisé) — jamais un onglet d'un autre, jamais un agent dont le
//! démarrage a expiré sans verdict (C07 ; « timeout ambigu ne double pas
//! l'agent »).
//!
//! ⚠️ **La confiance** : un démarrage refusé **« blocked »** (le texte
//! mesuré) déclenche une lecture d'écran ; si l'invite de confiance y est,
//! la décision est EXPOSÉE (`ConfianceRequise`) — aucune touche n'est
//! jamais envoyée d'ici (l'invite est persistante et exécute du code).

use crate::commands::pousse;
use domain::errors::PortError;
use domain::ids::{AgentKind, AgentName, PaneId, TabId, WorkspaceId};
use domain::naming::{checkout_path_of, launch_name, useful_label};
use domain::observation::{ScreenObservation, Snapshot, WorkspaceObservation};
use domain::ports::{ControlPort, CreateTab, ScreenRead, StartAgent, StartEvidence};
use interactions::confiance::est_invite_confiance;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// L'écart entre deux essais coquille — 3 s (le fil : `spaced("3 seconds")`).
pub const INTERVALLE_ESSAIS_SHELL: Duration = Duration::from_secs(3);
/// Le nombre maximal d'essais coquille — 10 (le fil, puis l'échec).
pub const ESSAIS_SHELL_MAX: usize = 10;
/// Le délai de démarrage — 125 s (le 120 s de détection amont + marge, C07).
pub const DELAI_DEMARRAGE: Duration = Duration::from_secs(125);
/// Le budget global d'un lancement — 160 s (30 s de retries coquille +
/// une tentative de 125 s au plus, TECH §4). Le moteur le vérifie comme
/// plafond absolu ; le délai effectif d'une tentative est borné par le
/// port (125 s, T012).
pub const BUDGET_TOTAL: Duration = Duration::from_secs(160);
/// La durée de vie d'une réservation de nom — le budget global plus une
/// marge : une réservation ne bloque jamais plus longtemps qu'une opération
/// complète.
const VIE_RESERVATION: Duration = Duration::from_secs(180);
/// Le texte mesuré du démarrage refusé PARCE QUE l'agent est bloqué.
const TEXTE_BLOQUE: &str = "blocked";

/// L'horloge du moteur : attendre entre deux essais (production : le temps
/// réel ; tests : un compteur contrôlé). `ecoule` mesure la durée de
/// l'opération en cours — la source de vérité des délais.
pub trait HorlogeMoteur: Send + Sync {
    /// Attend/avance la durée donnée.
    fn attend(&self, duree: Duration);
    /// Le temps écoulé depuis le début de l'opération.
    fn ecoule(&self) -> Duration;
}

/// L'horloge réelle — `std` seul ; la composition (T056) décide sur quel
/// exécuteur elle est appelée (une attente bloquante ne doit pas occuper un
/// worker d'E/S).
pub struct HorlogeReelle {
    debut: Instant,
}

impl Default for HorlogeReelle {
    fn default() -> Self {
        Self {
            debut: Instant::now(),
        }
    }
}

impl HorlogeMoteur for HorlogeReelle {
    fn attend(&self, duree: Duration) {
        std::thread::sleep(duree);
    }

    fn ecoule(&self) -> Duration {
        self.debut.elapsed()
    }
}

/// La demande de lancement — la cible est **capturée** : jamais la
/// conversation affichée (T034).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct DemandeLancement {
    pub workspace: WorkspaceId,
    pub kind: AgentKind,
    /// Un nom demandé passe tel quel (conflit amont autoritaire).
    pub nom_demande: Option<AgentName>,
    pub modele: Option<String>,
    pub thinking: Option<String>,
}

/// L'issue d'un lancement — les deux valeurs du fil.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum IssueLancement {
    /// L'agent a démarré — `201` au fil : le pane ET l'onglet créés.
    Lance {
        kind: AgentKind,
        nom: AgentName,
        pane: PaneId,
        tab: TabId,
    },
    /// L'agent est là, bloqué sur l'invite de confiance : la décision est
    /// exposée à l'utilisateur (`trust-required`, 409) — **jamais** répondue.
    ConfianceRequise {
        kind: AgentKind,
        nom: AgentName,
        pane: PaneId,
        dossier: String,
    },
}

/// Un lancement refusé — chaque cause nommée, rien n'est masqué.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurLancement {
    /// La demande (kind, modèle, raisonnement) a été refusée par la
    /// validation injectée — AVANT tout onglet : zéro tab (C07, 400 au fil).
    ValidationRefusee { erreur: String },
    /// Le snapshot n'a pas pu être pris (amont indisponible, délai).
    SnapshotIndisponible { detail: String },
    /// Le snapshot est arrivé illisible (enveloppe, décodage).
    SnapshotIllisible { detail: String },
    /// Le projet n'existe pas dans l'observation fraîche (502 au fil).
    WorkspaceAbsent,
    /// Aucun dossier de travail connu pour le projet (502 au fil).
    DossierInconnu { label: String },
    /// Les 99 suffixes sont tous pris : plus aucun nom possible (C07 : on
    /// ne reprend jamais un nom occupé, on échoue honnêtement).
    NomEpuise { base: String },
    /// L'onglet n'a pas pu être créé — rien n'existe, rien à nettoyer
    /// (phase « onglet » au fil).
    OngletRefuse { detail: String },
    /// La coquille n'est JAMAIS devenue prête (10 × 3 s) : l'agent n'a
    /// jamais amorcé, l'onglet **possédé** est fermé (502 au fil).
    CoquilleNonPrete {
        pane: PaneId,
        tab: TabId,
        detail: String,
    },
    /// L'amont a refusé le démarrage — l'agent peut exister, l'onglet est
    /// GARDÉ et l'identité signalée (« l'onglet existe : le dire évite de
    /// relancer pour rien »).
    AgentRefuse {
        pane: PaneId,
        tab: TabId,
        detail: String,
    },
    /// Le démarrage a expiré SANS verdict : l'agent PEUT exister — jamais
    /// de double lancement (C07), jamais de fermeture : l'onglet est gardé.
    AmorcageAmbigu {
        pane: PaneId,
        tab: TabId,
        detail: String,
    },
}

/// Les noms réservés par des lancements en cours — la moitié locale de la
/// collision (le conflit amont reste autoritaire).
#[derive(Default)]
struct Reservations {
    noms: Mutex<HashMap<String, Instant>>,
}

impl Reservations {
    fn purge(&self) {
        let mut noms = self.noms.lock().unwrap_or_else(PoisonError::into_inner);
        let fin = Instant::now();
        noms.retain(|_, expire| *expire > fin);
    }

    /// Le nom généré à partir de la base, en évitant les noms pris (photo)
    /// ET réservés — ou `None` quand les 99 suffixes sont épuisés.
    fn genere(&self, base: &str, pris: &BTreeSet<String>) -> Option<AgentName> {
        self.purge();
        let noms = self.noms.lock().unwrap_or_else(PoisonError::into_inner);
        let mut occupes = pris.clone();
        for reserve in noms.keys() {
            occupes.insert(reserve.clone());
        }
        launch_name(base, &occupes)
    }

    /// Réserve un nom jusqu'à expiration — les concurrents du même libellé
    /// le verront occupé.
    fn reserve(&self, nom: &str) {
        let mut noms = self.noms.lock().unwrap_or_else(PoisonError::into_inner);
        noms.insert(nom.to_string(), Instant::now() + VIE_RESERVATION);
    }
}

/// La validation injectée des args (T030) : kind, modèle, raisonnement →
/// les args du modèle, ou le refus nommé.
pub type ConstructeurArgs =
    dyn Fn(&str, Option<&str>, Option<&str>) -> Result<Vec<String>, String> + Send + Sync;

/// Le moteur de lancement — partageable : la réservation de noms est
/// commune à toutes les demandes concurrentes.
#[derive(Default)]
pub struct LanceurAgent {
    reserves: Reservations,
}

impl LanceurAgent {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Lance un agent : valide, réserve le nom, crée l'onglet, attend la
    /// coquille, démarre — chaque étape nommée, le nettoyage borné au
    /// possédé, la confiance exposée sans y répondre.
    pub fn lance(
        &self,
        port: &dyn ControlPort,
        horloge: &dyn HorlogeMoteur,
        construit_args: &ConstructeurArgs,
        demande: &DemandeLancement,
    ) -> Result<IssueLancement, ErreurLancement> {
        /*
          ⚠️ **Les délais se mesurent depuis le début de CETTE opération.**
          L'horloge de production est partagée et créée au démarrage du démon :
          `ecoule()` y vaut l'uptime. Comparer l'uptime aux 125 s du délai de
          démarrage faisait échouer TOUS les lancements deux minutes après le
          démarrage (« start deadline exceeded » avant même le premier essai,
          onglet refermé). On retient l'instant de départ et on compare l'écart.
        */
        let debut = horloge.ecoule();
        let kind = demande.kind.as_str();
        // 1) La validation AVANT tout : les args de modèle/raisonnement
        // (T030, injectée) — un refus = zéro onglet, zéro appel au port.
        let args = construit_args(kind, demande.modele.as_deref(), demande.thinking.as_deref())
            .map_err(|erreur| ErreurLancement::ValidationRefusee { erreur })?;

        // 2) L'observation fraîche — la seule source de décision.
        let mut photo_port = port.snapshot();
        let photo = match pousse(&mut photo_port) {
            Ok(photo) => photo,
            Err(PortError::Transport { detail }) => {
                return Err(ErreurLancement::SnapshotIllisible { detail });
            }
            Err(cause) => {
                return Err(ErreurLancement::SnapshotIndisponible {
                    detail: cause.description(),
                });
            }
        };
        let workspace = photo
            .workspaces
            .iter()
            .find(|w| w.workspace_id == demande.workspace)
            .ok_or(ErreurLancement::WorkspaceAbsent)?;
        // Le dossier : une seule source (worktree lié gagne, sinon le
        // premier pane du projet qui porte un cwd — jamais deviné, C07).
        let labels = workspace.label.clone();
        let dossier = checkout_path_of(workspace, &domain::naming::panes_situes(&photo))
            .ok_or_else(|| ErreurLancement::DossierInconnu {
                label: label_du_workspace(workspace),
            })?;

        // 3) Le nom — demandé tel quel, ou généré avec numérotation dès le
        // premier, réservé contre les concurrents du même libellé.
        let pris = noms_pris(&photo);
        let nom = match &demande.nom_demande {
            Some(nom) => nom.clone(),
            None => self
                .reserves
                .genere(useful_label(labels.as_deref()).unwrap_or("agent"), &pris)
                .ok_or_else(|| ErreurLancement::NomEpuise {
                    base: useful_label(labels.as_deref())
                        .unwrap_or("agent")
                        .to_string(),
                })?,
        };
        self.reserves.reserve(nom.as_str());

        // 4) L'onglet — non focalisé, dossier connu, libellé = nom
        // (`CreateTab` du port : cwd + label, focus hors de la demande).
        let mut creation = port.create_tab(CreateTab {
            workspace: demande.workspace.clone(),
            cwd: dossier,
            label: Some(nom.as_str().to_string()),
        });
        let cree = match pousse(&mut creation) {
            Ok(cree) => cree,
            Err(cause) => {
                return Err(ErreurLancement::OngletRefuse {
                    detail: cause.description(),
                });
            }
        };
        let pane = cree.pane;
        let tab = cree.tab;

        // 5) La coquille, puis le démarrage — les délais du fil.
        let mut essais = 0usize;
        loop {
            // Le délai de démarrage (125 s) et le budget global (160 s) :
            // plus rien ne peut démarrer dans la fenêtre — l'agent n'a
            // jamais amorcé, l'onglet possédé est fermé.
            let ecoule = horloge.ecoule().saturating_sub(debut);
            if ecoule >= DELAI_DEMARRAGE || ecoule >= BUDGET_TOTAL {
                ferme_le_possede(port, &tab);
                return Err(ErreurLancement::CoquilleNonPrete {
                    pane: pane.clone(),
                    tab: tab.clone(),
                    detail: format!(
                        "start deadline exceeded ({} s) before the agent started",
                        DELAI_DEMARRAGE.as_secs()
                    ),
                });
            }
            let mut start = port.start_agent(StartAgent {
                pane: pane.clone(),
                kind: demande.kind.clone(),
                name: Some(nom.clone()),
                args: args.clone(),
            });
            match pousse(&mut start) {
                Ok(StartEvidence::Started { pane: occupe }) => {
                    return Ok(IssueLancement::Lance {
                        kind: demande.kind.clone(),
                        nom: nom.clone(),
                        pane: occupe,
                        tab,
                    });
                }
                // Le refus EXPLICITE de coquille — le seul cas rejoué.
                Ok(StartEvidence::ShellNotReady { detail }) => {
                    if essais >= ESSAIS_SHELL_MAX {
                        // L'agent n'a JAMAIS amorcé : l'onglet possédé est
                        // fermé, l'échec nomme la cause.
                        ferme_le_possede(port, &tab);
                        return Err(ErreurLancement::CoquilleNonPrete {
                            pane: pane.clone(),
                            tab,
                            detail,
                        });
                    }
                    essais += 1;
                    horloge.attend(INTERVALLE_ESSAIS_SHELL);
                }
                // Un refus amont : l'agent peut exister (bloqué ou non),
                // l'onglet est GARDÉ et l'identité signalée.
                Ok(StartEvidence::Failed { detail }) => {
                    if detail.to_lowercase().contains(TEXTE_BLOQUE) {
                        let ecran = lire_ecran(port, &pane);
                        if est_invite_confiance(&ecran) {
                            return Ok(IssueLancement::ConfianceRequise {
                                kind: demande.kind.clone(),
                                nom: nom.clone(),
                                pane: pane.clone(),
                                dossier: label_du_workspace(workspace),
                            });
                        }
                    }
                    return Err(ErreurLancement::AgentRefuse {
                        pane: pane.clone(),
                        tab,
                        detail,
                    });
                }
                // Un délai SANS verdict : jamais de retry, jamais de
                // fermeture — l'agent PEUT exister (C07), l'onglet reste.
                Err(PortError::Timeout) => {
                    return Err(ErreurLancement::AmorcageAmbigu {
                        pane: pane.clone(),
                        tab,
                        detail: String::from(
                            "start deadline exceeded without a verdict: the agent may exist; \
                             no second launch was attempted and the tab was kept",
                        ),
                    });
                }
                Err(cause) => {
                    return Err(ErreurLancement::AgentRefuse {
                        pane: pane.clone(),
                        tab,
                        detail: cause.description(),
                    });
                }
            }
        }
    }
}

/// Les noms d'agents déjà pris, tels que la photo fraîche les voit.
fn noms_pris(photo: &Snapshot) -> BTreeSet<String> {
    photo
        .agents
        .iter()
        .filter_map(|agent| agent.name.as_ref().map(|nom| nom.as_str().to_string()))
        .collect()
}

/// La lecture d'écran du démarrage bloqué — bornée, jamais une lecture sans
/// fin ; un échec de lecture rend un écran vide (le fil fait de même avant
/// de vérifier l'invite : sans texte, pas d'invite).
fn lire_ecran(port: &dyn ControlPort, pane: &PaneId) -> String {
    let mut lecture = port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: 256,
    });
    match pousse(&mut lecture) {
        Ok(ScreenObservation {
            text: Some(texte), ..
        }) => texte,
        _ => String::new(),
    }
}

/// La fermeture du tab **possédé** par cette opération — au mieux : un
/// échec de nettoyage ne change pas le verdict déjà décidé (le fil fait de
/// même, `Effect.ignore`).
fn ferme_le_possede(port: &dyn ControlPort, tab: &TabId) {
    let mut fermeture = port.fermer_onglet(tab.clone());
    let _ = pousse(&mut fermeture);
}
/// Le libellé humain d'un workspace — la valeur exposée à l'écran de
/// confiance quand aucun sens utile n'émerge (« this project » au fil).
fn label_du_workspace(workspace: &WorkspaceObservation) -> String {
    workspace
        .label
        .as_deref()
        .unwrap_or("this project")
        .to_string()
}
