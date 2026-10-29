//! Le magasin **fichier** des lectures partagées (H22) — `reads.json`, un
//! instant par pane.
//!
//! ⚠️ L'écriture passe par un fichier temporaire renommé : un arrêt au milieu
//! ne laisse jamais un JSON tronqué. Un fichier absent est une table vide ;
//! un fichier illisible est une **panne nommée**, jamais une table vide
//! silencieuse.

use application::lectures::MagasinLectures;
use std::collections::HashMap;
use std::path::PathBuf;

/// Les lectures dans un fichier JSON `{ "<paneId>": <ms>, … }`.
pub struct FichierLectures {
    chemin: PathBuf,
}

impl FichierLectures {
    #[must_use]
    pub fn nouveau(chemin: PathBuf) -> Self {
        Self { chemin }
    }
}

impl MagasinLectures for FichierLectures {
    fn charge(&self) -> Result<HashMap<String, u64>, String> {
        let brut = match std::fs::read(&self.chemin) {
            Ok(brut) => brut,
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
                return Ok(HashMap::new());
            }
            Err(cause) => return Err(format!("{}: {cause}", self.chemin.display())),
        };
        serde_json::from_slice(&brut).map_err(|cause| format!("{}: {cause}", self.chemin.display()))
    }

    fn ecrit(&self, lectures: &HashMap<String, u64>) -> Result<(), String> {
        let nomme = |cause: std::io::Error| format!("{}: {cause}", self.chemin.display());
        if let Some(dossier) = self.chemin.parent() {
            std::fs::create_dir_all(dossier).map_err(nomme)?;
        }
        let octets = serde_json::to_vec(lectures).map_err(|cause| cause.to_string())?;
        let temporaire = self.chemin.with_extension("json.tmp");
        std::fs::write(&temporaire, octets).map_err(nomme)?;
        std::fs::rename(&temporaire, &self.chemin).map_err(nomme)
    }
}
