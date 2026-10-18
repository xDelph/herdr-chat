//! Le moteur SQLite **commun** (T015) : un ouvrier dédié par base, connexion
//! **read-only**, paramètres liés, délai de 3 secondes, file de 32 travaux,
//! interruption et pagination configurable.
//!
//! ⚠️ **Aucune écriture, jamais** : la connexion s'ouvre en `READ_ONLY` — ni
//! base, ni WAL, ni schéma ne bougent (politique read-only de `sessions`).
//! Les schémas des familles sont **leurs** affaires : le moteur n'exécute que
//! le SQL qu'on lui donne, avec des paramètres **liés** (jamais interpolés).
//!
//! ⚠️ **Le runtime n'est jamais bloqué par SQLite** : les requêtes tournent
//! sur le fil de l'ouvrier ; l'appelant dépose un travail (file bornée à 32 —
//! au-delà, refus nommé, pas de file infinie) et attend la réponse ; déposer
//! depuis un exécuteur asynchrone passera par `spawn_blocking` (T021+).

use rusqlite::OpenFlags;
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::thread;
use std::time::Duration;

/// Le délai d'occupation SQLite — 3 s, mesuré (T015).
pub const DELAI_OCCUPATION: Duration = Duration::from_secs(3);

/// La capacité de la file de travaux — 32, mesuré (T015).
pub const FILE_MAX: usize = 32;

/// Une ligne rendue : les valeurs par position, avec les noms de colonnes.
#[derive(Clone, PartialEq, Debug)]
pub struct Ligne {
    pub colonnes: Vec<String>,
    pub valeurs: Vec<serde_json::Value>,
}

/// Un travail : SQL paramétré, réponse attendue sur le canal.
struct Travail {
    requete: String,
    params: Vec<String>,
    reponse: SyncSender<Result<Vec<Ligne>, String>>,
}

/// L'ouvrier : un fil dédié, une connexion read-only, la file de travaux.
pub struct Ouvrier {
    depot: SyncSender<Travail>,
    interruption: Arc<rusqlite::InterruptHandle>,
}

/// L'erreur d'un travail — le SQL a échoué, la file est pleine, ou l'ouvrier
/// est parti.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurOuvrier {
    /// La requête (ou le décodage) a échoué — la cause réelle, telle quelle.
    Requete(String),
    /// La file de 32 travaux est pleine : refus nommé (surcharge).
    FilePleine,
    /// L'ouvrier ne répond plus (fermeture en cours).
    OuvrierAbsent,
}

impl Ouvrier {
    /// Ouvre la base en **read-only** et démarre l'ouvrier — l'ouverture
    /// elle-même peut échouer (fichier absent/corrompu) : la cause réelle
    /// remonte.
    pub fn nouveau(chemin: &Path) -> Result<Self, String> {
        let connexion =
            rusqlite::Connection::open_with_flags(chemin, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|cause| cause.to_string())?;
        connexion
            .busy_timeout(DELAI_OCCUPATION)
            .map_err(|cause| cause.to_string())?;
        let interruption = Arc::new(connexion.get_interrupt_handle());
        let (depot, attente): (SyncSender<Travail>, Receiver<Travail>) = sync_channel(FILE_MAX);
        thread::spawn(move || {
            for travail in attente.iter() {
                let reponse = execute(&connexion, &travail.requete, &travail.params);
                let _ = travail.reponse.send(reponse);
            }
        });
        Ok(Self {
            depot,
            interruption,
        })
    }

    /// Dépose un travail **sans attendre** la réponse — le canal rendu la
    /// portera ; la file bornée refuse nommément au-delà de 32.
    pub fn depose(
        &self,
        requete: &str,
        params: &[&str],
    ) -> Result<std::sync::mpsc::Receiver<Result<Vec<Ligne>, String>>, ErreurOuvrier> {
        let (retour, reception) = sync_channel(1);
        let travail = Travail {
            requete: requete.to_string(),
            params: params.iter().map(|p| (*p).to_string()).collect(),
            reponse: retour,
        };
        match self.depot.try_send(travail) {
            Ok(()) => Ok(reception),
            Err(TrySendError::Full(_)) => Err(ErreurOuvrier::FilePleine),
            Err(TrySendError::Disconnected(_)) => Err(ErreurOuvrier::OuvrierAbsent),
        }
    }

    /// Interroge la base — SQL verbatim, paramètres **liés**, réponse
    /// attendue sur le canal de retour.
    pub fn interroge(&self, requete: &str, params: &[&str]) -> Result<Vec<Ligne>, ErreurOuvrier> {
        let reception = self.depose(requete, params)?;
        match reception.recv() {
            Ok(reponse) => reponse.map_err(ErreurOuvrier::Requete),
            Err(_) => Err(ErreurOuvrier::OuvrierAbsent),
        }
    }

    /// Interrompt une requête en cours (une autre unité de travail décide —
    /// le délai applicatif, la fermeture) : le `InterruptHandle` de rusqlite,
    /// partageable.
    #[must_use]
    pub fn poignee_interruption(&self) -> Arc<rusqlite::InterruptHandle> {
        Arc::clone(&self.interruption)
    }
}

fn execute(
    connexion: &rusqlite::Connection,
    requete: &str,
    params: &[String],
) -> Result<Vec<Ligne>, String> {
    let mut prepare = connexion
        .prepare(requete)
        .map_err(|cause| cause.to_string())?;
    let noms_colonnes: Vec<String> = prepare
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();
    let noms = noms_colonnes.clone();
    let lignes = prepare
        .query_map(rusqlite::params_from_iter(params.iter()), |rangee| {
            let mut valeurs = Vec::with_capacity(noms.len());
            for (position, nom) in noms.iter().enumerate() {
                let _ = nom; // la colonne se lit par position — le nom est porté à part
                valeurs.push(rangee_valeur(rangee, position)?);
            }
            Ok(Ligne {
                colonnes: noms.clone(),
                valeurs,
            })
        })
        .map_err(|cause| cause.to_string())?;
    let mut rendus = Vec::new();
    for ligne in lignes {
        rendus.push(ligne.map_err(|cause| cause.to_string())?);
    }
    Ok(rendus)
}

fn rangee_valeur(
    rangee: &rusqlite::Row<'_>,
    position: usize,
) -> Result<serde_json::Value, rusqlite::Error> {
    let valeur: rusqlite::types::Value = rangee.get(position)?;
    Ok(match valeur {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(entier) => serde_json::Value::from(entier),
        rusqlite::types::Value::Real(reel) => serde_json::Value::from(reel),
        rusqlite::types::Value::Text(texte) => serde_json::Value::from(texte),
        rusqlite::types::Value::Blob(blob) => {
            // Un blob est rendu en tableau d'octets — jamais en chaîne
            // déguisée.
            serde_json::Value::from(blob)
        }
    })
}
