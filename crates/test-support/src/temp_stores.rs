//! Magasins **jetables** : une racine temporaire nettoyée à la dernière main,
//! des fichiers JSONL et SQLite créés dedans.
//!
//! ⚠️ **Rien ne touche le HOME, ni aucun chemin du monde réel.** La racine
//! est créée **sous [`std::env::temp_dir`]**, à un nom unique (préfixe +
//! pid + nonce). Le nettoyage arrive quand **le dernier consommateur**
//! lâche la racine (`Arc`) — un test qui garde un chemin ne voit pas ses
//! fichiers disparaître avant lui.
//!
//! ⚠️ Le nettoyage par `Drop` est au mieux (drop ne peut pas remonter une
//! erreur) ; la méthode explicite [`RacineJetable::detruit`] permet de
//! **prouver** le nettoyage dans un test, en retournant l'erreur réelle.

use rusqlite::Connection;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Une arborescence temporaire, détruite quand chacun l'a lâchée.
#[derive(Debug)]
pub struct RacineJetable {
    chemin: PathBuf,
    detruite: bool,
}

impl RacineJetable {
    /// Crée `temp_dir/{prefix}-{pid}-{nonce}` par création exclusive (le
    /// nonce pique jusqu'à trouver un libre). L'échec est rapporté, jamais
    /// réécrit en succès.
    pub fn nouveau(prefix: &str) -> io::Result<Self> {
        let base = std::env::temp_dir();
        let pid = std::process::id();
        for nonce in 0..4_096_u32 {
            let chemin = base.join(format!("{prefix}-{pid}-{nonce}"));
            match fs::create_dir(&chemin) {
                Ok(()) => {
                    return Ok(Self {
                        chemin,
                        detruite: false,
                    });
                }
                Err(cause) if cause.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(cause) => return Err(cause),
            }
        }
        Err(io::Error::other(format!(
            "aucun emplacement temporaire libre pour {prefix}"
        )))
    }

    #[must_use]
    pub fn chemin(&self) -> &Path {
        &self.chemin
    }

    /// La racine est-elle bien sous le tmpdir du système et **pas** sous le
    /// HOME ? Invariant d'isolation, testé.
    #[must_use]
    pub fn sous_le_tmpdir(&self) -> bool {
        self.chemin.starts_with(std::env::temp_dir())
    }

    /// Partage la racine entre plusieurs magasins : le nettoyage attend la
    /// dernière main.
    #[must_use]
    pub fn partage(self) -> Arc<Self> {
        Arc::new(self)
    }

    /// Destruction **prouvable** : retourne l'erreur réelle au lieu de la
    /// cacher. Idempotent (une deuxième destruction est un succès sans
    /// effet).
    pub fn detruit(&mut self) -> io::Result<()> {
        if self.detruite {
            return Ok(());
        }
        let resultat = fs::remove_dir_all(&self.chemin);
        self.detruite = resultat.is_ok();
        resultat
    }

    fn nettoie_au_mieux(&mut self) {
        if self.detruite {
            return;
        }
        // Drop ne peut pas remonter une erreur : on essaie, on note, et on
        // ne masque pas le reste — les tests qui exigent une preuve
        // appellent `detruit`.
        self.detruite = fs::remove_dir_all(&self.chemin).is_ok();
    }
}

impl Drop for RacineJetable {
    fn drop(&mut self) {
        self.nettoie_au_mieux();
    }
}

/// Un JSONL jetable : créé vide ou rempli, appends possibles ligne à ligne.
///
/// ⚠️ Le contenu de chaque ligne est **celui que le test a écrit** — aucun
/// façonneur ne le reprend. Une ligne multi-lignes est renvoyée telle quelle
/// (un JSONL malemphasis est une donnée de test valable, pas corrigée).
#[derive(Debug)]
pub struct MagasinJsonl {
    racine: Arc<RacineJetable>,
    chemin: PathBuf,
}

impl MagasinJsonl {
    /// Crée un fichier `.jsonl` sous la racine (dossiers intermédiaires
    /// compris). Le relatif sert de nommage — la racine borne l'espace.
    pub fn nouveau(racine: &Arc<RacineJetable>, relatif: &str) -> io::Result<Self> {
        let chemin = racine.chemin().join(relatif);
        if let Some(parent) = chemin.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::File::create(&chemin)?;
        Ok(Self {
            racine: racine.clone(),
            chemin,
        })
    }

    #[must_use]
    pub fn chemin(&self) -> &Path {
        &self.chemin
    }

    /// La racine partagée qui porte le magasin — le consommateur peut
    /// prouver l'isolation (chemin sous tmpdir) avant d'écrire.
    #[must_use]
    pub fn racine(&self) -> &Arc<RacineJetable> {
        &self.racine
    }

    /// Ajoute chaque fragment suivi d'un saut de ligne, **verbatim**. Une
    /// ligne vide est une donnée de test légitime (les lecteurs T023
    /// trancheront son sort) : elle est écrite telle quelle, pas corrigée.
    pub fn ajoute_lignes(&self, lignes: &[&str]) -> io::Result<()> {
        use std::io::Write;
        let mut fichier = fs::OpenOptions::new().append(true).open(&self.chemin)?;
        for ligne in lignes {
            writeln!(fichier, "{ligne}")?;
        }
        fichier.flush()?;
        Ok(())
    }

    /// Le chemin sous forme de chaîne — pour les références/clés de sessions.
    #[must_use]
    pub fn en_str(&self) -> String {
        self.chemin.to_string_lossy().to_string()
    }
}

/// Un SQLite jetable, bâti avec la même librairie (bundled) que les
/// lecteurs à venir : le fichier est le vrai, pas une approximation.
#[derive(Debug)]
pub struct MagasinSqlite {
    racine: Arc<RacineJetable>,
    chemin: PathBuf,
}

impl MagasinSqlite {
    /// Crée le fichier SQLite (fichier vide tant qu'aucun schéma n'est
    /// exécuté). Les dossiers intermédiaires sont créés, comme pour le JSONL.
    pub fn nouveau(racine: &Arc<RacineJetable>, relatif: &str) -> io::Result<Self> {
        let chemin = racine.chemin().join(relatif);
        if let Some(parent) = chemin.parent() {
            fs::create_dir_all(parent)?;
        }
        let conn =
            Connection::open(&chemin).map_err(|cause| io::Error::other(cause.to_string()))?;
        drop(conn);
        Ok(Self {
            racine: racine.clone(),
            chemin,
        })
    }

    #[must_use]
    pub fn chemin(&self) -> &Path {
        &self.chemin
    }

    /// La racine partagée qui porte le magasin — pour prouver l'isolation.
    #[must_use]
    pub fn racine(&self) -> &Arc<RacineJetable> {
        &self.racine
    }

    /// Exécute un script SQL (schéma, insertion, transactions) — l'erreur
    /// rusqlite est retournée telle quelle.
    pub fn execute(&self, sql: &str) -> Result<(), rusqlite::Error> {
        let conn = Connection::open(&self.chemin)?;
        conn.execute_batch(sql)
    }

    /// Ouvre une connexion en lecture — pour le prochain consommateur qui
    /// veut vérifier ce qu'il vient de bâtir.
    pub fn connexion(&self) -> Result<Connection, rusqlite::Error> {
        Connection::open(&self.chemin)
    }

    #[must_use]
    pub fn en_str(&self) -> String {
        self.chemin.to_string_lossy().to_string()
    }
}
