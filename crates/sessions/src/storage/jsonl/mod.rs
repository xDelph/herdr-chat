//! Le lecteur JSONL (T014) — framing par octets, identité, pages avant et
//! arrière, en-tête et queue (TECH §2).
pub mod framing;
pub mod history;
pub mod identity;
pub mod reader;
