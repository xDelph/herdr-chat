//! `contracts` — les DTO publics du fil HTTP, leur représentation exacte,
//! les limites partagées et les unions fermées réexportées du domaine (C01).
//!
//! ⚠️ **Autorité de contrat unique.** Jusqu'à T057, `packages/shared/src/api.ts`
//! reste l'autorité du fil actif : ces DTO sont développés **contre** son
//! corpus gelé (`compatibility/contracts/corpus.json`) — accepté/refusé
//! identiquement. Aucun champ inventé, aucun champ perdu.
//!
//! ⚠️ Présence exacte : [`presence::Nullable`] (présent, peut être null),
//! [`presence::Field`] (absent ou valeur, null refusé), et leur composition —
//! les quatre cas du schéma TS, jamais aplatis.
//!
//! Modules (TECH §2) : `http/` (un fichier par famille de routes),
//! `events.rs` (SSE), `presence.rs` (Field/Nullable), `limits.rs`.
//! `registry.rs` arrive avec T008, `schema.rs` avec T009.

pub mod events;
pub mod http;
pub mod limits;
pub mod presence;

// Les unions fermées primitives vivent dans `domain` — réexportées ici
// (C01 : une seule définition par union, jamais une copie).
pub use domain::notifications::PushPayload;
pub use domain::observation::{ReadSource, SessionRefKind};
pub use domain::status::{AgentStatus, SessionState};
