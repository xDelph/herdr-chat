//! Les cas d'usage de commande (T034+) : l'admission, le prompt, l'arrêt,
//! le focus.

use domain::errors::PortError;
use domain::ports::PortFuture;

/// Réexportés pour l'assembleur HTTP : `http-api` n'importe pas
/// `interactions` (graphe), et les deux gestes interactifs — répondre à une
/// question, trancher une confiance — y vivent.
pub use interactions::confiance::{EtatConfiance, ReponseConfiance};
pub use interactions::repondre::{EtatReponse, ReponseQuestion};

pub mod admission;
pub mod focus;
pub mod launch;
pub mod prompt;
pub mod stop;

/// Répond à une question à choix — **admis par la file du pane** (T034) :
/// la lecture, la frappe et la relecture ne s'entrelacent jamais avec un
/// prompt, une confiance, un arrêt ou un focus sur le même pane. Même
/// signature que `interactions::repondre::repondre_question` : les handlers
/// n'ont rien à changer. La saturation est une erreur nommée (502 au fil),
/// rien n'a été envoyé.
pub fn repondre_question(
    port: &interactions::repondre::PortPourQuestion,
    pane: &domain::ids::PaneId,
    numero: i64,
    texte: Option<&str>,
) -> Result<ReponseQuestion, PortError> {
    admis(pane, || {
        interactions::repondre::repondre_question(port, pane, numero, texte)
    })
}

/// Répond à l'invite de confiance — **admis par la file du pane** (T034),
/// même signature que `interactions::confiance::repondre_confiance`.
pub fn repondre_confiance(
    port: &dyn domain::ports::ControlPort,
    pane: &domain::ids::PaneId,
    accepte: bool,
    famille: Option<&str>,
) -> Result<ReponseConfiance, PortError> {
    admis(pane, || {
        interactions::confiance::repondre_confiance(port, pane, accepte, famille)
    })
}

/// Une opération rendue en `PortError`, admise par la file du pane.
fn admis<T>(
    pane: &domain::ids::PaneId,
    effet: impl FnOnce() -> Result<T, PortError>,
) -> Result<T, PortError> {
    match admission::partage().admet(pane, effet) {
        Ok(valeur) => Ok(valeur),
        Err(Err(erreur)) => Err(erreur),
        Err(Ok(admission::ErreurAdmission::Saturation)) => Err(PortError::Transport {
            detail: admission::detail_saturation(pane),
        }),
    }
}

/// L'attente d'un port bloquant-déguisé : le premier poll répond (tous les
/// faux et le transport réel T012 respectent ce contrat — `Pending` est un
/// branchement cassé, signalé comme tel, jamais une attente silencieuse).
pub(crate) fn pousse<T: Send>(fut: &mut PortFuture<'_, T>) -> Result<T, PortError> {
    use core::task::{Context, Poll, Waker};
    let mut contexte = Context::from_waker(Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        Poll::Ready(reponse) => reponse,
        Poll::Pending => {
            panic!("un port répond au premier poll ; Pending est un branchement cassé")
        }
    }
}
