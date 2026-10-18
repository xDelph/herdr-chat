//! Cahier d'essais de `test-support`, pièce par pièce.
//!
//! `pousse` est le moteur d'essai minimal : chaque faux répond au premier
//! poll (waker no-op, `std` seul). « Pending » est traité comme un échec de
//! test — un faux qui s'atténuerait en attente mentirait sur sa nature.

pub(crate) mod fake_clock;
pub(crate) mod fake_herdr;
pub(crate) mod fixtures;
pub(crate) mod push_sink;
pub(crate) mod temp_stores;

use core::task::{Context, Poll, Waker};
use domain::errors::PortError;
use domain::ports::PortFuture;

pub(crate) fn pousse<T: Send>(fut: &mut PortFuture<'_, T>) -> Result<T, PortError> {
    let mut contexte = Context::from_waker(Waker::noop());
    match fut.as_mut().poll(&mut contexte) {
        Poll::Ready(reponse) => reponse,
        Poll::Pending => panic!("un faux répond au premier poll ; Pending est un échec de test"),
    }
}
