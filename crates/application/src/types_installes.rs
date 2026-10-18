//! Les types d'agents **réellement lançables** (H07) — la découverte est
//! INJECTÉE (le vrai `integration.list` + son filtre sont composés au
//! sommet, T031/T056) : ce module porte la **politique**, une seule fois.
//!
//! ⚠️ **Installé ne veut pas dire lisible** (U14). `state != not_installed`
//! dit que le greffon de suivi est en place ; rien ne garantit qu'Herdr
//! expose un chemin de session. Pour opencode il n'en expose aucun — son
//! contenu est dans une base — et un agent lancé serait hors du produit :
//! présent, mais muet. On filtre donc sur la capacité **vérifiée**.
//!
//! ⚠️ **Le menu et le lancement portent sur la MÊME liste** (C16, B07) :
//! sinon le menu propose ce que le lancement refuse — ou l'inverse, ce qui
//! est pire.

use crate::visibilite::type_lisible;
use domain::ids::AgentKind;

/// Le vocabulaire des types d'agent connus — relevé dans le fil. Sert
/// uniquement à décider **quelle colonne** d'une intégration est le `kind`
/// attendu par `agent.start` : Herdr prend la commande pour la plupart, la
/// cible pour quelques-uns (Cursor : commande `cursor-agent`, kind
/// `cursor`).
const TYPES_CONNUS: [&str; 25] = [
    "pi",
    "claude",
    "codex",
    "gemini",
    "cursor",
    "devin",
    "agy",
    "cline",
    "omp",
    "mastracode",
    "opencode",
    "copilot",
    "kimi",
    "kiro",
    "droid",
    "amp",
    "grok",
    "hermes",
    "kilo",
    "qodercli",
    "qwen",
    "letta",
    "maki",
    "muse",
    "aide",
];

/// Une intégration telle que la découverte la rend : la commande du
/// greffon, sa cible, et ce que Herdr dit de son état.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TypeInstalle {
    pub commande: String,
    pub cible: String,
    /// `state` brut de `integration.list` — `not_installed` exclut.
    pub installe: bool,
}

impl TypeInstalle {
    /// Le `kind` que `agent.start` attend : la **commande** quand elle fait
    /// partie du vocabulaire connu, sinon la cible.
    #[must_use]
    pub fn kind(&self) -> &str {
        if TYPES_CONNUS.contains(&self.commande.as_str()) {
            &self.commande
        } else {
            &self.cible
        }
    }
}

/// Un type qui a le droit d'être proposé ET lancé.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TypeLancable {
    pub kind: String,
    pub commande: String,
}

/// La découverte échouée — nommée, jamais une liste devinée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurInventaire {
    /// `integration.list` a échoué côté Herdr.
    Indisponible { detail: String },
    /// La liste est arrivée dans une forme inattendue.
    Illisible { detail: String },
}

impl ErreurInventaire {
    /// La cause exacte, telle qu'elle sera affichée.
    #[must_use]
    pub fn detail(&self) -> &str {
        match self {
            ErreurInventaire::Indisponible { detail } | ErreurInventaire::Illisible { detail } => {
                detail
            }
        }
    }
}

/// La découverte des types installés — **injectée** : le vrai adaptateur
/// vit au sommet (aucun processus lancé ici, aucun service réel).
pub trait InventaireTypes: Send + Sync {
    /// Toutes les intégrations connues de Herdr, avec leur état.
    fn installes(&self) -> Result<Vec<TypeInstalle>, ErreurInventaire>;
}

/// La liste lançable : installée ET à session lisible. Une seule fonction
/// pour le menu et pour le lancement.
#[must_use]
pub fn types_lancables(inventaire: &[TypeInstalle]) -> Vec<TypeLancable> {
    inventaire
        .iter()
        .filter(|integre| integre.installe)
        .filter(|integre| type_lisible(Some(&AgentKind::from(integre.kind().to_string()))))
        .map(|integre| TypeLancable {
            kind: integre.kind().to_string(),
            commande: integre.commande.clone(),
        })
        .collect()
}

/// Le refus d'un type demandé — `400` avec l'indice des types offerts, ou
/// `503` quand la découverte elle-même a échoué.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum RefusType {
    /// La découverte a échoué : mieux vaut « je ne sais pas » qu'un onglet
    /// créé pour un agent qui n'existe pas.
    Decouverte { detail: String },
    /// Le type n'est pas installé (ou pas lisible) : refusé AVANT tout onglet.
    Inconnu { kind: String, offerts: String },
}

/// Vérifie qu'un type demandé est lançable — la porte du lancement, la même
/// liste que le menu.
pub fn verifie_type(
    inventaire: &dyn InventaireTypes,
    kind: &str,
) -> Result<TypeLancable, RefusType> {
    let installes = inventaire
        .installes()
        .map_err(|erreur| RefusType::Decouverte {
            detail: erreur.detail().to_string(),
        })?;
    let lancables = types_lancables(&installes);
    lancables
        .iter()
        .find(|type_lancable| type_lancable.kind == kind)
        .cloned()
        .ok_or_else(|| RefusType::Inconnu {
            kind: kind.to_string(),
            offerts: lancables
                .iter()
                .map(|type_lancable| type_lancable.commande.clone())
                .collect::<Vec<String>>()
                .join(", "),
        })
}
