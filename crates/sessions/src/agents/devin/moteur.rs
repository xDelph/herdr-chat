//! Le moteur devin (T022) : les requêtes **mesurées** sur l'ouvrier commun —
//! ⚠️ **le curseur avance par `row_id`, jamais par `node_id`** : le node_id
//! est un rang DANS LA FORÊT de la session (deux sessions ont chacune le
//! leur) ; s'en servir ferait relire la mauvaise conversation dès qu'on
//! change d'agent. La table `message_nodes` :
//!
//! ```sql
//! row_id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
//! node_id INTEGER NOT NULL, parent_node_id INTEGER, chat_message TEXT NOT NULL,
//! created_at INTEGER NOT NULL, metadata TEXT, UNIQUE(session_id, node_id)
//! ```

use crate::families::codecs::devin;
use crate::pipeline::{Capacites, Codec, Profil};
use serde_json::Value;

/// Le profil **Devin** : lisible, catalogue, lancement ; interactions non
/// établies (mesuré : aucune session réelle n'en montre) — la capacité se
/// posera quand une preuve existera, pas avant.
#[derive(Clone, Copy, Debug)]
pub struct ProfilDevin;

impl ProfilDevin {
    #[must_use]
    pub fn genre() -> &'static str {
        "devin"
    }

    #[must_use]
    pub fn capacites() -> Capacites {
        Capacites {
            lisible: true,
            catalogue: true,
            lancement: true,
            interactions: false,
        }
    }

    #[must_use]
    pub fn profil() -> Profil {
        Profil {
            genre: Self::genre(),
            capacites: Self::capacites(),
            codec: Codec {
                ligne_vers_pi: |ligne: &Value| {
                    // La clé de la ligne = le row_id (le curseur) — JAMAIS
                    // le node_id (rang de forêt, non unique entre sessions).
                    let row_id = ligne.get("row_id").and_then(Value::as_i64).unwrap_or(0);
                    let chat_message = ligne.get("chat_message").cloned().unwrap_or(Value::Null);
                    crate::families::codecs::devin::ligne_devin_vers_pi(
                        &chat_message,
                        &row_id.to_string(),
                    )
                },
                reglage_vers_pi: None,
            },
        }
    }
}

/// Une entrée de session rendue — la même forme qu'opencode (la route n'a
/// qu'un chemin).
pub type EntreeBrute = crate::agents::opencode::moteur::EntreeBrute;

/// Une page de conversation — la même forme qu'opencode.
pub type PageOpencode = crate::agents::opencode::moteur::PageOpencode;

fn vers_entree(row_id: i64, chat_message: &str, created_at: i64) -> EntreeBrute {
    let analyse: Value = serde_json::from_str(chat_message).unwrap_or(Value::Null);
    let traduite = devin::ligne_devin_vers_pi(&analyse, &row_id.to_string());
    if let Some(traduite) = traduite {
        return EntreeBrute {
            id: traduite.id.clone(),
            parent_id: None,
            brut: serde_json::to_string(&traduite).unwrap_or_default(),
            timestamp: traduite.timestamp.clone(),
            genre: String::from("message"),
        };
    }
    // Non traduite (`system` — majoritaire et écarté, rôle inconnu, JSON
    // illisible) : conservée TELLE QUELLE. La date vient de la COLONNE
    // (millisecondes — l'ISO se calcule au codec opencode, partagé).
    let genre = analyse
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    EntreeBrute {
        id: Some(format!("devin:{row_id}")),
        parent_id: None,
        brut: chat_message.to_string(),
        timestamp: crate::families::codecs::opencode::horodatage_iso(created_at),
        genre,
    }
}

/// La session existe-t-elle ? — même distinction qu'opencode : erreur ≠ vide.
pub fn session_existe(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
) -> Result<bool, String> {
    let lignes = ouvrier
        .interroge(
            "SELECT count(*) AS n FROM sessions WHERE id = ?1",
            &[identifiant],
        )
        .map_err(|cause| cause.to_string())?;
    Ok(lignes
        .first()
        .and_then(|ligne| ligne.valeurs.first())
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0)
}

const COLONNES: &str = "SELECT row_id, chat_message, created_at FROM message_nodes";

/// Dernière page : lecture **descendante**, remise dans l'ordre.
pub fn lire_derniere(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    limite: u32,
) -> Result<PageOpencode, String> {
    let lues = limite.saturating_add(1);
    let sql = format!("{COLONNES} WHERE session_id = ?1 ORDER BY row_id DESC LIMIT {lues}");
    let rendues = ouvrier
        .interroge(&sql, &[identifiant])
        .map_err(|cause| cause.to_string())?;
    let has_more = (rendues.len() as u32) > limite;
    let gardees: Vec<&crate::storage::sqlite::worker::Ligne> =
        rendues.iter().take(limite as usize).collect();
    // La ligne en trop est la plus ANCIENNE, donc la dernière en descendant.
    let mut entrees: Vec<EntreeBrute> = Vec::new();
    let mut positions: Vec<i64> = Vec::new();
    for ligne in gardees.iter().rev() {
        let row_id = ligne.valeurs.first().and_then(Value::as_i64).unwrap_or(0);
        let chat_message = ligne.valeurs.get(1).and_then(Value::as_str).unwrap_or("");
        let created_at = ligne.valeurs.get(2).and_then(Value::as_i64).unwrap_or(0);
        entrees.push(vers_entree(row_id, chat_message, created_at));
        positions.push(row_id);
    }
    Ok(PageOpencode {
        // Les positions sont poussées dans l'ordre de lecture (rev) :
        // premier = le plus ancien, dernier = le plus récent.
        premier_seq: positions.first().copied().unwrap_or(0),
        dernier_seq: positions.last().copied().unwrap_or(0),
        entrees,
        has_more,
    })
}

/// Lignes **à partir** d'un curseur, **borne incluse** — même raison
/// qu'opencode : devin réécrit une ligne quand une génération se termine,
/// son `row_id` ne bouge pas ; le client fusionne par identifiant.
pub fn lire_depuis(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    depuis: i64,
    limite: u32,
) -> Result<PageOpencode, String> {
    let sql =
        format!("{COLONNES} WHERE session_id = ?1 AND row_id >= ?2 ORDER BY row_id LIMIT {limite}");
    let rendues = ouvrier
        .interroge(&sql, &[identifiant, &depuis.to_string()])
        .map_err(|cause| cause.to_string())?;
    let mut entrees: Vec<EntreeBrute> = Vec::new();
    let mut positions: Vec<i64> = Vec::new();
    for ligne in rendues.iter() {
        let row_id = ligne.valeurs.first().and_then(Value::as_i64).unwrap_or(0);
        let chat_message = ligne.valeurs.get(1).and_then(Value::as_str).unwrap_or("");
        let created_at = ligne.valeurs.get(2).and_then(Value::as_i64).unwrap_or(0);
        entrees.push(vers_entree(row_id, chat_message, created_at));
        positions.push(row_id);
    }
    Ok(PageOpencode {
        premier_seq: positions.first().copied().unwrap_or(depuis),
        dernier_seq: positions.last().copied().unwrap_or(depuis),
        entrees,
        has_more: (rendues.len() as u32) >= limite,
    })
}

/// Page **antérieure** au curseur (« charger plus tôt »).
pub fn lire_avant(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    avant: i64,
    limite: u32,
) -> Result<PageOpencode, String> {
    let lues = limite.saturating_add(1);
    let sql = format!(
        "{COLONNES} WHERE session_id = ?1 AND row_id < ?2 ORDER BY row_id DESC LIMIT {lues}"
    );
    let rendues = ouvrier
        .interroge(&sql, &[identifiant, &avant.to_string()])
        .map_err(|cause| cause.to_string())?;
    let has_more = (rendues.len() as u32) > limite;
    let gardees: Vec<&crate::storage::sqlite::worker::Ligne> =
        rendues.iter().take(limite as usize).collect();
    let mut entrees: Vec<EntreeBrute> = Vec::new();
    let mut positions: Vec<i64> = Vec::new();
    for ligne in gardees.iter().rev() {
        let row_id = ligne.valeurs.first().and_then(Value::as_i64).unwrap_or(0);
        let chat_message = ligne.valeurs.get(1).and_then(Value::as_str).unwrap_or("");
        let created_at = ligne.valeurs.get(2).and_then(Value::as_i64).unwrap_or(0);
        entrees.push(vers_entree(row_id, chat_message, created_at));
        positions.push(row_id);
    }
    Ok(PageOpencode {
        // Poussées dans l'ordre de lecture (rev) : premier = le plus ancien.
        premier_seq: positions.first().copied().unwrap_or(avant),
        dernier_seq: positions.last().copied().unwrap_or(avant),
        entrees,
        has_more,
    })
}
