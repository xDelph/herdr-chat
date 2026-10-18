//! xtask — contract export/check (T009+), layout/graph gates and CI plumbing
//! for the Rust migration (T003). Library surface keeps the pure parts
//! testable from `tests/unit_tests.rs` without re-including any `src/`.

pub mod allowlist;
pub mod contracts;
pub mod graph;
pub mod layout;
pub mod run;
