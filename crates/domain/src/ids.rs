//! Identifiants **distincts** — des nevertoypes qui ne se mélangent pas.
//!
//! ⚠️ **Pourquoi des types séparés, et pas des `String`.** Les incidents les
//! plus chers de ce produit viennent d'un identifiant pris pour un autre : un
//! pane recyclé traité comme sa source passée (C12/C20), un nom de fil pris
//! pour un titre. Des types distincts rendent ces confusions impossibles à la
//! compilation : un identifiant d'une famille **ne convertit pas** vers une
//! autre famille, même avec la même chaîne dedans.
//!
//! Chaque famille reste opaque : le contenu est le libellé que Herdr expose
//! (`wA:p7`, un UUID…), et rien ne le déduit.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Fabrication d'un nevertype fermé : la chaîne interne est opaque, sa
/// conversion depuis `String` est explicite, et **aucune conversion de
/// famille à famille n'existe**.
macro_rules! identifiant {
    ($(#[$doc_meta:meta])* $name:ident) => {
        $(#[$doc_meta])*
        #[derive(Clone, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);
    };
}

/// La même fabrication, plus l'ordre lexicographique de la chaîne brute.
///
/// Cet ordre sert de départage obtentu (égalités de géométrie dans `naming`),
/// jamais de sens métier. Il est **déterministe** (ordre d'octets) — décision
/// consignée : le fil actuel départage à `localeCompare`, sensible aux
/// préférences de la machine.
macro_rules! identifiant_ordonne {
    ($(#[$doc_meta:meta])* $name:ident) => {
        identifiant! {
            $(#[$doc_meta])*
            $name
        }

        impl PartialOrd for $name {
            fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
                Some(self.cmp(other))
            }
        }

        impl Ord for $name {
            fn cmp(&self, other: &Self) -> core::cmp::Ordering {
                self.0.cmp(&other.0)
            }
        }
    };
}

identifiant_ordonne! {
    /// Identifiant d'un **pane** Herdr (`wA:p7`…). C'est aussi l'identité
    /// d'un agent dans le snapshot : Herdr attache chaque agent à son pane.
    PaneId
}

identifiant_ordonne! {
    /// Identifiant d'un **tab** Herdr. Herdr numérote les tabs (`number`).
    TabId
}

identifiant_ordonne! {
    /// Identifiant d'un **workspace** (projet) Herdr.
    WorkspaceId
}

identifiant_ordonne! {
    /// Identifiant d'une **session** chez une source (`pi`/`codex`/…).
    /// Distinct d'un `PaneId` : un pane peut changer de session sans changer
    /// d'identité, et l'inverse ne dit rien sur la source.
    SessionId
}

identifiant_ordonne! {
    /// Nom d'agent **choisi** (`agent.start` l'exige unique). Absent côté
    /// vue pour un agent lancé à la main — mesuré : ses 13 agents n'en
    /// portaient aucun.
    AgentName
}

identifiant_ordonne! {
    /// Type d'agent tel que Herdr le nomme (`pi`, `codex`, `claude`…).
    /// Chaîne opaque : la lisibilité d'un type est **mesurée**, jamais
    /// supposée.
    AgentKind
}

identifiant_ordonne! {
    /// Identifiant de la demande côté appelant (le `id` de la réplique).
    RequestId
}

identifiant_ordonne! {
    /// Empreinte d'un envoi, calculée sur le contenu pour la déduplication.
    /// Opacité volontaire : la façon de la calculer appartient à
    /// l'application ; le domaine ne compare que l'égalité.
    DeliveryFingerprint
}

identifiant_ordonne! {
    /// Clef stable d'une source de lecture au sens du résolveur (sessions,
    /// T023) : le résumé de (genre, référence, cwd/titre). Opaque pour le
    /// domaine, qui n'exige que l'unicité et l'égalité. **Pas un `PaneId`** :
    /// un pane se recycle, la clef de source pas — tout le sujet de
    /// `session::SourceBinding`.
    SourceKey
}

macro_rules! afficher {
    ($($name:ident),+ $(,)?) => {
        $(
            impl fmt::Display for $name {
                fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                    f.write_str(&self.0)
                }
            }

            impl $name {
                /// La chaîne brute — pour les traces et la composition de chemins.
                #[must_use]
                pub fn as_str(&self) -> &str {
                    &self.0
                }
            }

            impl From<String> for $name {
                fn from(value: String) -> Self {
                    Self(value)
                }
            }
        )+
    };
}

afficher!(
    PaneId,
    TabId,
    WorkspaceId,
    SessionId,
    AgentName,
    AgentKind,
    RequestId,
    DeliveryFingerprint,
    SourceKey
);
