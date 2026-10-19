//! Le port d'artefacts **réel** : `files` → `ArtifactPort`.
//!
//! ⚠️ **La garde vit ici, pas dans le handler.** Le handler transmet les
//! racines autorisées **de la requête** et le chemin demandé ; ce module
//! résout puis vérifie l'appartenance (S03/S04), ouvre sur descripteur et
//! borne la lecture. Un handler qui découperait le chemin lui-même
//! réécrirait la garde ailleurs — et deux gardes divergent toujours.
//!
//! ⚠️ **Un refus est un `PathRejected`**, pas une panne : le fil répond 403
//! avec la raison exacte, jamais un 500 générique.

use crate::authorized_file::{
    ErreurFichier, describe_erreur_fichier, lit_fichier_autorise, serait_inline,
};
use crate::mime::content_type_de;
use crate::scan::{LIMITE_DEFAUT, liste_images_recentes};
use domain::ports::{
    ArtifactBody, ArtifactPort, AuthorizedFileRequest, AuthorizedRoots, ImageScan, PortFuture,
    RecentImageObservation,
};
use std::path::PathBuf;

/// Le port réel — sans état : chaque appel repart des racines qu'on lui donne.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct PortArtefacts;

impl PortArtefacts {
    #[must_use]
    pub fn nouveau() -> Self {
        Self
    }
}

/// Les racines du domaine → les chemins du disque.
fn chemins(roots: &AuthorizedRoots) -> Vec<PathBuf> {
    roots.entries.iter().map(PathBuf::from).collect()
}

/// Un refus de fichier → l'erreur de port : la **raison** passe telle quelle.
#[must_use]
pub fn erreur_de_port(erreur: &ErreurFichier) -> domain::errors::PortError {
    domain::errors::PortError::PathRejected {
        detail: describe_erreur_fichier(erreur),
    }
}

impl ArtifactPort for PortArtefacts {
    fn open(&self, request: AuthorizedFileRequest) -> PortFuture<'_, ArtifactBody> {
        Box::pin(async move {
            let racines = chemins(&request.roots);
            let servi = lit_fichier_autorise(&racines, std::path::Path::new(&request.requested))
                .map_err(|erreur| erreur_de_port(&erreur))?;
            // Le type et la disposition suivent le chemin RÉEL (canonique) :
            // un lien vers un `.png` sert un png, jamais le type de
            // l'extension d'appel (T046).
            let reel = crate::confined::canonique(std::path::Path::new(&request.requested))
                .unwrap_or_else(|_| PathBuf::from(&request.requested));
            Ok(ArtifactBody {
                content_type: content_type_de(&reel),
                filename: Some(servi.nom),
                inline: serait_inline(&reel),
                bytes: servi.octets,
            })
        })
    }

    fn recent_images(&self, roots: AuthorizedRoots) -> PortFuture<'_, ImageScan> {
        Box::pin(async move {
            let images = liste_images_recentes(&chemins(&roots), LIMITE_DEFAUT);
            Ok(ImageScan {
                images: images
                    .into_iter()
                    .map(|image| RecentImageObservation {
                        modified_at: image.modifiee_a,
                        path: image.chemin,
                        size: image.taille,
                    })
                    .collect(),
            })
        })
    }
}
