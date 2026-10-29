//! Le framing **par octets** (T014/C02) : une ligne = des octets jusqu'au
//! saut de ligne compris. Une queue sans saut de ligne est **en attente** —
//! l'agent est en train d'écrire : elle n'est ni rendue ni comptée, et la
//! page suivante la relira complète.
//!
//! ⚠️ **L'offset ne dépasse jamais les octets réellement consommés** — c'est
//! la correction C02 : un offset posé au-delà (sur de l'en attente ou du
//! partiel) perd ou duplique des lignes. Ici : l'offset nouveau = la fin du
//! dernier cadre **complet** consommé.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom};

/// Le plafond d'une **ligne** gardée en mémoire — 16 MiB, le plafond absolu
/// d'une réponse (T025). Au-delà, la ligne n'est plus accumulée : ses octets
/// sont comptés, pas gardés, et elle est rendue comme cadre **hors plafond**.
pub const PLAFOND_LIGNE_OCTETS: usize = 16 * 1024 * 1024;

/// Une ligne brute consommée : ses octets (sans le saut de ligne), l'offset
/// de départ, la taille **consommée** (saut de ligne compris).
///
/// ⚠️ `hors_plafond` : la ligne dépassait [`PLAFOND_LIGNE_OCTETS`]. Son `brut`
/// est **vide** (rien n'a été gardé), `consomme` reste sa vraie taille : le
/// curseur la franchit, et la couche réponse dit qu'elle a été ignorée.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Cadre {
    pub brut: String,
    pub depart: u64,
    pub consomme: u64,
    pub hors_plafond: bool,
}

/// Lit les cadres depuis `depuis`, jusqu'à `cible_octets` **consommés** au
/// plus — sauf si le premier cadre dépasse à lui seul la cible : il est rendu
/// seul (un lecteur qui buterait sur un enregistrement géant resterait bloqué
/// pour toujours ; la décision de le servir ou de le refuser appartient à la
/// couche réponse, T025).
///
/// ⚠️ **Mémoire bornée.** Une ligne de plus de [`PLAFOND_LIGNE_OCTETS`]
/// n'est plus accumulée : elle était gardée en entier, octet par octet, et
/// la page entière était ensuite refusée (422 pour toujours, flux `gone`).
/// Elle est désormais rendue `hors_plafond`, vide, et franchie.
///
/// Rend les cadres complets et l'offset nouveau — toujours ≤ octets
/// effectivement consommés.
pub fn cadres_depuis(
    fichier: &mut fs::File,
    depuis: u64,
    cible_octets: usize,
) -> io::Result<(Vec<Cadre>, u64)> {
    let taille_totale = fichier.metadata()?.len();
    if depuis >= taille_totale {
        return Ok((Vec::new(), depuis));
    }
    fichier.seek(SeekFrom::Start(depuis))?;
    let mut cadres = Vec::new();
    let mut consomme_total: u64 = 0;
    let mut courant: Vec<u8> = Vec::new();
    // La taille réelle de la ligne en cours (gardée ou non).
    let mut taille_courante: u64 = 0;
    let mut hors_plafond = false;
    let mut buffer = vec![0_u8; 65_536];
    loop {
        let lus = fichier.read(&mut buffer)?;
        if lus == 0 {
            break;
        }
        let mut reste = &buffer[..lus];
        while !reste.is_empty() {
            let fin = reste.iter().position(|octet| *octet == b'\n');
            let morceau = match fin {
                Some(index) => &reste[..index],
                None => reste,
            };
            taille_courante += morceau.len() as u64;
            if !hors_plafond {
                if courant.len() + morceau.len() > PLAFOND_LIGNE_OCTETS {
                    hors_plafond = true;
                    courant = Vec::new();
                } else {
                    courant.extend_from_slice(morceau);
                }
            }
            let Some(index) = fin else {
                break;
            };
            reste = &reste[index + 1..];
            let taille_cadre = taille_courante + 1;
            let brut = if hors_plafond {
                String::new()
            } else {
                String::from_utf8_lossy(&courant).into_owned()
            };
            cadres.push(Cadre {
                brut,
                depart: depuis + consomme_total,
                consomme: taille_cadre,
                hors_plafond,
            });
            consomme_total += taille_cadre;
            courant.clear();
            taille_courante = 0;
            hors_plafond = false;
            if consomme_total as usize >= cible_octets {
                return Ok((cadres, depuis + consomme_total));
            }
        }
    }
    // Queue sans saut de ligne : EN ATTENTE — ni rendue, ni comptée.
    Ok((cadres, depuis + consomme_total))
}

/// Le premier **début de ligne** à partir de `position` : `position` elle-même
/// quand elle en est un (début de fichier, ou octet précédent = saut de
/// ligne), sinon l'octet qui suit le prochain saut de ligne — la fin du
/// fichier quand il n'y en a plus.
///
/// ⚠️ Lecture **par blocs** de 64 KiB : une ligne codex fait souvent plusieurs
/// centaines de Kio, la chercher octet par octet coûtait un appel système par
/// octet.
pub fn prochain_debut_de_ligne(fichier: &mut fs::File, position: u64) -> io::Result<u64> {
    if position == 0 {
        return Ok(0);
    }
    let taille = fichier.metadata()?.len();
    if position >= taille {
        return Ok(taille);
    }
    // On relit l'octet qui précède : s'il est un saut de ligne, `position`
    // est déjà un début de ligne.
    let mut lecture = position - 1;
    fichier.seek(SeekFrom::Start(lecture))?;
    let mut buffer = [0_u8; 65_536];
    loop {
        let lus = fichier.read(&mut buffer)?;
        if lus == 0 {
            return Ok(taille);
        }
        if let Some(index) = buffer[..lus].iter().position(|octet| *octet == b'\n') {
            return Ok(lecture + index as u64 + 1);
        }
        lecture += lus as u64;
    }
}
