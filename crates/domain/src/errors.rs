//! Causes nommées et taxonomie d'erreurs de port.
//!
//! ⚠️ **La cause est nommée, jamais un 502 indifférencié** (B03) : confondre
//! « permission refusée » et « panne réseau » fait croire à une panne et fait
//! relancer inutilement. Quatre causes de lecture se ressemblent de loin et
//! produisent des réponses radicalement différentes.

use serde::{Deserialize, Serialize};

/// Cause d'une réponse de session : `absente | vide | invalide | io`.
///
/// ⚠️ Ces quatre cas se confondent de loin, et les confondre produit soit une
/// erreur rouge en boucle, soit — pire — une vue qui ment :
///
/// | Cause       | Sens                                     | Réponse          |
/// |-------------|------------------------------------------|------------------|
/// | [`Absente`] | le fichier n'existe pas encore            | 200, vide        |
/// | [`Vide`]    | le fichier existe, zéro entrée            | 200, vide        |
/// | [`Invalide`]| contenu illisible ou ligne tronquée       | 422              |
/// | [`Io`]      | permission, disque, erreur du système     | 502              |
///
/// `absente` n'est **pas** une panne : Herdr annonce un `agent_session` valide
/// vers un fichier que Pi n'a pas encore créé (le JSONL naît au premier
/// message — mesuré sur un vrai agent devin). Les codes d'orthographe viennent
/// du fil actuel ; ne jamais requalifier un autre code.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize)]
pub enum ReadCause {
    /// Le fichier n'existe pas encore.
    #[serde(rename = "absente")]
    Absente,
    /// Le fichier existe, zéro entrée.
    #[serde(rename = "vide")]
    Vide,
    /// Contenu illisible ou ligne tronquée.
    #[serde(rename = "invalide")]
    Invalide,
    /// Permission, disque, erreur du système.
    #[serde(rename = "io")]
    Io,
}

/// Ce qu'une cause dit, avec son message et son caractère bénin.
///
/// - `benign = true` **seulement** pour `absente` et `vide` : rien ne va mal.
/// - Le message est destiné à l'utilisateur et **distinct pour chaque cause**.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct ReadVerdict {
    pub cause: ReadCause,
    pub message: String,
    pub benign: bool,
}

fn verdict_fini(cause: ReadCause, message: &'static str, benign: bool) -> ReadVerdict {
    ReadVerdict {
        cause,
        message: message.into(),
        benign,
    }
}

fn verdict_cause(cause: ReadCause) -> ReadVerdict {
    match cause {
        ReadCause::Absente => verdict_fini(ReadCause::Absente, "session absente", true),
        ReadCause::Vide => verdict_fini(ReadCause::Vide, "session vide", true),
        ReadCause::Invalide => verdict_fini(ReadCause::Invalide, "session illisible", false),
        ReadCause::Io => verdict_fini(ReadCause::Io, "session inaccessible", false),
    }
}

/// Le verdict exact d'une cause — les messages sont les textes du fil actuel.
#[must_use]
pub fn verdict_of(cause: ReadCause) -> ReadVerdict {
    verdict_cause(cause)
}

/// Une session **existante** mais dont on ne peut pas interpréter le contenu.
///
/// Distinguée de `io` : une ligne tronquée ou un JSON altéré n'est pas une
/// panne du serveur ; le message porte le détail à la place du diagnostic
/// générique — sinon l'utilisateur croit à une panne réseau et relance pour rien.
#[must_use]
pub fn invalid_session(detail: &str) -> ReadVerdict {
    ReadVerdict {
        cause: ReadCause::Invalide,
        benign: false,
        message: format!("session illisible ({detail})"),
    }
}

/// Classe une erreur d'entrée-sortie posée par la lecture du fichier.
///
/// ⚠️ La distinction se fait sur la **nature** d'erreur, jamais sur le texte
/// du message — il varie selon la plateforme. `absente` correspond à CE
/// FICHIER inexistant (`NotFound`) ; les autres natures restent `io`.
#[must_use]
pub fn verdict_of_io(error: &std::io::Error) -> ReadVerdict {
    use std::io::ErrorKind;
    let cause = match error.kind() {
        ErrorKind::NotFound => ReadCause::Absente,
        // Permission refusée ou boucle de liens : le fichier existe, on ne
        // peut pas le lire — pas une session absente.
        _ => ReadCause::Io,
    };
    verdict_cause(cause)
}

/// Échec d'un appel de port — le monde a refusé, genré par sa nature.
///
/// ⚠️ **Le genre amont est préservé** (code + message Herdr distincts), et
/// une décision de politique (chemin refusé) n'est **pas** une panne : elle
/// vit dans sa variante propre, jamais morphée en erreur réseau.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum PortError {
    /// Herdr (ou le magasin amont) a répondu une erreur structurée :
    /// `code` et `message` sont tous deux requis.
    Upstream { code: String, message: String },
    /// La conversation avec le transport a échoué avant toute réponse.
    Transport { detail: String },
    /// Le délai attendu (méthode ou socket) a été dépassé — distinct d'une
    /// réponse négative : rien ne dit ce que l'amont a fait.
    Timeout,
    /// Une capacité demandée n'a pas été mesurée sur cette instance.
    /// L'affichage la présente comme absente, jamais comme en panne.
    Unsupported { feature: String },
    /// La politique de chemin (S03) a refusé : une **décision**, pas une
    /// panne ; le détail porte le motif exact (`hors-racine`,
    /// `lien-sortant`…). La requalification en cause bénigne se fait à
    /// l'appel, où la raison est connue.
    PathRejected { detail: String },
}

impl PortError {
    /// Le message destiné à la trace humaine, sans déduire une cause.
    #[must_use]
    pub fn description(&self) -> String {
        match self {
            PortError::Upstream { code, message } => format!("upstream {code}: {message}"),
            PortError::Transport { detail } => format!("transport: {detail}"),
            PortError::Timeout => "deadline exceeded".into(),
            PortError::Unsupported { feature } => format!("unsupported: {feature}"),
            PortError::PathRejected { detail } => format!("path rejected: {detail}"),
        }
    }
}

impl std::fmt::Display for PortError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.description())
    }
}

impl std::error::Error for PortError {}
