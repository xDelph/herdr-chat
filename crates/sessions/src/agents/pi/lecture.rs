//! La lecture Pi (T018/D11) : les lignes JSONL de pi, les huit rôles, la
//! filiation — et **jamais d'écriture de la source**.

use crate::pipeline::{Capacites, Codec, Profil};
use domain::session::LignePi;
use serde_json::{Value, json};

/// Les **huit rôles** d'une conversation pi (mesuré : `MessageRole` de
/// session.ts) — union fermée, jamais une chaîne libre.
pub const ROLES: [&str; 8] = [
    "user",
    "assistant",
    "system",
    "toolResult",
    "bashExecution",
    "custom",
    "branchSummary",
    "compactionSummary",
];

/// Les autres types de ligne pi — réglages, usage, compaction, contexte :
/// ils ne sont **pas des messages** ; le profil les rend en brut (les codecs
/// de réglage pi, s'il y a lieu, passeront par l'étape réglage du pipeline).
pub const TYPES_NON_MESSAGE: [&str; 11] = [
    "custom",
    "thinking_level_change",
    "model_change",
    "context_edit",
    "session",
    "custom_message",
    "compaction",
    "usage",
    "branch_summary",
    "label",
    "session_info",
];

/// La filiation d'une session — ⚠️ **D11 : deux liens, jamais confondus** :
/// - `parentSession` (l'en-tête) est le **seul** lien de filiation
///   **inter-sessions** ;
/// - `parentId` (une ligne) est **intra-session** — un branchement de
///   conversation, **jamais** un sous-agent (mesuré deux fois : aucune
///   source d'arborescence de sous-agents n'existe).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Filiation {
    /// Le parent inter-sessions, tel que l'en-tête le déclare.
    pub session_parente: Option<String>,
}

/// Le profil **Pi** — l'agent de référence : lisible, catalogue, lancement,
/// interactions (la surface TS les traite tous pour pi).
#[derive(Clone, Copy, Debug)]
pub struct ProfilPi;

impl ProfilPi {
    #[must_use]
    pub fn genre() -> &'static str {
        "pi"
    }

    #[must_use]
    pub fn capacites() -> Capacites {
        Capacites {
            lisible: true,
            catalogue: true,
            lancement: true,
            interactions: true,
        }
    }

    #[must_use]
    pub fn profil() -> Profil {
        Profil {
            genre: Self::genre(),
            capacites: Self::capacites(),
            codec: Self::codec(),
        }
    }

    #[must_use]
    pub fn codec() -> Codec {
        Codec {
            ligne_vers_pi,
            reglage_vers_pi: None,
        }
    }
}

/// Lit une ligne pi — les **deux formes mesurées du corpus** :
///
/// - **enveloppée** (la forme pi normalisée) : `{type, message:{…}}` —
///   identité vérifiée, la ligne passe telle quelle ;
/// - **à plat** (les fichiers du corpus) : `{type:"message", content, role?…}`
///   — on l'**enveloppe** : tout l'aval lit la forme pi, et rien ne doit
///   connaître les deux.
///
/// Les lignes hors message (usage, compaction, custom_message…) : `None` —
/// l'appelant les garde brutes (le monde des inconnus, sans fabrication).
#[must_use]
pub fn ligne_vers_pi(ligne: &Value) -> Option<LignePi> {
    let objet = ligne.as_object()?;
    // La forme enveloppée : la validation d'identité du codec pi (T016).
    if objet.get("message").is_some_and(Value::is_object) {
        return codecs_identity(ligne);
    }
    // La forme à plat : type "message" + contenu — on enveloppe.
    if objet.get("type").and_then(Value::as_str) == Some("message")
        && objet.get("content").is_some_and(Value::is_array)
    {
        let mut enveloppee = json!({
            "type": "message",
            "message": {
                "content": objet.get("content").cloned().unwrap_or(Value::Null),
                "role": objet.get("role").cloned().unwrap_or(Value::Null),
            },
        });
        if let Some(identifiant) = objet.get("id") {
            enveloppee["id"] = identifiant.clone();
        }
        if let Some(horodatage) = objet.get("timestamp") {
            enveloppee["timestamp"] = horodatage.clone();
        }
        return serde_json::from_value(enveloppee).ok();
    }
    None
}

fn codecs_identity(ligne: &Value) -> Option<LignePi> {
    serde_json::from_value(ligne.clone()).ok()
}

/// La filiation depuis un en-tête de session — le `parentSession` y est le
/// **seul** lien inter-sessions ; un `parentId` de ligne n'y entre JAMAIS
/// (D11 : un branchement intra-session, pas un sous-agent).
#[must_use]
pub fn filiation_de_contenu(entete: &Value) -> Filiation {
    Filiation {
        session_parente: entete
            .get("parentSession")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}
