//! Le journal d'erreurs du démon (T055, S10–S13) — l'I/O de la politique
//! écrite dans `application::diagnostics`.
//!
//! ⚠️ **Un journal ne casse jamais le service.** Toute panne d'écriture part
//! sur `stderr` et s'arrête là : l'action qui a produit l'entrée a déjà eu
//! lieu, et un disque plein ne doit pas transformer un envoi réussi en échec.
//!
//! ⚠️ **Le chemin est injecté** (jamais une constante globale) : un test qui
//! écrivait dans le journal de l'utilisateur est exactement le défaut A03
//! qu'on ne reproduit pas. Le démon choisit `~/.herdr-remote/herdr-remote.log`.
//!
//! ⚠️ **Borné en taille** (4 MiB) : une génération précédente est gardée
//! (`.1`), la plus ancienne est écrasée. Un journal ne remplit pas le disque.

use application::diagnostics::{
    EntreeDiagnostic, FENETRE_REPETITION_MS, MemoireAntiRepetition, SinkDiagnostic, ligne_de,
    tronque,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Au-delà, le fichier courant devient `.1` — la valeur du fil (S12).
pub const MAX_OCTETS: u64 = 4 * 1024 * 1024;

/// Le journal : un chemin, l'anti-répétition et une horloge injectable.
pub struct Journal {
    chemin: PathBuf,
    anti: MemoireAntiRepetition,
    /// L'horloge en millisecondes depuis l'époque — injectable pour les tests
    /// de fenêtre (aucun test n'attend 60 s).
    horloge: Box<dyn Fn() -> u64 + Send + Sync>,
    /// Le nombre d'écritures réellement faites — la vérification des tests.
    ecrites: AtomicU64,
    /// Le nombre d'entrées supprimées par l'anti-répétition.
    supprimees: AtomicU64,
}

impl Journal {
    /// Le journal de production, à côté des données de l'instance.
    #[must_use]
    pub fn nouveau(chemin: impl Into<PathBuf>) -> Self {
        Self {
            chemin: chemin.into(),
            anti: MemoireAntiRepetition::default(),
            horloge: Box::new(maintenant_ms),
            ecrites: AtomicU64::new(0),
            supprimees: AtomicU64::new(0),
        }
    }

    /// Le même journal avec une horloge contrôlée — la fenêtre se teste sans
    /// dormir.
    #[must_use]
    pub fn avec_horloge(
        chemin: impl Into<PathBuf>,
        horloge: Box<dyn Fn() -> u64 + Send + Sync>,
    ) -> Self {
        Self {
            chemin: chemin.into(),
            anti: MemoireAntiRepetition::default(),
            horloge,
            ecrites: AtomicU64::new(0),
            supprimees: AtomicU64::new(0),
        }
    }

    /// Le chemin du journal — celui que H01 publie (`log`).
    #[must_use]
    pub fn chemin(&self) -> &Path {
        &self.chemin
    }

    /// Le nombre d'écritures faites (les entrées supprimées ne comptent pas).
    #[must_use]
    pub fn ecrites(&self) -> u64 {
        self.ecrites.load(Ordering::SeqCst)
    }

    /// Le nombre d'entrées supprimées par l'anti-répétition.
    #[must_use]
    pub fn supprimees(&self) -> u64 {
        self.supprimees.load(Ordering::SeqCst)
    }

    /// Écrit une entrée — et **ne rend rien** : l'échec va sur `stderr`.
    ///
    /// ⚠️ `faut_ecrire` est calculé AVANT l'écriture : une entrée supprimée
    /// n'a pas à créer le fichier ni à tenter une rotation.
    pub fn ecrit(&self, entree: &EntreeDiagnostic) {
        let maintenant = (self.horloge)();
        let cle = entree.cle(&self.chemin.display().to_string());
        let Some(repetitions) = self.anti.autorise(
            &self.chemin.display().to_string(),
            &cle,
            maintenant,
            FENETRE_REPETITION_MS,
        ) else {
            self.supprimees.fetch_add(1, Ordering::SeqCst);
            return;
        };
        // Les répétitions supprimées sont ANNONCÉES avec l'écriture suivante :
        // un journal qui cache 300 occurrences sans le dire mentirait sur la
        // fréquence.
        let mut entree = entree.clone();
        if repetitions > 0 {
            let note = format!("({repetitions} repetitions supprimees)");
            entree.message = format!("{} — {note}", entree.message);
        }
        if let Err(cause) = self.ecrit_vraiment(&entree) {
            // Jamais de propagation : le service continue, et la cause reste
            // lisible sur la sortie d'erreur du processus.
            eprintln!("journal indisponible ({}): {cause}", self.chemin.display());
            return;
        }
        self.ecrites.fetch_add(1, Ordering::SeqCst);
    }

    /// L'écriture elle-même : dossier, rotation, ajout.
    fn ecrit_vraiment(&self, entree: &EntreeDiagnostic) -> std::io::Result<()> {
        if let Some(parent) = self.chemin.parent() {
            std::fs::create_dir_all(parent)?;
            // Le dossier des données d'une instance est privé (0700).
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
            }
        }
        self.rotationsi_necessaire()?;
        let mut fichier = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.chemin)?;
        // Le fichier aussi est privé (0600) : il contient des chemins de
        // l'utilisateur et des causes d'erreur.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fichier.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
        let ligne = ligne_de(entree, (self.horloge)());
        fichier.write_all(ligne.as_bytes())?;
        fichier.flush()
    }

    /// Rotation : au-delà de 4 MiB, le courant devient `.1`.
    fn rotationsi_necessaire(&self) -> std::io::Result<()> {
        let taille = match std::fs::metadata(&self.chemin) {
            Ok(meta) => meta.len(),
            // Fichier absent : rien à faire, ce n'est pas une panne.
            Err(_) => return Ok(()),
        };
        if taille > MAX_OCTETS {
            let ancien = PathBuf::from(format!("{}.1", self.chemin.display()));
            // Un `.1` existant est écrasé : on garde UNE génération, pas une
            // archive illimitée.
            let _ = std::fs::remove_file(&ancien);
            std::fs::rename(&self.chemin, &ancien)?;
        }
        Ok(())
    }
}

impl SinkDiagnostic for Journal {
    fn ecrit(&self, entree: &EntreeDiagnostic) {
        Self::ecrit(self, entree);
    }
}

/// Le journal par défaut : `~/.herdr-remote/herdr-remote.log` — à côté des
/// données de l'instance, jamais dans le dossier courant (A03).
#[must_use]
pub fn journal_par_defaut(dossier_maison: &str) -> PathBuf {
    PathBuf::from(dossier_maison)
        .join(".herdr-remote")
        .join("herdr-remote.log")
}

/// L'instant courant en millisecondes depuis l'époque — la seule lecture
/// d'horloge du module, et elle est injectable.
#[must_use]
pub fn maintenant_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duree| u64::try_from(duree.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Le message d'erreur d'un détail trop long — la troncature reste la règle
/// de `application::diagnostics`, jamais une seconde ici.
#[must_use]
pub fn detail_borne(detail: &str) -> String {
    tronque(detail, application::diagnostics::DETAIL_MAX)
}
