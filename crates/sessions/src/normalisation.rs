//! Le **point d'entrée unique** des lignes de fichier : chaque ligne lue
//! dans un JSONL passe ici, une fois, avant d'être servie — résumé de liste,
//! page de chat et flux en direct lisent la même forme.
//!
//! ⚠️ **Pourquoi ce module existe.** Les codecs Codex et Claude existaient
//! mais n'étaient appelés que par les tests : la page de session rendait la
//! ligne brute (`response_item`, `event_msg`, `user`…), que la PWA ne sait pas
//! lire. Le fil TS traduisait chaque ligne à un seul endroit
//! (`SessionReader.parseEntry`) ; c'est cet endroit, en Rust.
//!
//! ⚠️ **Le socle ne connaît aucun agent.** Chaque profil déclare comment ses
//! lignes se traduisent ([`Traduction`]) ; la composition
//! ([`Normaliseur::standard`]) les pose. Une famille inconnue garde sa ligne
//! brute — jamais le profil d'un autre agent.

use crate::agents::{ProfilClaude, ProfilCodex, ProfilPi};
use crate::pipeline::{LigneNormalisee, Profil, Registre};
use domain::session::SessionEntry;
use serde_json::Value;
use std::collections::BTreeMap;

/// Comment les lignes d'un profil deviennent la forme commune.
#[derive(Clone, Copy)]
pub enum Traduction {
    /// Les lignes sont **déjà** dans la forme commune (Pi) : elles passent
    /// telles quelles — une re-sérialisation perdrait les champs que le
    /// codec ne nomme pas (`usage`, `stopReason`…).
    Native,
    /// Les lignes passent par le codec du profil. Une ligne que le codec
    /// refuse passe par `refus` quand le profil en déclare un (Claude : une
    /// ligne de conversation refusée perd son message), sinon reste brute.
    ParCodec { refus: Option<fn(&Value) -> Value> },
}

/// Le normaliseur — un registre de profils et la traduction de chacun.
pub struct Normaliseur {
    registre: Registre,
    traductions: BTreeMap<&'static str, Traduction>,
}

impl Normaliseur {
    /// Un normaliseur vide : toute ligne reste brute.
    #[must_use]
    pub fn vide() -> Self {
        Self {
            registre: Registre::nouveau(),
            traductions: BTreeMap::new(),
        }
    }

    /// Les trois familles qui écrivent des **fichiers** : Pi (natif), Codex
    /// et Claude (traduits). opencode et Devin traduisent déjà à la lecture
    /// de leur base.
    #[must_use]
    pub fn standard() -> Self {
        let mut normaliseur = Self::vide();
        normaliseur.pose(ProfilPi::profil(), Traduction::Native);
        normaliseur.pose(ProfilCodex::profil(), Traduction::ParCodec { refus: None });
        normaliseur.pose(
            ProfilClaude::profil(),
            Traduction::ParCodec {
                refus: Some(crate::agents::claude::ligne_traitee),
            },
        );
        normaliseur
    }

    /// Pose (ou remplace) un profil et sa traduction — les autres ne bougent
    /// pas.
    pub fn pose(&mut self, profil: Profil, traduction: Traduction) {
        self.traductions.insert(profil.genre, traduction);
        self.registre.pose(profil);
    }

    /// Une ligne brute de fichier → l'entrée servie.
    #[must_use]
    pub fn entree(&self, famille: Option<&str>, brut: &str) -> SessionEntry {
        let Some(famille) = famille else {
            return entree_brute(brut);
        };
        let Some(Traduction::ParCodec { refus }) = self.traductions.get(famille).copied() else {
            return entree_brute(brut);
        };
        let Ok(valeur) = serde_json::from_str::<Value>(brut) else {
            return entree_brute(brut);
        };
        match self.registre.traite(famille, &valeur) {
            Some(LigneNormalisee::Message(ligne)) => entree_serialisee(&*ligne, brut),
            Some(LigneNormalisee::Reglage(changement)) => entree_serialisee(&changement, brut),
            None => match refus {
                Some(refus) => {
                    let traitee = refus(&valeur);
                    if traitee == valeur {
                        entree_de_valeur(&valeur, brut.to_string())
                    } else {
                        entree_de_valeur(&traitee, traitee.to_string())
                    }
                }
                None => entree_de_valeur(&valeur, brut.to_string()),
            },
        }
    }
}

/// Les champs **optionnels** de la forme commune (`LignePi`, `PiMessage`,
/// `ChangePi`) : absents de la traduction, ils sont retirés du `raw` plutôt
/// qu'écrits `null`.
const CHAMPS_OPTIONNELS: [&str; 15] = [
    "id",
    "timestamp",
    "role",
    "toolName",
    "phase",
    "command",
    "output",
    "exitCode",
    "cancelled",
    "truncated",
    "isError",
    "model",
    "provider",
    "thinkingLevel",
    "modelId",
];

/// La forme commune **sans ses champs optionnels nuls**.
///
/// ⚠️ Un message traduit (codex, claude, opencode, devin) portait 8 à 11 clés
/// `null` (`output`, `exitCode`, `isError`, `toolName`…) : du poids sur le
/// fil pour rien dire, et le décodage strict de la PWA échouait sur ces
/// `null`. Seuls les champs optionnels nommés sont retirés, et seulement
/// quand ils valent `null` — le contenu (`content`) n'est jamais touché.
#[must_use]
pub fn sans_champs_nuls(mut valeur: Value) -> Value {
    fn retire(objet: &mut serde_json::Map<String, Value>) {
        objet.retain(|cle, champ| !(champ.is_null() && CHAMPS_OPTIONNELS.contains(&cle.as_str())));
    }
    if let Some(objet) = valeur.as_object_mut() {
        retire(objet);
        if let Some(message) = objet.get_mut("message").and_then(Value::as_object_mut) {
            retire(message);
        }
    }
    valeur
}

/// Le `raw` d'une forme traduite : sa sérialisation, sans champs nuls.
pub fn brut_traduit<T: serde::Serialize>(forme: &T) -> serde_json::Result<String> {
    serde_json::to_value(forme).map(|valeur| sans_champs_nuls(valeur).to_string())
}

/// L'entrée d'une forme traduite : le `raw` est la forme commune, pas la
/// ligne d'origine — c'est elle que la PWA et le résumé lisent.
fn entree_serialisee<T: serde::Serialize>(forme: &T, brut: &str) -> SessionEntry {
    match serde_json::to_value(forme).map(sans_champs_nuls) {
        Ok(valeur) => {
            let texte = valeur.to_string();
            entree_de_valeur(&valeur, texte)
        }
        // Une forme qui ne se sérialise pas ne remplace rien : la ligne
        // d'origine reste servie, rien n'est inventé.
        Err(_) => entree_brute(brut),
    }
}

/// Une entrée de session : le brut **tel quel**, et les trois champs de
/// position quand la ligne les porte. Une ligne illisible reste servie, de
/// type `unknown` (le vocabulaire du fil).
#[must_use]
pub fn entree_brute(brut: &str) -> SessionEntry {
    match serde_json::from_str::<Value>(brut) {
        Ok(valeur) => entree_de_valeur(&valeur, brut.to_string()),
        Err(_) => SessionEntry {
            kind: String::from("unknown"),
            id: None,
            parent_id: None,
            raw: brut.to_string(),
            timestamp: None,
        },
    }
}

fn entree_de_valeur(valeur: &Value, raw: String) -> SessionEntry {
    let texte = |clef: &str| valeur.get(clef).and_then(Value::as_str).map(str::to_string);
    SessionEntry {
        kind: texte("type").unwrap_or_else(|| String::from("unknown")),
        id: texte("id"),
        parent_id: texte("parentId"),
        raw,
        timestamp: texte("timestamp"),
    }
}
