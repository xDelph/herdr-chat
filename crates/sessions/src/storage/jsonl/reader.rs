//! Le lecteur JSONL (T014) : pages **avant** (suivre les appends) et
//! **arrière** (l'historique) — chaque page repart d'un curseur vérifié.

use crate::storage::jsonl::framing::{self, Cadre};
use crate::storage::jsonl::identity::{CurseurFichier, continuite, identite_de};
use std::fs;
use std::io;
use std::path::Path;

/// Une page **avant** : les nouveaux cadres complets, le curseur nouveau
/// (≤ octets consommés, toujours), et l'état de continuité.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PageAvant {
    pub cadres: Vec<Cadre>,
    pub curseur: CurseurFichier,
    /// `true` quand la continuité est rompue (rotation/troncature) : la page
    /// repart de zéro et le dit — jamais une suite silencieuse d'un autre
    /// fichier.
    pub reinitialisee: bool,
    /// `true` quand tout le fichier a été consommé (aucune ligne en attente
    /// laissée) — le « rattrapé » du fil (T025 le reprend).
    pub a_rattrape: bool,
}

/// Une page **arrière** (l'historique) : les cadres rendus, dans l'ordre de
/// lecture, et le curseur du **début de la première ligne rendue** — la
/// position où la page précédente recommence.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PageArriere {
    pub cadres: Vec<Cadre>,
    pub curseur: CurseurFichier,
}

fn ouvre(chemin: &Path) -> io::Result<fs::File> {
    fs::File::open(chemin)
}

/// Une page avant depuis le curseur — la continuité est vérifiée AVANT de
/// lire : rotation/troncature → page réinitialisée depuis zéro (le curseur
/// rendu porte la NOUVELLE identité).
pub fn page_avant(
    chemin: &Path,
    curseur: &CurseurFichier,
    cible_octets: usize,
) -> io::Result<PageAvant> {
    let mut fichier = ouvre(chemin)?;
    let mesuree = identite_de(chemin)?;
    if continuite(curseur, &mesuree) {
        let (cadres, nouvel_offset) =
            framing::cadres_depuis(&mut fichier, curseur.offset, cible_octets)?;
        let taille_reelle = mesuree.taille;
        Ok(PageAvant {
            a_rattrape: nouveau_offset_du_dernier(&cadres, curseur.offset) >= taille_reelle,
            cadres,
            curseur: CurseurFichier {
                dev: mesuree.curseur.dev,
                ino: mesuree.curseur.ino,
                offset: nouvel_offset,
            },
            reinitialisee: false,
        })
    } else {
        // Rotation ou troncature : repartir de zéro — et le DIRE.
        let (cadres, nouvel_offset) = framing::cadres_depuis(&mut fichier, 0, cible_octets)?;
        Ok(PageAvant {
            a_rattrape: nouvel_offset >= mesuree.taille,
            cadres,
            curseur: CurseurFichier {
                dev: mesuree.curseur.dev,
                ino: mesuree.curseur.ino,
                offset: nouvel_offset,
            },
            reinitialisee: true,
        })
    }
}

fn nouveau_offset_du_dernier(cadres: &[Cadre], defaut: u64) -> u64 {
    cadres
        .last()
        .map(|cadre| cadre.depart + cadre.consomme)
        .unwrap_or(defaut)
}

/// Une page **arrière** (l'historique) : les cadres complets dont la somme
/// consommée tient dans la cible, en remontant depuis `avant_offset` — le
/// curseur rendu est le début de la première ligne rendue (la position où
/// une page arrière précédente recommence).
pub fn page_arriere(
    chemin: &Path,
    curseur: &CurseurFichier,
    cible_octets: usize,
) -> io::Result<PageArriere> {
    let mut fichier = ouvre(chemin)?;
    let mesuree = identite_de(chemin)?;
    let identite_curseur = if continuite(curseur, &mesuree) {
        curseur.offset
    } else {
        mesuree.taille
    };
    let debut = identite_curseur.min(mesuree.taille);
    // ⚠️ **On lit À REBOURS, par fenêtre, jamais depuis l'octet 0.** La
    // version précédente relisait tout le fichier à chaque page d'historique :
    // un rollout de 200 Mo coûtait 200 Mo alloués par « charger plus ». La
    // fenêtre `[debut - cible, debut)` est alignée sur le premier début de
    // ligne qu'elle contient ; si aucune ligne complète n'y tient (une ligne
    // plus grande que la cible), la fenêtre double jusqu'au début du fichier.
    let mut fenetre = (cible_octets.max(1)) as u64;
    let rendus: Vec<Cadre> = loop {
        let depart_brut = debut.saturating_sub(fenetre);
        let depart = framing::prochain_debut_de_ligne(&mut fichier, depart_brut)?.min(debut);
        if depart < debut {
            let longueur = usize::try_from(debut - depart).unwrap_or(usize::MAX);
            let (cadres, _) = framing::cadres_depuis(&mut fichier, depart, longueur)?;
            break cadres
                .into_iter()
                .filter(|cadre| cadre.depart < debut)
                .collect();
        }
        if depart_brut == 0 {
            break Vec::new();
        }
        fenetre = fenetre.saturating_mul(2);
    };
    let nouveau_depart = rendus.first().map_or(debut, |cadre| cadre.depart);
    Ok(PageArriere {
        cadres: rendus,
        curseur: CurseurFichier {
            dev: mesuree.curseur.dev,
            ino: mesuree.curseur.ino,
            offset: nouveau_depart,
        },
    })
}

/// La cible d'une page — **2 MiB de JSON** (T025).
pub const CIBLE_PAGE_OCTETS: usize = 2 * 1024 * 1024;

/// Le plafond **absolu** d'une réponse — 16 MiB (T025).
pub const PLAFOND_ABSOLU_OCTETS: usize = 16 * 1024 * 1024;

/// L'erreur du bornage — le record hors plafond : **422 sans avancer son
/// curseur** (le client peut demander la suite autrement, la position reste
/// la sienne).
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurBorne {
    /// Un SEUL record dépasse le plafond absolu : il ne sera jamais servi
    /// — 422, curseur intact (T025 : « sans avancer son curseur »).
    RecordHorsPlafond { taille: u64 },
    /// Une panne d'I/O réelle — rapportée telle quelle, jamais requalifiée
    /// en refus de taille.
    Io(String),
}

/// La page **bornée** du forward : cible 2 MiB, plafond absolu 16 MiB, et
/// `caught_up` — **vrai au seul watermark complet observé** (aucune queue
/// en attente derrière).
///
/// ⚠️ `hasMore` reste **historique** (l'indicateur du backward, porté par la
/// route comme le fil l'a toujours fait) — la page bornée ne l'invente pas.
pub fn page_bornee(
    chemin: &Path,
    curseur: &CurseurFichier,
    observe: bool,
) -> Result<PageAvant, ErreurBorne> {
    // Le paramètre observe est porté (la RENEWAL du lease appartient à
    // l'index T027) — la lecture elle-même ne dépend pas de lui.
    let _ = observe;
    let page = page_avant(chemin, curseur, CIBLE_PAGE_OCTETS)
        .map_err(|cause| ErreurBorne::Io(cause.to_string()))
        .and_then(|page| {
            for cadre in &page.cadres {
                if cadre.consomme as usize > PLAFOND_ABSOLU_OCTETS {
                    return Err(ErreurBorne::RecordHorsPlafond {
                        taille: cadre.consomme,
                    });
                }
            }
            Ok(page)
        })?;
    Ok(page)
}

/// L'erreur du paramètre `observe` — toute autre valeur que `0`/`1`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ObserveInvalide;

/// La validation du paramètre `observe` — `"0"`/`"1"` seulement, défaut 1 ;
/// toute autre valeur est un **400** (l'appelant refuse, jamais devine).
pub fn observe_valide(param: Option<&str>) -> Result<bool, ObserveInvalide> {
    match param {
        None => Ok(true),
        Some("0") => Ok(false),
        Some("1") => Ok(true),
        _ => Err(ObserveInvalide),
    }
}
