//! Le service prompt (T035/C05–C06) : relecture d'état, empreinte
//! SHA-256, **le dernier texte confirmé par pane sur 60 s monotones**.
//!
//! ⚠️ **D007.2 — la suppression des doubles envois** : deux envois
//! **consécutifs** du même texte vers la même cible → le second supprimé —
//! mais seulement si le premier a été **confirmé**. Un envoi planté, expiré
//! ou non validé ne bloque rien. ⚠️ Le fil actuel cherchait le doublon dans
//! TOUTE la fenêtre — le A→B→A était bloqué à tort ; ici la règle est celle
//! de l'utilisateur : **le dernier** envoi confirmé de la cible (A→B→A passe).
//!
//! ⚠️ L'API Herdr n'offre aucune idempotence — la garantie est entièrement
//! locale, sur une horloge **monotone** (`Instant`, jamais la date du jour).
//!
//! ⚠️ **Deux primitives, deux significations** : `agent.prompt` soumet un
//! prompt (Herdr répond l'acceptation = `confirmed`) ; `pane.send_text` +
//! `enter` écrit des frappes (le texte est écrit, PAS prouvé appliqué =
//! `unknown`). Renvoyer « confirmed » dans les deux cas afficherait comme
//! envoyé un texte que personne n'a lu.
//!
//! ⚠️ **On ne prédit pas le mode, on réagit au refus connu** : le statut de
//! l'agent ment (mesuré : codex « Hooks need review » annoncé `idle`) — c'est
//! le texte du refus qui nomme la saisie interactive.

use domain::errors::PortError;
use domain::ids::{DeliveryFingerprint, PaneId};
use domain::ports::{
    ControlPort, PortFuture, PromptEvidence, TargetedKeys, TargetedPrompt, TargetedText,
};
use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// La fenêtre de déduplication — 60 s monotones (mesuré :
/// `DUPLICATE_WINDOW_MS`).
pub const FENETRE: Duration = Duration::from_secs(60);

/// L'empreinte d'un envoi : SHA-256 de `cible\0texte`, 32 caractères hex —
/// **l'empreinte actuelle** (le contenu, pas une corrélation).
#[must_use]
pub fn empreinte_de(cible: &str, texte: &str) -> String {
    use sha2::Digest;
    let mut hacheur = sha2::Sha256::new();
    hacheur.update(cible.as_bytes());
    hacheur.update([0]);
    hacheur.update(texte.as_bytes());
    let resume = hacheur.finalize();
    resume
        .iter()
        .take(16)
        .map(|octet| format!("{octet:02x}"))
        .collect()
}

/// Le refus d'un envoi — chaque cause nommée ; rien n'a été enregistré.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RefusEnvoi {
    /// L'envoi IDENTIQUE a déjà été confirmé dans la fenêtre — supprimé.
    Doublon { empreinte: String, cible: String },
    /// L'envoi n'a pas été confirmé (transport, délai, preuve étrangère) —
    /// le prochain envoi passe.
    NonConfirme { cible: String, detail: String },
}

impl std::fmt::Display for RefusEnvoi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RefusEnvoi::Doublon { empreinte, cible } => {
                write!(
                    f,
                    "doublon confirmé dans la fenêtre ({cible}) : {empreinte}"
                )
            }
            RefusEnvoi::NonConfirme { cible, detail } => {
                write!(f, "envoi non confirmé ({cible}) : {detail}")
            }
        }
    }
}

impl std::error::Error for RefusEnvoi {}

/// La confirmation exposée — deux valeurs, jamais « envoyé » sans preuve.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Confirmation {
    /// Herdr a soumis le prompt (`agent_prompted`) : la preuve du serveur.
    Confirme,
    /// Les frappes ont été ÉCRITES — l'application n'est pas prouvée.
    Inconnu,
}

/// L'issue d'un envoi réussi.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Envoi {
    pub empreinte: String,
    pub confirmation: Confirmation,
}

/// Le dernier envoi confirmé d'une cible — LA mémoire de déduplication.
#[derive(Clone, PartialEq, Eq, Debug)]
struct Dernier {
    empreinte: String,
    confirme_a: Instant,
}

#[derive(Default)]
pub struct EnvoieurPrompt {
    /// Le dernier envoi confirmé PAR CIBLE (la règle : consécutif).
    derniers: Mutex<HashMap<String, Dernier>>,
}

/// Herdr a-t-il refusé parce que l'agent attend une **saisie interactive** ?
/// ⚠️ **Sur le texte, faute de code typé** — le message est ce qu'on a de plus
/// précis ; un refus d'une autre nature garde son comportement d'origine.
fn refus_de_saisie(erreur: &PortError) -> bool {
    let texte = erreur.to_string().to_lowercase();
    texte.contains("blocked and requires interactive input")
}

impl EnvoieurPrompt {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Le nombre d'entrées suivies — la vérification de purge en tests.
    #[must_use]
    pub fn suivi(&self) -> usize {
        self.derniers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// Envoie un texte vers un agent — prompt ou frappes, avec le repli
    /// interactif **sur refus connu seulement**.
    pub fn envoie(
        &self,
        port: &dyn ControlPort,
        cible: &PaneId,
        texte: &str,
        saisie: bool,
    ) -> Result<Envoi, RefusEnvoi> {
        let empreinte = empreinte_de(cible.as_str(), texte);
        // 1) Le dernier confirmé de CETTE cible : le même texte dans la
        //    fenêtre = doublon supprimé (après preuve).
        {
            let derniers = self.derniers.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(dernier) = derniers.get(cible.as_str())
                && dernier.empreinte == empreinte
                && dernier.confirme_a.elapsed() < FENETRE
            {
                return Err(RefusEnvoi::Doublon {
                    empreinte,
                    cible: cible.as_str().to_string(),
                });
            }
        }
        // 2) L'exécution — prompt ou frappes, puis le repli sur refus connu.
        let mut par_frappes = saisie;
        let mut issue = if saisie {
            les_frappes(port, cible, texte)
        } else {
            let demande = TargetedPrompt {
                pane: cible.clone(),
                literal_text: texte.to_string(),
                fingerprint: DeliveryFingerprint::from(empreinte.clone()),
            };
            le_prompt(port, demande)
        };
        if !saisie
            && let Err(erreur) = &issue
            && refus_de_saisie(erreur)
        {
            // ⚠️ Le refus NAMÉ la saisie interactive : les frappes sont le
            // seul chemin vers une invite.
            par_frappes = true;
            issue = les_frappes(port, cible, texte);
        }
        // 3) La preuve — le discriminateur de succès est EXIGÉ (C05/C06).
        let confirmation = match issue {
            // Les frappes écrites : « inconnu » — pas que l'agent a appliqué.
            Ok(()) if par_frappes => Confirmation::Inconnu,
            // L'empreinte confirmée = CELLE DEMANDÉE (une confirmation
            // étrangère n'est jamais un succès — rapportée en inconnu,
            // rien n'est enregistré).
            Ok(()) => Confirmation::Confirme,
            // Échec : rien n'est enregistré — le prochain envoi passe.
            Err(cause) => {
                return Err(RefusEnvoi::NonConfirme {
                    cible: cible.as_str().to_string(),
                    detail: format!("send not confirmed: {cause}"),
                });
            }
        };
        // 4) L'enregistrement — après la preuve seulement.
        if let Ok(mut derniers) = self.derniers.lock() {
            derniers.insert(
                cible.as_str().to_string(),
                Dernier {
                    empreinte: empreinte.clone(),
                    confirme_a: Instant::now(),
                },
            );
        }
        Ok(Envoi {
            empreinte,
            confirmation,
        })
    }
}

fn le_prompt(port: &dyn ControlPort, demande: TargetedPrompt) -> Result<(), PortError> {
    let empreinte = demande.fingerprint.clone();
    match prompt_attendu(port, demande)? {
        // C05 : la confirmation portant une AUTRE empreinte n'est pas une
        // confirmation — rapportée en inconnu.
        PromptEvidence::Confirmed { fingerprint } if fingerprint == empreinte => Ok(()),
        PromptEvidence::Confirmed { fingerprint } => Err(PortError::Upstream {
            code: String::from("preuve étrangère"),
            message: format!(
                "l'empreinte confirmée ({}) n'est pas celle demandée ({})",
                fingerprint.as_str(),
                empreinte.as_str()
            ),
        }),
        PromptEvidence::Unknown { detail, .. } => Err(PortError::Transport { detail }),
        PromptEvidence::Suppressed { reason } => Err(PortError::Transport { detail: reason }),
        PromptEvidence::Failed { detail } => Err(PortError::Transport { detail }),
    }
}

fn prompt_attendu(
    port: &dyn ControlPort,
    demande: TargetedPrompt,
) -> Result<PromptEvidence, PortError> {
    let mut fut = port.prompt(demande);
    attends(&mut fut)
}

fn les_frappes(port: &dyn ControlPort, cible: &PaneId, texte: &str) -> Result<(), PortError> {
    {
        let mut fut = port.send_text(TargetedText {
            pane: cible.clone(),
            text: texte.to_string(),
        });
        attends(&mut fut)?;
    }
    let mut fut = port.send_keys(TargetedKeys {
        pane: cible.clone(),
        keys: vec![String::from("enter")],
    });
    attends(&mut fut)?;
    Ok(())
}

/// L'attente d'un port bloquant-déguisé — le premier poll répond.
fn attends<T: Send>(fut: &mut PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(reponse) => reponse,
        std::task::Poll::Pending => {
            panic!("un port bloquant répond au premier poll ; Pending est un branchement cassé")
        }
    }
}
