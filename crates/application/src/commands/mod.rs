//! Les cas d'usage de commande (T034+) : l'admission, le prompt, l'arrêt,
//! le focus.

use domain::errors::PortError;
use domain::ports::PortFuture;

pub mod admission;
pub mod focus;
pub mod launch;
pub mod prompt;
pub mod stop;

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
