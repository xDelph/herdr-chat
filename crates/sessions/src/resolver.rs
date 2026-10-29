//! Le résolveur partagé (T023/C15) — **le seul point de décision** : overview,
//! liste et session passent tous par ici (deux résolutions parallèles avaient
//! déjà produit deux réponses différentes — D013).
//!
//! ⚠️ **Les racines sont injectées** (config de démarrage) : aucune fonction
//! de ce module ne lit l'environnement (TECH §6) — les tests n'écrivent jamais
//! dans les vrais dossiers de la machine.
//!
//! ⚠️ **Les bases d'index codex portent une version NUMÉRIQUE**
//! (`state_5.sqlite`) : coder le numéro ferait taire l'index le jour où codex
//! le change ; le tri est **numérique et décroissant** — `state_10` bat
//! `state_9` (le tri lexicographique du fil inversait les deux : la régression
//! d19f98d, corrigée ici).
//!
//! ⚠️ **Le cache positif/négatif s'invalide par la base elle-même** : la
//! validité d'une entrée (trouvée OU pas trouvée) est le couple
//! (mtime, taille) de chaque base d'index ET de son `-wal` — l'ajout d'une
//! session change l'un des deux, donc un cache négatif s'invalide et la
//! nouvelle session est **visible**.

use crate::storage::sqlite::worker::Ouvrier;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// Où vit la session d'un agent — ⚠️ **deux magasins, pas deux capacités** :
/// pi/codex/claude écrivent un FICHIER ; opencode/devin écrivent une base
/// SQLite et désignent une session par sa **clé primaire**. La distinction est
/// une question de forme — elle décide COMMENT lire, jamais SI on peut lire.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum SourceSession {
    Fichier {
        base: PathBuf,
    },
    Sqlite {
        base: PathBuf,
        session_id: String,
        magasin: Magasin,
    },
}

/// Quel magasin SQLite — deux agents, deux bases, deux schémas, une seule
/// forme de page en sortie.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Magasin {
    Opencode,
    Devin,
}

/// Le référentiel dans lequel Herdr désigne la session (`kind: "path"|"id"`).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Emplacement {
    pub kind: String,
    pub value: String,
}

impl Emplacement {
    #[must_use]
    pub fn nouveau(kind: &str, value: &str) -> Self {
        Self {
            kind: kind.to_string(),
            value: value.to_string(),
        }
    }
}

/// Les racines injectées du résolveur.
#[derive(Clone, Debug)]
pub struct Racines {
    /// `PI_SESSIONS_ROOT` — Herdr publie le chemin des sessions Pi ; la
    /// racine sert au garde de lecture (S03), jamais à chercher.
    pub pi_sessions: PathBuf,
    /// `CODEX_SESSION_ROOT` — les fichiers `rollout-*-{id}.jsonl`.
    pub codex_sessions: PathBuf,
    /// `CODEX_HOME` — les bases d'index `state_*.sqlite`.
    pub codex_home: PathBuf,
    /// `CLAUDE_PROJECTS_ROOT` — les fichiers `{id}.jsonl`.
    pub claude_projects: PathBuf,
    /// `OPENCODE_DB`.
    pub opencode_db: PathBuf,
    /// `DEVIN_DB`.
    pub devin_db: PathBuf,
}

struct EntreeCache {
    chemin: Option<PathBuf>,
    validite: Vec<(SystemTime, u64)>,
}

/// La validité du cache d'index codex : (mtime, taille) de **chaque base**
/// `state_N.sqlite` **et de son journal `-wal`**.
///
/// ⚠️ Elle lisait les métadonnées du **dossier** `CODEX_HOME` : l'insertion
/// d'une ligne dans une base ne change pas le mtime du dossier, et un fil pas
/// encore indexé restait « introuvable » en cache jusqu'à ce qu'un fichier
/// soit créé ou supprimé à côté. En mode WAL, la base principale ne bouge
/// qu'au checkpoint : c'est le `-wal` qui grandit.
fn validite_index_codex(codex_home: &Path) -> Vec<(SystemTime, u64)> {
    let mesure = |chemin: &Path| match fs::metadata(chemin) {
        Ok(meta) => (
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            meta.len(),
        ),
        Err(_) => (SystemTime::UNIX_EPOCH, 0),
    };
    bases_codex(codex_home)
        .iter()
        .flat_map(|base| {
            let mut wal = base.clone().into_os_string();
            wal.push("-wal");
            [mesure(base), mesure(Path::new(&wal))]
        })
        .collect()
}

/// Le résolveur — cache positif/négatif invalidable en mémoire.
pub struct Resolveur {
    pub racines: Racines,
    cache: Mutex<HashMap<(String, String), EntreeCache>>,
}

/// Les bases d'index codex, de la plus récente à la plus ancienne — tri
/// **numérique** de la version (la régression d19f98d : le tri lexicographique
/// plaçait `state_9` devant `state_10`).
#[must_use]
pub fn bases_codex(dossier_codex: &Path) -> Vec<PathBuf> {
    let entrees = match fs::read_dir(dossier_codex) {
        Ok(entrees) => entrees,
        // Une base absente ne rend simplement rien.
        Err(_) => return Vec::new(),
    };
    let mut versionnees: Vec<(u64, PathBuf)> = entrees
        .filter_map(|entree| entree.ok())
        .filter_map(|entree| {
            let nom = entree.file_name().into_string().ok()?;
            if !nom.starts_with("state_") || !nom.ends_with(".sqlite") {
                return None;
            }
            let version: u64 = nom
                .strip_prefix("state_")?
                .strip_suffix(".sqlite")?
                .parse()
                .ok()?;
            Some((version, entree.path()))
        })
        .collect();
    versionnees.sort_by(|a, b| b.0.cmp(&a.0));
    versionnees.into_iter().map(|(_, chemin)| chemin).collect()
}

/// Les noms de session codex, lus dans le titre du pane — ⚠️ **mesuré** :
/// codex met `<nom du fil> | <dossier>` en titre, et le titre porte un
/// **glyphe d'état quand codex travaille** (`⠼ Audit PWA and webapp |
/// herdr-pwa`). On ne « nettoie » pas au jugé : on rend la lecture **brute**
/// ET la lecture sans décoration, et c'est l'index qui tranche — un nom qui
/// commence vraiment par un glyphe reste trouvable, et un faux nettoyage ne
/// peut pas produire une session (il produit un nom que l'index ignore).
#[must_use]
pub fn noms_de_session_codex(titre: Option<&str>, cwd: Option<&str>) -> Vec<String> {
    let (titre, cwd) = match (titre, cwd) {
        (Some(titre), Some(cwd)) if !cwd.is_empty() => (titre, cwd),
        _ => return Vec::new(),
    };
    let barre = match titre.rfind(" | ") {
        Some(barre) if barre > 0 => barre,
        _ => return Vec::new(),
    };
    let prefixe = titre[..barre].trim();
    if prefixe.is_empty() {
        return Vec::new();
    }
    let dossier = titre[barre + 3..].trim();
    let dernier_segment = cwd.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    if dossier != dernier_segment {
        return Vec::new();
    }
    // La lecture sans décoration : les premiers caractères non lettre/non
    // chiffre + espace tombent (le glyphe du spinner).
    let sans_decoration: String = {
        let mut reste = prefixe;
        while let Some(caractere) = reste.chars().next() {
            if caractere.is_alphanumeric() {
                break;
            }
            reste = reste[caractere.len_utf8()..].trim_start();
            if reste.len() < prefixe.len() {
                break; // après TRIM, on attend l'espace qui séparait la décoration
            }
        }
        // La règle du fil : `^[^\p{L}\p{N}]+\s+` — une suite de non-lettres
        // NON suivie d'un espace ne compte pas comme décoration.
        match prefixe.find(' ') {
            Some(coupure)
                if !prefixe[..coupure]
                    .chars()
                    .next()
                    .is_some_and(char::is_alphanumeric) =>
            {
                prefixe[coupure + 1..].trim().to_string()
            }
            _ => String::new(),
        }
    };
    if !sans_decoration.is_empty() && sans_decoration != prefixe {
        vec![prefixe.to_string(), sans_decoration]
    } else {
        vec![prefixe.to_string()]
    }
}

/// Le nom de session codex « simple » — le **premier** candidat : la lecture
/// brute, celle qui ne suppose rien.
#[must_use]
pub fn nom_de_session_codex(titre: Option<&str>, cwd: Option<&str>) -> Option<String> {
    noms_de_session_codex(titre, cwd).into_iter().next()
}

/// Parcours récursif borné — l'homologue des `globSync` du fil, sans
/// dépendance : les fichiers dont le NOM passe la garde, triés.
fn parcours(racine: &Path, garde: &impl Fn(&str) -> bool, sortie: &mut Vec<PathBuf>) {
    let entrees = match fs::read_dir(racine) {
        Ok(entrees) => entrees,
        Err(_) => return,
    };
    for entree in entrees.filter_map(|entree| entree.ok()) {
        let chemin = entree.path();
        if chemin.is_dir() {
            parcours(&chemin, garde, sortie);
        } else if garde(&entree.file_name().into_string().unwrap_or_default()) {
            sortie.push(chemin);
        }
    }
}

/// Résout un identifiant codex en chemin de fichier — l'identifiant est
/// cherché dans le **NOM** du fichier (la disposition de codex), motif ancré
/// sur `rollout-` et le séparateur qui précède : un identifiant ne peut pas
/// se faire passer pour le préfixe d'un autre. Un identifiant vide rendrait
/// « n'importe quel rollout » : refusé.
#[must_use]
pub fn chemin_codex_par_id(racines: &Racines, id: &str) -> Option<PathBuf> {
    if id.trim().is_empty() {
        return None;
    }
    let suffixe = format!("-{id}.jsonl");
    let mut trouves: Vec<PathBuf> = Vec::new();
    let garde = |nom: &str| nom.starts_with("rollout-") && nom.ends_with(&suffixe);
    parcours(&racines.codex_sessions, &garde, &mut trouves);
    trouves.sort();
    trouves.into_iter().next()
}

/// Résout un identifiant claude en chemin — cherché dans le nom du fichier
/// (le dossier intermédiaire est le chemin de travail encodé, qui ne se
/// déduit pas d'un identifiant : on cherche, on ne compose pas).
#[must_use]
pub fn chemin_claude_par_id(racines: &Racines, id: &str) -> Option<PathBuf> {
    if id.trim().is_empty() {
        return None;
    }
    let suffixe = format!("{id}.jsonl");
    let mut trouves: Vec<PathBuf> = Vec::new();
    let garde = |nom: &str| nom.ends_with(&suffixe);
    parcours(&racines.claude_projects, &garde, &mut trouves);
    trouves.sort();
    trouves.into_iter().next()
}

/// Chemin du fichier de session codex, retrouvé par le **nom du fil** et le
/// dossier, dans l'index de codex — ⚠️ **trois garde-fous rendent la preuve
/// vérifiable** : le nom ET le dossier doivent correspondre, et le fichier
/// doit exister. Sans les trois : `None` — jamais la session d'un autre.
/// ⚠️ Le cache porte les résultats TROUVÉS comme NON TROUVÉS, invalidés par
/// la base elle-même : une session ajoutée devient visible.
#[must_use]
pub fn chemin_codex_par_nom(resolveur: &Resolveur, nom: &str, cwd: &str) -> Option<PathBuf> {
    if nom.trim().is_empty() || cwd.is_empty() {
        return None;
    }
    let cle = (nom.to_string(), cwd.to_string());
    let validite = validite_index_codex(&resolveur.racines.codex_home);
    if let Ok(cache) = resolveur.cache.lock()
        && let Some(entree) = cache.get(&cle)
        && entree.validite == validite
    {
        return entree.chemin.clone();
    }
    let mut chemin_trouve: Option<PathBuf> = None;
    for base in bases_codex(&resolveur.racines.codex_home) {
        let ouvrier = match Ouvrier::nouveau(&base) {
            Ok(ouvrier) => ouvrier,
            // Une base illisible/absente/inattendue ne PROUVE rien : on
            // essaie la suivante, puis on renonce. Jamais de substitution.
            Err(_) => continue,
        };
        let lignes = match ouvrier.interroge(
            "select rollout_path from threads where name = ?1 and cwd = ?2 and archived = 0 order by updated_at desc limit 1",
            &[nom, cwd],
        ) {
            Ok(lignes) => lignes,
            Err(_) => continue,
        };
        let chemin = lignes
            .first()
            .and_then(|ligne| ligne.valeurs.first())
            .and_then(Value::as_str)
            .map(PathBuf::from);
        if let Some(chemin) = chemin
            && chemin.exists()
        {
            chemin_trouve = Some(chemin);
            break;
        }
    }
    if let Ok(mut cache) = resolveur.cache.lock() {
        cache.insert(
            cle,
            EntreeCache {
                chemin: chemin_trouve.clone(),
                validite,
            },
        );
    }
    chemin_trouve
}

/// Emplacement de session d'un pane codex, déduit de son **titre** — `None`
/// dès que le titre ne nomme pas un fil, ou que l'index ne le confirme pas :
/// le pane garde son panneau neutre, ce qui est exact. ⚠️ On essaie chaque
/// lecture contre l'index, et c'est LUI qui tranche — la première confirmée
/// gagne, aucune autre n'est inventée.
#[must_use]
pub fn session_codex_par_titre(
    resolveur: &Resolveur,
    titre: Option<&str>,
    cwd: Option<&str>,
) -> Option<Emplacement> {
    let cwd = cwd?;
    for nom in noms_de_session_codex(titre, Some(cwd)) {
        if let Some(chemin) = chemin_codex_par_nom(resolveur, &nom, cwd) {
            return Some(Emplacement::nouveau("path", &chemin.to_string_lossy()));
        }
    }
    None
}

/// Source de la session d'un agent, ou `None` s'il n'y en a pas.
#[must_use]
pub fn source_session(
    resolveur: &Resolveur,
    agent_kind: Option<&str>,
    emplacement: Option<&Emplacement>,
) -> Option<SourceSession> {
    let emplacement = emplacement?;
    if emplacement.kind == "path" {
        return Some(SourceSession::Fichier {
            base: PathBuf::from(&emplacement.value),
        });
    }
    if emplacement.kind != "id" {
        return None;
    }
    match agent_kind {
        Some("codex") => {
            let chemin = chemin_codex_par_id(&resolveur.racines, &emplacement.value)?;
            Some(SourceSession::Fichier { base: chemin })
        }
        Some("opencode") => {
            // Un identifiant vide désignerait n'importe quoi : refusé.
            if emplacement.value.trim().is_empty() {
                return None;
            }
            Some(SourceSession::Sqlite {
                base: resolveur.racines.opencode_db.clone(),
                session_id: emplacement.value.clone(),
                magasin: Magasin::Opencode,
            })
        }
        Some("claude") => {
            let chemin = chemin_claude_par_id(&resolveur.racines, &emplacement.value)?;
            Some(SourceSession::Fichier { base: chemin })
        }
        Some("devin") => {
            if emplacement.value.trim().is_empty() {
                return None;
            }
            Some(SourceSession::Sqlite {
                base: resolveur.racines.devin_db.clone(),
                session_id: emplacement.value.clone(),
                magasin: Magasin::Devin,
            })
        }
        _ => None,
    }
}

/// L'emplacement de session d'un agent — ⚠️ **il empile deux questions, dans
/// cet ordre** : (1) Herdr a-t-il publié un emplacement ? Si oui, il fait
/// **foi**. (2) Sinon, et **seulement pour codex**, son titre nomme-t-il un
/// fil que son index confirme ? Le repli vit au même endroit que la
/// résolution ; les appelants ne font que le lire (D013).
#[must_use]
pub fn source_session_de(
    resolveur: &Resolveur,
    kind: Option<&str>,
    emplacement: Option<&Emplacement>,
    titre: Option<&str>,
    cwd: Option<&str>,
) -> Option<SourceSession> {
    let annonce = source_session(resolveur, kind, emplacement);
    if annonce.is_some() {
        return annonce;
    }
    if kind != Some("codex") {
        return None;
    }
    let repli = session_codex_par_titre(resolveur, titre, cwd)?;
    source_session(resolveur, kind, Some(&repli))
}

/// Le chemin de session d'un agent, ou `None` — ⚠️ un chemin n'existe que
/// pour un **fichier** : la base opencode n'est pas un chemin de session, et
/// la faire passer pour tel tromperait l'appelant.
#[must_use]
pub fn localise_session(
    resolveur: &Resolveur,
    kind: Option<&str>,
    emplacement: Option<&Emplacement>,
) -> Option<PathBuf> {
    match source_session(resolveur, kind, emplacement) {
        Some(SourceSession::Fichier { base }) => Some(base),
        _ => None,
    }
}

impl Resolveur {
    #[must_use]
    pub fn nouveau(racines: Racines) -> Self {
        Self {
            racines,
            cache: Mutex::new(HashMap::new()),
        }
    }
}
