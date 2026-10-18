//! L'historique de session (T014) : l'en-tête (`type: "session"`) et la
//! **queue** (tail) — ce que les lecteurs de profils consomment.

use crate::storage::jsonl::identity::CurseurFichier;
use crate::storage::jsonl::reader;
use std::path::Path;

/// La ligne d'en-tête de session : la PREMIÈRE ligne d'un JSONL Pi
/// (`type: "session"`, mesuré sur shared/session.ts SessionHeader).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EnTete {
    pub brut: String,
}

/// Lit la première ligne — l'en-tête, s'il existe et se déclare tel.
pub fn en_tete(chemin: &Path) -> std::io::Result<Option<EnTete>> {
    let contenu = std::fs::read_to_string(chemin)?;
    match contenu.lines().next() {
        Some(premiere)
            if premiere.contains(r#""type": "session""#)
                || premiere.contains(r#""type":"session""#) =>
        {
            Ok(Some(EnTete {
                brut: premiere.to_string(),
            }))
        }
        _ => Ok(None),
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
