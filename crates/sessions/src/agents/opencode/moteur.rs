//! Le moteur opencode (T021) : les requêtes **mesurées** sur l'ouvrier
//! SQLite commun — le curseur avance par `seq` (jamais `rowid` : il suit
//! l'ordre d'insertion, pas celui de la conversation dès qu'une ligne est
//! réécrite), et **une ligne = une entrée lue, même non traduite** (sinon le
//! curseur relit les mêmes lignes à chaque tour, indéfiniment).

use crate::families::codecs::opencode;
use crate::pipeline::{Capacites, Codec, Profil};
use serde_json::Value;
use std::sync::Arc;

/// Le profil **opencode** : lisible, catalogue, lancement, interactions —
/// la saisie libre (`Type your own answer`) vient de lui (mesuré).
#[derive(Clone, Copy, Debug)]
pub struct ProfilOpencode;

impl ProfilOpencode {
    #[must_use]
    pub fn genre() -> &'static str {
        "opencode"
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
            codec: Codec {
                ligne_vers_pi: |ligne: &Value| {
                    // L'identifiant est FOURNI (la clé de la ligne) : c'est
                    // lui qui rend le message stable d'une lecture à l'autre
                    // (D15 — remplacement par identifiant, pas empilement).
                    let genre = ligne.get("type").and_then(Value::as_str).unwrap_or("");
                    let data = ligne.get("data").cloned().unwrap_or(Value::Null);
                    let identifiant = ligne.get("id").and_then(Value::as_str).unwrap_or("");
                    crate::families::codecs::opencode::ligne_opencode_vers_pi(
                        genre,
                        &data,
                        identifiant,
                    )
                },
                reglage_vers_pi: None,
            },
        }
    }
}

/// Une entrée de session rendue — la forme `RawEntry` du fil
/// (`{id, parentId, raw, timestamp, type}`), portée en valeur JSON ici ;
/// sa matérialisation en DTO HTTP appartient à `contracts` (T023/T024).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntreeBrute {
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub brut: String,
    pub timestamp: Option<String>,
    pub genre: String,
}

/// Une page de conversation opencode.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PageOpencode {
    pub entrees: Vec<EntreeBrute>,
    /// Des messages plus anciens existent hors de la fenêtre.
    pub has_more: bool,
    /// Première ligne de la fenêtre RENDUE — la base du curseur « plus tôt »
    /// (ne pas confondre avec `dernier_seq` : les confondre ferait
    /// redemander la même page).
    pub premier_seq: i64,
    /// Dernière ligne **lue** — la position du prochain rafraîchissement.
    pub dernier_seq: i64,
}

/// Une ligne telle que la base la rend (mesuré : `LigneBrute`).
struct LigneBase {
    identifiant: String,
    genre: String,
    seq: i64,
    time_created: i64,
    data: String,
}

fn lignes_de(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    sql: &str,
    params: &[&str],
) -> Result<Vec<LigneBase>, String> {
    let rendues = ouvrier
        .interroge(sql, params)
        .map_err(|cause| cause.to_string())?;
    Ok(rendues
        .into_iter()
        .map(|ligne| LigneBase {
            identifiant: ligne
                .valeurs
                .first()
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            genre: ligne
                .valeurs
                .get(1)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            seq: ligne.valeurs.get(2).and_then(Value::as_i64).unwrap_or(0),
            time_created: ligne.valeurs.get(3).and_then(Value::as_i64).unwrap_or(0),
            data: ligne
                .valeurs
                .get(4)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        })
        .collect())
}

/// Une ligne de la base → une entrée, **traduite quand c'est possible**.
fn vers_entree(ligne: &LigneBase) -> EntreeBrute {
    let analyse: Value = serde_json::from_str(&ligne.data).unwrap_or(Value::Null);
    let traduite = opencode::ligne_opencode_vers_pi(&ligne.genre, &analyse, &ligne.identifiant);
    if let Some(traduite) = traduite {
        return EntreeBrute {
            id: traduite.id.clone(),
            parent_id: None,
            brut: serde_json::to_string(&traduite).unwrap_or_default(),
            timestamp: traduite.timestamp.clone(),
            genre: String::from("message"),
        };
    }
    // Une ligne non traduite est conservée **telle quelle** : fidélité au
    // fil, et un type inconnu ne fait pas tomber la lecture. La date vient
    // de la colonne (toujours renseignée) — l'ISO normalisé au codec.
    EntreeBrute {
        id: Some(format!("opencode:{}", ligne.identifiant)),
        parent_id: None,
        brut: ligne.data.clone(),
        timestamp: opencode::horodatage_iso(ligne.time_created),
        genre: ligne.genre.clone(),
    }
}

/// La session existe-t-elle dans la base ? — ⚠️ une distinction de
/// **diagnostic** : un identifiant que Herdr annonce mais que la base ignore
/// est une **erreur** ; une session connue sans message est **vide** (bénin).
/// Les confondre donnerait une erreur rouge sur un agent qui démarre, ou un
/// écran muet sur une vraie panne.
pub fn session_existe(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
) -> Result<bool, String> {
    let lignes = ouvrier
        .interroge(
            "SELECT count(*) AS n FROM session_v2 WHERE id = ?1",
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

/// Dernière page de la conversation : `limite + 1` lues en descendant pour
/// savoir s'il en reste, la plus ancienne jetée (pas de second `count(*)`
/// sur une grosse base).
pub fn lire_derniere(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    limite: u32,
) -> Result<PageOpencode, String> {
    let sql = format!(
        "SELECT id, type, seq, time_created, data FROM session_message \
         WHERE session_id = ?1 ORDER BY seq DESC LIMIT {limite}"
    );
    let lignes = lignes_de(ouvrier, &sql, &[identifiant])?;
    let has_more = (lignes.len() as u32) > limite;
    let gardees: Vec<&LigneBase> = lignes.iter().take(limite as usize).collect();
    // remis dans l'ordre de lecture — UNE fois (le rev du collecteur).
    let entrees: Vec<EntreeBrute> = gardees
        .iter()
        .rev()
        .map(|ligne| vers_entree(ligne))
        .collect();
    Ok(PageOpencode {
        // Dans une descente : le PLUS ANCIEN gardé est le DERNIER de la liste.
        premier_seq: gardees.last().map(|ligne| ligne.seq).unwrap_or(0),
        dernier_seq: gardees.first().map(|ligne| ligne.seq).unwrap_or(0),
        entrees,
        has_more,
    })
}

/// Les lignes **à partir** d'un curseur, **borne incluse**.
///
/// ⚠️ **`seq >= ?` et non `seq > ?` — et c'est tout le correctif du
/// streaming (D15).** Mesuré : **97 % des lignes (1 943 sur 1 993) sont
/// réécrites après leur création** — une réponse grossit dans la MÊME ligne
/// (7,8 s mesurées), son `seq` ne bouge pas. Un `>` strict ne renvoyait
/// RIEN tant qu'une nouvelle ligne n'apparaissait pas. Le coût de
/// l'inclusion : **une ligne relue** par rafraîchissement, assumé — le
/// client **remplace par identifiant** au lieu d'empiler.
pub fn lire_depuis(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    depuis: i64,
    limite: u32,
) -> Result<PageOpencode, String> {
    let sql = format!(
        "SELECT id, type, seq, time_created, data FROM session_message \
         WHERE session_id = ?1 AND seq >= ?2 ORDER BY seq LIMIT {limite}"
    );
    let lignes = lignes_de(ouvrier, &sql, &[identifiant, &depuis.to_string()])?;
    let dernier_seq = lignes.last().map(|ligne| ligne.seq).unwrap_or(depuis);
    let entrees: Vec<EntreeBrute> = lignes.iter().map(vers_entree).collect();
    Ok(PageOpencode {
        premier_seq: lignes.first().map(|ligne| ligne.seq).unwrap_or(depuis),
        dernier_seq,
        entrees,
        // Une page pleine PEUT cacher la suite : on ne l'affirme pas, on
        // la signale.
        has_more: (lignes.len() as u32) >= limite,
    })
}

/// La page **antérieure** (« charger plus tôt ») : les `limite` lignes juste
/// AVANT le curseur — descendantes puis remises dans l'ordre (lire en
/// montant depuis 0 rendrait le début de la conversation, pas la page
/// d'avant).
pub fn lire_avant(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    avant: i64,
    limite: u32,
) -> Result<PageOpencode, String> {
    let sql = format!(
        "SELECT id, type, seq, time_created, data FROM session_message \
         WHERE session_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT {limite}"
    );
    let lignes = lignes_de(ouvrier, &sql, &[identifiant, &avant.to_string()])?;
    let has_more = (lignes.len() as u32) >= limite;
    let gardees: Vec<&LigneBase> = lignes.iter().take(limite as usize).collect();
    let entrees: Vec<EntreeBrute> = gardees
        .iter()
        .rev()
        .map(|ligne| vers_entree(ligne))
        .collect();
    Ok(PageOpencode {
        // Idem : le plus ancien gardé est le DERNIER de la descente.
        premier_seq: gardees.last().map(|ligne| ligne.seq).unwrap_or(avant),
        dernier_seq: gardees.first().map(|ligne| ligne.seq).unwrap_or(avant),
        entrees,
        has_more,
    })
}

/// La page prête à mettre dans la réponse — **pure** : testable sur une
/// base fabriquée, sans serveur ni agent (la route ne fait que l'encodage
/// du curseur et la sérialisation).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ReponsePage {
    pub curseur: i64,
    pub entrees: Vec<EntreeBrute>,
    pub has_more: bool,
    pub incremental: bool,
    /// Position de la page précédente, quand il en reste une.
    pub previous_seq: Option<i64>,
}

pub fn page_session(
    ouvrier: &crate::storage::sqlite::worker::Ouvrier,
    identifiant: &str,
    avant: Option<i64>,
    depuis: Option<i64>,
    lignes: u32,
) -> Result<ReponsePage, String> {
    match (avant, depuis) {
        // Le curseur du client ne bouge pas : c'est LUI qui reste la position
        // courante, la page d'avant est décrite par `previous_seq`.
        (Some(avant), _) => {
            let page = lire_avant(ouvrier, identifiant, avant, lignes)?;
            Ok(ReponsePage {
                curseur: avant,
                has_more: page.has_more,
                entrees: page.entrees,
                incremental: false,
                previous_seq: if page.has_more {
                    Some(page.premier_seq)
                } else {
                    None
                },
            })
        }
        (None, Some(depuis)) => {
            let page = lire_depuis(ouvrier, identifiant, depuis, lignes)?;
            Ok(ReponsePage {
                curseur: page.dernier_seq,
                has_more: page.has_more,
                entrees: page.entrees,
                incremental: true,
                previous_seq: if page.has_more {
                    Some(page.premier_seq)
                } else {
                    None
                },
            })
        }
        (None, None) => {
            let page = lire_derniere(ouvrier, identifiant, lignes)?;
            Ok(ReponsePage {
                curseur: page.dernier_seq,
                has_more: page.has_more,
                entrees: page.entrees,
                incremental: false,
                previous_seq: if page.has_more {
                    Some(page.premier_seq)
                } else {
                    None
                },
            })
        }
    }
}

#[derive(Clone)]
pub struct MoteurOpencode {
    pub ouvrier: Arc<crate::storage::sqlite::worker::Ouvrier>,
}

impl MoteurOpencode {
    #[must_use]
    pub fn nouveau(ouvrier: Arc<crate::storage::sqlite::worker::Ouvrier>) -> Self {
        Self { ouvrier }
    }
}

// Les capacités de la famille opencode (profil) restent mesurées : la
// saisie libre (`Type your own answer`) vient de LUI.
#[allow(dead_code)]
fn _capacites_documentees() -> Capacites {
    Profil::capacites_placeholder()
}

impl Profil {
    fn capacites_placeholder() -> Capacites {
        Capacites {
            lisible: true,
            catalogue: true,
            lancement: true,
            interactions: true,
        }
    }
}
