//! L'historique de session (T014) : l'en-tête (`type: "session"`) et la
//! **queue** (tail) — ce que les lecteurs de profils consomment.

use crate::storage::jsonl::identity::CurseurFichier;
use crate::storage::jsonl::reader;
use std::io::Read;
use std::path::Path;

/// La borne de lecture de l'en-tête (D09) : **64 KiB**. Au-delà, on ne lit
/// pas — une session de plusieurs centaines de mégaoctets se résume à sa
/// première ligne, et la lire entière pour ça serait un coût sans mesure.
pub const ENTETE_MAX_OCTETS: usize = 64 * 1024;

/// La version déclarée par défaut : **1** (mesuré — les en-têtes anciens ne
/// la déclarent pas).
pub const VERSION_DEFAUT: u32 = 1;

/// La ligne d'en-tête de session : la PREMIÈRE ligne d'un JSONL Pi
/// (`type: "session"`, mesuré sur shared/session.ts SessionHeader).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EnTete {
    pub brut: String,
    /// Ce que l'en-tête **déclare** ; rien n'est deviné.
    pub id: Option<String>,
    pub cwd: Option<String>,
    pub parent_session: Option<String>,
    /// `version` déclarée, sinon [`VERSION_DEFAUT`] — jamais 0.
    pub version: u32,
}

/// Lit la première ligne — l'en-tête, s'il existe et se déclare tel.
///
/// ⚠️ **Lecture bornée** (D09) : 64 KiB au plus, jamais le fichier entier.
/// Une première ligne plus longue que la borne n'est pas vue comme un
/// en-tête : c'est une absence, pas une erreur — et rien n'est inventé.
/// ⚠️ **UTF-8 tolérant** : une ligne coupée au milieu d'un caractère reste
/// lisible (perte des octets invalides, pas un échec de lecture).
pub fn en_tete(chemin: &Path) -> std::io::Result<Option<EnTete>> {
    let fichier = std::fs::File::open(chemin)?;
    let mut tampon = Vec::with_capacity(1024);
    fichier
        .take(ENTETE_MAX_OCTETS as u64)
        .read_to_end(&mut tampon)?;
    let Some(fin) = tampon.iter().position(|octet| *octet == b'\n') else {
        // Pas de saut de ligne dans la borne : pas d'en-tête complet à lire.
        return Ok(None);
    };
    let premiere = String::from_utf8_lossy(&tampon[..fin]).to_string();
    if !premiere.contains(r#""type": "session""#) && !premiere.contains(r#""type":"session""#) {
        return Ok(None);
    }
    Ok(Some(entete_depuis(premiere)))
}

/// L'en-tête brut → ses champs déclarés. Un JSON illisible ne fait pas échouer
/// la lecture : la ligne brute reste servie, les champs restent absents.
#[must_use]
pub fn entete_depuis(brut: String) -> EnTete {
    let valeur: Option<serde_json::Value> = serde_json::from_str(&brut).ok();
    let texte = |cle: &str| -> Option<String> {
        valeur
            .as_ref()?
            .get(cle)?
            .as_str()
            .map(std::string::ToString::to_string)
    };
    let version = valeur
        .as_ref()
        .and_then(|valeur| valeur.get("version"))
        .and_then(serde_json::Value::as_u64)
        .map(|version| u32::try_from(version).unwrap_or(VERSION_DEFAUT))
        .unwrap_or(VERSION_DEFAUT);
    EnTete {
        id: texte("id"),
        cwd: texte("cwd"),
        parent_session: texte("parentSession"),
        version,
        brut,
    }
}

/// La queue : une page **avant** depuis le curseur — c'est la lecture de
/// suivi du fil ; rendue ici sous le nom du fil (tail) pour les profils.
pub fn queue(
    chemin: &Path,
    curseur: &CurseurFichier,
    cible_octets: usize,
) -> std::io::Result<reader::PageAvant> {
    reader::page_avant(chemin, curseur, cible_octets)
}
