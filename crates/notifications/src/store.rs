//! Le store push (T044, E08, C14) : la forme legacy EXACTE, un écrivain
//! sérialisé, l'écriture atomique — un fichier corrompu est VISIBLE, jamais
//! régénéré en silence.
//!
//! ⚠️ **La compatibilité est le contrat** : le JSON du fil (PushStore.ts)
//! — `{subscriptions: [{endpoint, keys: {p256dh, auth}}], vapidKeys?}` —
//! est lu et écrit tel quel. Des clés et abonnements existants ne changent
//! pas de forme.
//!
//! ⚠️ **Un écrivain sérialisé** (E08) : les opérations de lecture-
//! modification-écriture passent par UNE porte — jamais deux écritures
//! entrelacées. Les envois réseau (T045) ne passent JAMAIS par elle (C14 :
//! aucune livraison sous lock du store).

use crate::vapid;
use files::atomic::ecrit_atomique;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

/// La forme legacy du store — la compatibilité est le contrat.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorePush {
    pub subscriptions: Vec<AbonnementPush>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vapid_keys: Option<ClefsVapid>,
}

/// Un abonnement Web Push, tel que le navigateur l'a remis.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct AbonnementPush {
    pub endpoint: String,
    pub keys: ClefsAbonnement,
}

/// Les clés d'un abonnement (p256dh + auth).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct ClefsAbonnement {
    pub p256dh: String,
    pub auth: String,
}

/// La paire VAPID — `publicKey`/`privateKey` dans le JSON legacy.
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClefsVapid {
    pub public_key: String,
    pub private_key: String,
}

/// Les raisons d'un échec de store — une cause réelle, jamais générique.
#[derive(Debug)]
pub enum ErreurStore {
    /// Le fichier est absent ou illisible — une cause, pas un vide inventé.
    Illisible {
        chemin: PathBuf,
        cause: String,
    },
    Ecriture {
        chemin: PathBuf,
        cause: String,
    },
    /// La paire env n'a qu'une seule clé — refusée, jamais complétée.
    PaireEnvPartielle,
    /// Les clés ne se correspondent pas (privée ≠ publique déclarée).
    ClefsInvalides {
        raison: String,
    },
}

impl StorePush {
    /// Un store vide — le point de départ de toute installation neuve.
    #[must_use]
    pub fn vide() -> Self {
        Self {
            subscriptions: Vec::new(),
            vapid_keys: None,
        }
    }
}

/// Lit le store — un fichier ABSENT est un store vide (installation neuve) ;
/// un fichier illisible ou malformé est une ERREUR visible, jamais une
/// régénération silencieuse des clés (T044).
pub fn lit_store(chemin: &Path) -> Result<StorePush, ErreurStore> {
    let brut = match std::fs::read(chemin) {
        Ok(brut) => brut,
        Err(erreur) if erreur.kind() == io::ErrorKind::NotFound => return Ok(StorePush::vide()),
        Err(erreur) => {
            return Err(ErreurStore::Illisible {
                chemin: chemin.to_path_buf(),
                cause: erreur.to_string(),
            });
        }
    };
    serde_json::from_slice(&brut).map_err(|cause| ErreurStore::Illisible {
        chemin: chemin.to_path_buf(),
        cause: cause.to_string(),
    })
}

/// Écrit le store de façon atomique — temp + flush + rename, 0700/0600.
pub fn ecrit_store(chemin: &Path, store: &StorePush) -> Result<(), ErreurStore> {
    let mut contenu = serde_json::to_vec_pretty(store).map_err(|cause| ErreurStore::Ecriture {
        chemin: chemin.to_path_buf(),
        cause: cause.to_string(),
    })?;
    contenu.push(b'\n');
    ecrit_atomique(chemin, &contenu).map_err(|cause| ErreurStore::Ecriture {
        chemin: chemin.to_path_buf(),
        cause: cause.to_string(),
    })
}

/// Le gardien du store : l'écrivain sérialisé (E08) et la résolution des
/// clés (env > store > génération persistée). Les opérations réseau ne
/// passent jamais par lui.
pub struct GardienDeStore {
    chemin: PathBuf,
    ecrivain: Mutex<()>,
    clefs_env: Option<ClefsVapid>,
}

impl GardienDeStore {
    /// Le gardien sur un chemin et une paire env (déjà validée par
    /// [`ClefsVapid::depuis_env`]).
    #[must_use]
    pub fn nouveau(chemin: PathBuf, clefs_env: Option<ClefsVapid>) -> Self {
        Self {
            chemin,
            ecrivain: Mutex::new(()),
            clefs_env,
        }
    }

    /// La clé publique à exposer aux navigateurs.
    pub fn cle_publique(&self) -> Result<String, ErreurStore> {
        Ok(self.clefs()?.public_key)
    }

    /// Les clés VAPID : l'environnement d'abord, le store ensuite, la
    /// génération (persistée) en dernier — jamais de régénération en
    /// silence sur un store corrompu.
    pub fn clefs(&self) -> Result<ClefsVapid, ErreurStore> {
        let _garde = self.ecrivain.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(env) = &self.clefs_env {
            return Ok(env.clone());
        }
        let mut store = lit_store(&self.chemin)?;
        if let Some(clefs) = &store.vapid_keys {
            // Une paire du store doit être cohérente — un mélange est une
            // erreur visible, pas une régénération silencieuse.
            clefs.verifie_equivalence()?;
            return Ok(clefs.clone());
        }
        let generees = vapid::genere_clefs_vapid();
        store.vapid_keys = Some(generees.clone());
        ecrit_store(&self.chemin, &store)?;
        Ok(generees)
    }

    /// Les abonnements courants — une photo, sans écrire.
    pub fn abonnements(&self) -> Result<Vec<AbonnementPush>, ErreurStore> {
        let _garde = self.ecrivain.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(lit_store(&self.chemin)?.subscriptions)
    }

    /// Abonne — remplace un abonnement de MÊME endpoint (E08 : upsert par
    /// endpoint), jamais un doublon.
    pub fn abonne(&self, abonnement: &AbonnementPush) -> Result<(), ErreurStore> {
        self.modifie(|store| {
            store
                .subscriptions
                .retain(|existant| existant.endpoint != abonnement.endpoint);
            store.subscriptions.push(abonnement.clone());
        })
    }

    /// Désabonne par endpoint — sans effet si l'endpoint est inconnu.
    pub fn desabonne(&self, endpoint: &str) -> Result<(), ErreurStore> {
        self.modifie(|store| {
            store
                .subscriptions
                .retain(|existant| existant.endpoint != endpoint);
        })
    }

    /// L'élagage VERSIONNÉ (C14) : ne retire un endpoint que si l'abonnement
    /// COURANT est exactement celui qui a expiré (mêmes clés) — un
    /// réabonnement pendant l'envoi a une nouvelle version, il survit.
    /// Rend le nombre d'abonnements retirés.
    pub fn elague_versionne(&self, expires: &[AbonnementPush]) -> Result<usize, ErreurStore> {
        let _garde = self.ecrivain.lock().unwrap_or_else(PoisonError::into_inner);
        let mut store = lit_store(&self.chemin)?;
        let avant = store.subscriptions.len();
        store.subscriptions.retain(|courant| {
            !expires
                .iter()
                .any(|expire| expire.endpoint == courant.endpoint && expire.keys == courant.keys)
        });
        let apres = store.subscriptions.len();
        if avant != apres {
            ecrit_store(&self.chemin, &store)?;
        }
        Ok(avant - apres)
    }

    /// Une lecture-modification-écriture sous la porte de l'écrivain.
    fn modifie(&self, operation: impl FnOnce(&mut StorePush)) -> Result<(), ErreurStore> {
        let _garde = self.ecrivain.lock().unwrap_or_else(PoisonError::into_inner);
        let mut store = lit_store(&self.chemin)?;
        operation(&mut store);
        ecrit_store(&self.chemin, &store)
    }
}

/// Rapatrie le store ENTIER (abonnements ET clés VAPID) depuis l'ancien
/// chemin — les abonnements sont liés à la clé publique qui les a créés :
/// recopier les seuls abonnements sur un store régénéré les rendrait
/// invalides, en silence.
///
/// On ne rapatrie que si le nouveau store est absent ou VIDE : un store
/// déjà peuplé est la vérité, on n'y touche pas. Rend l'ancien chemin si le
/// rapatriement a eu lieu, sinon `None`.
///
/// ⚠️ Divergence volontaire : un NOUVEAU store malformé est une ERREUR
/// visible (le fil le traitait comme « non peuplé » et l'écrasait en
/// silence — jamais une régénération silencieuse).
pub fn rapatrie_store(nouveau: &Path, ancien: &Path) -> Result<Option<PathBuf>, ErreurStore> {
    if nouveau == ancien {
        return Ok(None);
    }
    let ancien_store = match lit_store(ancien) {
        Ok(store) => store,
        // Pas d'ancien store, ou illisible : rien à rapatrier — ce n'est
        // pas une panne, c'est le cas de toute installation neuve.
        Err(ErreurStore::Illisible { .. }) => return Ok(None),
        Err(autre) => return Err(autre),
    };
    if ancien_store.subscriptions.is_empty() {
        return Ok(None);
    }
    let nouveau_store = lit_store(nouveau)?;
    if !nouveau_store.subscriptions.is_empty() {
        return Ok(None);
    }
    ecrit_store(nouveau, &ancien_store)?;
    Ok(Some(ancien.to_path_buf()))
}
