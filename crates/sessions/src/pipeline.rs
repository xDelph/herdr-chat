//! Le pipeline commun (T017) : stockage → enveloppe → codec → politique →
//! normalisation, une chaîne **sans branche sur un agent concret**.
//!
//! ⚠️ **Le socle ne sait pas qui sont pi, codex, claude, opencode, devin.**
//! Un profil est une **donnée** (genre, capacités, codec) posée dans le
//! registre — le socle ne fait jamais `match genre { "pi" => … }` : une
//! modification du profil Devin ne peut donc pas toucher Codex (l'indépendance
//! est structurelle, testée).
//!
//! ⚠️ **Un genre inconnu ne bascule pas sur un autre profil** — jamais de
//! repli implicite vers le profil d'un autre agent (règle du dépôt) : l'appelant
//! garde la ligne brute (le monde des inconnus, `RetainedUnknown`).

use domain::session::{ChangePi, LignePi};
use serde_json::Value;
use std::collections::BTreeMap;

/// Les capacités d'un profil — **indépendantes** les unes des autres : une
/// famille peut lire ses sessions sans savoir lancer un agent, et inversement.
/// Chaque profil pose les siennes **mesurées**, jamais déduites d'un voisin.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Capacites {
    /// Les sessions de la famille sont lisibles.
    pub lisible: bool,
    /// Le catalogage des modèles est disponible.
    pub catalogue: bool,
    /// Le lancement d'agent est disponible.
    pub lancement: bool,
    /// Les interactions (question/confiance) sont disponibles.
    pub interactions: bool,
}

/// Le codec d'une famille : une ligne du stockage → ligne pi (message) et/
/// ou changement de réglage — `None` = pas de la conversation (l'appelant
/// garde la ligne brute).
#[derive(Clone, Copy)]
pub struct Codec {
    pub ligne_vers_pi: fn(&Value) -> Option<LignePi>,
    /// Les familles qui écrivent des événements de réglage (codex mesuré) ;
    /// les autres laissent `None`.
    pub reglage_vers_pi: Option<fn(&Value) -> Option<ChangePi>>,
}

/// Un profil : genre + capacités mesurées + codec. La politique fine
/// (filtres de visibilité) appartient aux tâches des profils (T018+) — elle
/// se branche **ici**, entre le codec et la normalisation.
#[derive(Clone, Copy)]
pub struct Profil {
    pub genre: &'static str,
    pub capacites: Capacites,
    pub codec: Codec,
}

/// Le résultat normalisé d'une ligne passée par le pipeline — le message
/// vit en boîte (l'écart de taille entre variantes, déjà connu du domaine).
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum LigneNormalisee {
    Message(Box<LignePi>),
    Reglage(ChangePi),
}

impl LigneNormalisee {
    /// La ligne pi, quand il y en a une — les lecteurs d'aperçu parlent à
    /// cette valeur.
    #[must_use]
    pub fn message(&self) -> Option<&LignePi> {
        match self {
            LigneNormalisee::Message(ligne) => Some(ligne),
            LigneNormalisee::Reglage(_) => None,
        }
    }
}

/// Le registre des profils — un genre = un profil ; reposer un profil ne
/// touche que son genre (l'indépendance est la structure même du map).
#[derive(Default)]
pub struct Registre {
    profils: BTreeMap<&'static str, Profil>,
}

impl Registre {
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Pose (ou remplace) le profil de SON genre — les autres profils ne
    /// bougent pas.
    pub fn pose(&mut self, profil: Profil) {
        self.profils.insert(profil.genre, profil);
    }

    /// Le profil d'un genre — **`None` pour un inconnu** : jamais le profil
    /// d'un autre agent par défaut.
    #[must_use]
    pub fn profil(&self, genre: &str) -> Option<&Profil> {
        self.profils.get(genre)
    }

    /// Fait passer une ligne par le pipeline pour le genre donné — `None`
    /// pour un genre inconnu ou une ligne hors conversation (à l'appelant
    /// de garder la brute).
    pub fn traite(&self, genre: &str, ligne: &Value) -> Option<LigneNormalisee> {
        let profil = self.profil(genre)?;
        if let Some(reglage) = profil.codec.reglage_vers_pi
            && let Some(changement) = reglage(ligne)
        {
            return Some(LigneNormalisee::Reglage(changement));
        }
        (profil.codec.ligne_vers_pi)(ligne)
            .map(Box::new)
            .map(LigneNormalisee::Message)
    }
}
