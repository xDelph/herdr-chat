//! Le service de focus (T036/A05/C24) : l'effet **réel** sur le bureau,
//! l'échec **en valeur** (`focused: false`), la ligne de journal explicite.
//!
//! ⚠️ **A05 — l'échec reste une valeur, jamais une panne** : un focus
//! refusé ou une panne de transport répond `focused: false` — « focus
//! échoué n'empêche pas la lecture » (ouvrir une conversation ne dépend
//! pas du focus). Le service ne remonte **aucune** erreur : il rend
//! l'issue, c'est l'affichage qui la lit.
//!
//! ⚠️ **C24 — l'endpoint est conservé, pas l'usage implicite** : ce
//! service expose l'opération telle que le fil la sert (effet réel,
//! `focused` porté, succès journalisé) ; décider d'appeler ou non focus
//! lors d'une lecture est une décision **frontend** (T062), hors de la
//! parité backend.
//!
//! ⚠️ **Journalisé exprès** (A05) : un POST focus réussi n'a aucune autre
//! trace — la ligne `focus <pane> (ok|échec)` est la seule preuve que
//! l'appel est parti. Elle est produite ici, écrite par le sink de
//! journalisation (T055) côté endpoint (T051).

use super::pousse;
use domain::ids::PaneId;
use domain::ports::{ControlPort, FocusEvidence};

/// Le service de focus — sans état : l'effet part à chaque appel.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FocaliseurAgent;

/// L'issue d'un focus — toujours une valeur, jamais une erreur.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct IssueFocus {
    /// `true` seulement si l'effet a été appliqué.
    pub focalise: bool,
    /// La cause exacte quand non focalisé — la matière du journal et de
    /// l'affichage honnête (jamais un message générique).
    pub cause: Option<String>,
}

impl IssueFocus {
    /// La ligne du journal — le format exact du fil : `focus <pane> (ok)`.
    #[must_use]
    pub fn ligne_journal(&self, cible: &PaneId) -> String {
        let verdict = if self.focalise { "ok" } else { "échec" };
        format!("focus {cible} ({verdict})")
    }
}

impl FocaliseurAgent {
    #[must_use]
    pub fn nouveau() -> Self {
        Self
    }

    /// Applique le focus — la cible est celle de l'appel, jamais la
    /// conversation affichée (T034 : la cible est capturée à l'admission).
    pub fn focalise(&self, port: &dyn ControlPort, cible: &PaneId) -> IssueFocus {
        let mut demande = port.focus(cible.clone());
        match pousse(&mut demande) {
            Ok(FocusEvidence::Focused) => IssueFocus {
                focalise: true,
                cause: None,
            },
            Ok(FocusEvidence::Refused { detail }) => IssueFocus {
                focalise: false,
                cause: Some(detail),
            },
            Err(cause) => IssueFocus {
                focalise: false,
                cause: Some(cause.description()),
            },
        }
    }
}
