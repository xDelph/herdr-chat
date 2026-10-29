//! Les curseurs **opaques versionnés** (T024/C12) : liés à la source, à la
//! session et à la génération — le client ne voit qu'une chaîne, le serveur
//! vérifie tout.
//!
//! ⚠️ **Deux formes, jamais confondues** :
//!
//! - `hc2:…` — la forme **versionnée v2** (base64url du payload JSON) :
//!   empreinte de source, session, génération, position ;
//! - la forme **legacy fichier** (compatibilité) : le base64 de
//!   `{"dev":…,"ino":…,"offset":…}` du fil actuel — décodable, jamais
//!   ré-émise (un nouveau curseur est toujours `hc2:`).
//!
//! ⚠️ **Le curseur d'A ne lit jamais B** (C12) : la validation compare
//! l'empreinte de source ET la session — un curseur étranger est une erreur
//! nommée, pas une lecture au hasard. Le legacy SQLite du fil
//! (`{dev:0,ino:0,offset:seq}`) ne porte AUCUNE identité : il ne s'attache
//! qu'à la source de la requête qui le porte — le **reset legacy**.

use base64::Engine;
use serde_json::{Value, json};
use std::fmt;

/// Les erreurs de curseur — chaque cause nommée ; la cartographie HTTP
/// (400/409) en découle sans re-décision.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurCurseur {
    /// Illisible : base64/JSON cassé, version inconnue, nombre invalide,
    /// offset négatif — le client doit repartir d'une page fraîche (400).
    Illisible,
    /// Le curseur ET le « avant » fournis ensemble — exclusifs (400).
    Exclusifs,
    /// Le curseur appartient à une AUTRE source/session (400 — C12 : le
    /// curseur d'A ne lit jamais B).
    SessionEtrangere,
    /// Le curseur d'historique est périmé (409).
    Perime,
}

impl fmt::Display for ErreurCurseur {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErreurCurseur::Illisible => f.write_str("cursor rejected: unreadable"),
            ErreurCurseur::Exclusifs => {
                f.write_str("cursor rejected: cursor and before are exclusive")
            }
            ErreurCurseur::SessionEtrangere => {
                f.write_str("cursor rejected: it belongs to another session")
            }
            ErreurCurseur::Perime => f.write_str("cursor rejected: stale history cursor"),
        }
    }
}

impl std::error::Error for ErreurCurseur {}

impl ErreurCurseur {
    /// La cartographie HTTP documentée de H04 : tout ce qui est illisible,
    /// exclusif ou étranger est un **400** ; un curseur d'historique périmé
    /// est un **409**.
    #[must_use]
    pub fn statut(&self) -> u16 {
        match self {
            ErreurCurseur::Perime => 409,
            _ => 400,
        }
    }
}

/// Le curseur décodé — soit la forme versionnée, soit le legacy fichier.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Curseur {
    /// Le legacy du fil : l'identité du fichier + l'offset — SANS source ni
    /// session : il ne s'attache qu'à la source de la requête qui le porte.
    LegacyFichier { dev: u64, ino: u64, offset: u64 },
    /// La forme v2 : liée à la source, à la session et à la génération.
    ///
    /// `fichier` : l'identité (dev, ino) du fichier lu, quand le curseur la
    /// porte. ⚠️ Les curseurs `hc2:` émis avant elle ne la portent pas :
    /// `None` = identité **inconnue**, la lecture continue comme avant (rien
    /// n'est supposé, ni continuité ni rotation).
    Versionne {
        empreinte_source: String,
        session: String,
        generation: u64,
        position: i64,
        fichier: Option<(u64, u64)>,
    },
}

impl Curseur {
    /// La position brute (offset fichier ou seq SQLite) — pour la lecture.
    #[must_use]
    pub fn position(&self) -> i64 {
        match self {
            Curseur::LegacyFichier { offset, .. } => *offset as i64,
            Curseur::Versionne { position, .. } => *position,
        }
    }

    /// Le curseur lié à une source : le legacy se recolle à la source de la
    /// requête (le reset legacy) ; le v2 se VALIDE.
    pub fn lie_a(
        &self,
        empreinte_source: &str,
        session: &str,
    ) -> Result<CurseurLie, ErreurCurseur> {
        match self {
            Curseur::LegacyFichier { dev, ino, .. } => Ok(CurseurLie {
                empreinte_source: empreinte_source.to_string(),
                session: session.to_string(),
                position: self.position(),
                // Le legacy SQLite porte {0,0} : aucune identité.
                fichier: (*dev != 0 || *ino != 0).then_some((*dev, *ino)),
            }),
            Curseur::Versionne {
                empreinte_source: source_portee,
                session: session_portee,
                generation: _,
                position,
                fichier,
            } => {
                if source_portee != empreinte_source || session_portee != session {
                    return Err(ErreurCurseur::SessionEtrangere);
                }
                // La génération est une OPINION de fraîcheur, pas un facteur :
                // la position passe telle quelle.
                Ok(CurseurLie {
                    empreinte_source: empreinte_source.to_string(),
                    session: session.to_string(),
                    position: *position,
                    fichier: *fichier,
                })
            }
        }
    }
}

/// Un curseur **validé** pour la source/session demandée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CurseurLie {
    pub empreinte_source: String,
    pub session: String,
    pub position: i64,
    /// L'identité (dev, ino) du fichier lu, quand le curseur la porte.
    pub fichier: Option<(u64, u64)>,
}

/// Encode un curseur versionné — **le seul encodage émis** : opaque, lié,
/// lisible par personne.
#[must_use]
pub fn encode(empreinte_source: &str, session: &str, generation: u64, position: i64) -> String {
    let charge = json!({
        "v": 2,
        "src": empreinte_source,
        "ses": session,
        "gen": generation,
        "pos": position,
    });
    format!(
        "hc2:{}",
        base64::engine::general_purpose::STANDARD.encode(charge.to_string())
    )
}

/// Encode un curseur versionné **de fichier** : la position ET l'identité
/// (dev, ino) du fichier lu — un fichier remplacé au même chemin se
/// reconnaît au lieu d'être lu depuis un offset périmé.
#[must_use]
pub fn encode_fichier(
    empreinte_source: &str,
    session: &str,
    generation: u64,
    position: i64,
    dev: u64,
    ino: u64,
) -> String {
    let charge = json!({
        "v": 2,
        "src": empreinte_source,
        "ses": session,
        "gen": generation,
        "pos": position,
        "dev": dev,
        "ino": ino,
    });
    format!(
        "hc2:{}",
        base64::engine::general_purpose::STANDARD.encode(charge.to_string())
    )
}

/// Décode un curseur opaque — legacy fichier ou v2 ; toute illisibilité est
/// une erreur nommée (le caller répond 400, jamais deviner).
pub fn decode(encoded: &str) -> Result<Curseur, ErreurCurseur> {
    if let Some(charge) = encoded.strip_prefix("hc2:") {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(charge)
            .map_err(|_| ErreurCurseur::Illisible)?;
        let parsed: Value = serde_json::from_slice(&raw).map_err(|_| ErreurCurseur::Illisible)?;
        if parsed.get("v").and_then(Value::as_u64) != Some(2) {
            // Une version inconnue : refusée — jamais devinée.
            return Err(ErreurCurseur::Illisible);
        }
        // Une position absente, non entière ou négative produirait une
        // lecture au hasard (un `0` deviné) : refusée, comme le legacy.
        let position = parsed
            .get("pos")
            .and_then(Value::as_i64)
            .filter(|position| *position >= 0)
            .ok_or(ErreurCurseur::Illisible)?;
        return Ok(Curseur::Versionne {
            empreinte_source: parsed
                .get("src")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            session: parsed
                .get("ses")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            generation: parsed.get("gen").and_then(Value::as_u64).unwrap_or(1),
            position,
            fichier: match (
                parsed.get("dev").and_then(Value::as_u64),
                parsed.get("ino").and_then(Value::as_u64),
            ) {
                (Some(dev), Some(ino)) => Some((dev, ino)),
                _ => None,
            },
        });
    }
    // Legacy : le base64 de {"dev","ino","offset"}.
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| ErreurCurseur::Illisible)?;
    let parsed: Value = serde_json::from_slice(&raw).map_err(|_| ErreurCurseur::Illisible)?;
    let offset = parsed
        .get("offset")
        .and_then(Value::as_i64)
        .ok_or(ErreurCurseur::Illisible)?;
    if offset < 0 {
        // Un offset négatif produit une lecture au hasard : refusé ici.
        return Err(ErreurCurseur::Illisible);
    }
    Ok(Curseur::LegacyFichier {
        dev: parsed.get("dev").and_then(Value::as_u64).unwrap_or(0),
        ino: parsed.get("ino").and_then(Value::as_u64).unwrap_or(0),
        offset: offset as u64,
    })
}

/// La validation d'une DEMANDE de lecture : le curseur et le « avant » sont
/// **exclusifs** — fournir les deux n'est pas une lecture définissable.
pub fn valide_paire(curseur: Option<&str>, avant: Option<&str>) -> Result<(), ErreurCurseur> {
    if curseur.is_some() && avant.is_some() {
        return Err(ErreurCurseur::Exclusifs);
    }
    Ok(())
}
