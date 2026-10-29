//! Le service d'arrêt (T036/A04) : observation **fraîche**, Ctrl+C
//! **seulement** si l'agent est `working`, transmission jamais confondue
//! avec l'arrêt prouvé.
//!
//! ⚠️ **A04 — les quatre règles** : l'agent absent est une erreur (404 au
//! fil, T051) ; un agent non `working` est un **no-op** (rien à
//! interrompre — la valeur `not-running`, pas une panne) ; un agent
//! `working` reçoit Ctrl+C **via Herdr** (le port) ; la réponse dit que
//! l'interruption a été **transmise**, jamais que le processus est arrêté
//! (aucun PID, aucune découverte de processus — TECH §4).
//!
//! ⚠️ **L'observation est prise à l'appel** : aucun cache, aucune lecture
//! d'une photo antérieure — c'est le snapshot du moment qui décide. La
//! course entre la photo et l'envoi (l'agent a fini entre les deux) est
//! portée telle quelle : le port répond `NotRunning` → no-op honnête, pas
//! un faux « interrupt-sent ».

use super::pousse;
use domain::errors::PortError;
use domain::ids::PaneId;
use domain::ports::{ControlPort, StopEvidence};
use domain::status::AgentStatus;

/// Le service d'arrêt — sans état : chaque appel reprend une observation
/// fraîche.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ArreteurAgent;

/// L'issue d'un arrêt demandé — les deux valeurs 200 du fil.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum IssueArret {
    /// Ctrl+C transmis au terminal — **reçu, pas prouvé exécuté**.
    InterruptEnvoye,
    /// Rien n'était en cours : no-op (valeur `not-running`).
    NonEnCours,
}

/// Un arrêt refusé — chaque cause nommée, rien n'est masqué.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurArret {
    /// Aucun agent dans le pane (404 au fil).
    AgentAbsent { cible: PaneId },
    /// Le snapshot n'a pas pu être pris (amont indisponible, délai).
    SnapshotIndisponible { detail: String },
    /// Le snapshot est arrivé illisible (enveloppe, décodage).
    SnapshotIllisible { detail: String },
    /// La transmission de Ctrl+C a échoué (502 au fil).
    Transmission { cible: PaneId, detail: String },
}

impl ArreteurAgent {
    #[must_use]
    pub fn nouveau() -> Self {
        Self
    }

    /// Demande l'arrêt de l'agent d'un pane — la décision se fait sur une
    /// observation **fraîche**, jamais sur une photo mise en cache.
    pub fn arrete(
        &self,
        port: &dyn ControlPort,
        cible: &PaneId,
    ) -> Result<IssueArret, ErreurArret> {
        // ⚠️ Admis par la file du pane (T034) : la photo ET le Ctrl+C dans le
        // tour exclusif — jamais au milieu d'un prompt ou d'une réponse.
        match super::admission::partage().admet(cible, || self.arrete_admis(port, cible)) {
            Ok(issue) => Ok(issue),
            Err(Err(erreur)) => Err(erreur),
            Err(Ok(super::admission::ErreurAdmission::Saturation)) => {
                Err(ErreurArret::Transmission {
                    cible: cible.clone(),
                    detail: super::admission::detail_saturation(cible),
                })
            }
        }
    }

    /// L'arrêt lui-même, dans le tour exclusif du pane.
    fn arrete_admis(
        &self,
        port: &dyn ControlPort,
        cible: &PaneId,
    ) -> Result<IssueArret, ErreurArret> {
        // 1) L'observation fraîche — la seule source de décision.
        let mut photo = port.snapshot();
        let photo = match pousse(&mut photo) {
            Ok(photo) => photo,
            // Une enveloppe illisible n'est pas « l'amont indisponible » :
            // les deux causes restent distinctes (le fil les nomme chacune).
            Err(PortError::Transport { detail }) => {
                return Err(ErreurArret::SnapshotIllisible { detail });
            }
            Err(cause) => {
                return Err(ErreurArret::SnapshotIndisponible {
                    detail: cause.description(),
                });
            }
        };
        // 2) L'agent en question — absent = 404, pas un no-op.
        let agent = photo
            .agents
            .iter()
            .find(|agent| agent.pane_id == *cible)
            .ok_or_else(|| ErreurArret::AgentAbsent {
                cible: cible.clone(),
            })?;
        // 3) Seulement `working` : un agent au repos n'a rien à interrompre.
        if agent.status != AgentStatus::Working {
            return Ok(IssueArret::NonEnCours);
        }
        // 4) La transmission — et seulement la transmission.
        let mut arret = port.stop(cible.clone());
        match pousse(&mut arret) {
            Ok(StopEvidence::InterruptSent) => Ok(IssueArret::InterruptEnvoye),
            // La course : l'agent a fini entre la photo et l'envoi — rien
            // à interrompre, dit tel quel (jamais un faux envoi).
            Ok(StopEvidence::NotRunning) => Ok(IssueArret::NonEnCours),
            Err(cause) => Err(ErreurArret::Transmission {
                cible: cible.clone(),
                detail: cause.description(),
            }),
        }
    }
}
