//! La famille OpenAI (T016) : primitives partagées puis **deux codecs
//! séparés** — Chat et Responses : l'un ne décode pas l'enveloppe de
//! l'autre (preuve T016).
pub mod arguments;
pub mod chat;
pub mod responses;
pub mod text;
