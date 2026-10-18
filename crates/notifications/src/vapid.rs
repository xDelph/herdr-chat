//! Les clés VAPID (T044, E08) : import par environnement, génération,
//! équivalence public/privé vérifiée — jamais une clé régénérée en silence.
//!
//! ⚠️ **La paire env est refusée si partielle** : une seule des deux clés
//! ne peut pas signer — c'est une erreur, pas une génération de secours.
//!
//! ⚠️ **Équivalence vérifiée** (TECH §7) : une clé privée importée doit
//! dériver la clé publique déclarée — un mélange de deux paires est refusé
//! avant toute utilisation, jamais découvert au premier envoi.
//!
//! ⚠️ **La forme est celle des clés Node** : base64url sans padding — la
//! clé publique est le point P-256 non compressé (65 octets), la privée le
//! scalaire (32 octets). Le builder VAPID de `web-push` accepte ces clés
//! brutes.

use crate::store::{ClefsVapid, ErreurStore};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair};

/// Décode une clé base64url sans padding.
fn decode_cle(raw: &str) -> Result<Vec<u8>, ErreurStore> {
    URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|cause| ErreurStore::ClefsInvalides {
            raison: format!("clé non décodable : {cause}"),
        })
}

/// Encode en base64url sans padding — la forme exacte des clés Node.
fn encode_cle(octets: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(octets)
}

impl ClefsVapid {
    /// La paire depuis l'environnement — `None` quand aucune clé n'est
    /// fournie ; une paire PARTIELLE est refusée ; une paire complète est
    /// vérifiée (la privée doit dériver la publique).
    pub fn depuis_env(
        publique: Option<String>,
        privee: Option<String>,
    ) -> Result<Option<Self>, ErreurStore> {
        match (publique, privee) {
            (Some(publique), Some(privee)) => {
                let clefs = Self {
                    public_key: publique,
                    private_key: privee,
                };
                clefs.verifie_equivalence()?;
                Ok(Some(clefs))
            }
            (None, None) => Ok(None),
            _ => Err(ErreurStore::PaireEnvPartielle),
        }
    }

    /// Vérifie que la clé privée dérive exactement la clé publique déclarée.
    pub fn verifie_equivalence(&self) -> Result<(), ErreurStore> {
        let privee = decode_cle(&self.private_key)?;
        let paire =
            ES256KeyPair::from_bytes(&privee).map_err(|cause| ErreurStore::ClefsInvalides {
                raison: format!("clé privée illisible : {cause}"),
            })?;
        let derivee = paire.public_key().public_key().to_bytes_uncompressed();
        let declaree = decode_cle(&self.public_key)?;
        if derivee != declaree {
            return Err(ErreurStore::ClefsInvalides {
                raison: String::from(
                    "la clé publique ne correspond pas à la clé privée (paire mélangée)",
                ),
            });
        }
        Ok(())
    }
}

/// Génère une paire VAPID fraîche — la forme exacte des clés Node.
#[must_use]
pub fn genere_clefs_vapid() -> ClefsVapid {
    let paire = ES256KeyPair::generate();
    let privee = paire.to_bytes();
    let publique = paire.public_key().public_key().to_bytes_uncompressed();
    ClefsVapid {
        public_key: encode_cle(&publique),
        private_key: encode_cle(&privee),
    }
}
