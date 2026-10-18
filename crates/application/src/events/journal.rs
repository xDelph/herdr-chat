//! Le journal d'événements (T042, E04, C11) : la mémoire du direct.
//!
//! Herdr ne fournit **aucun compteur de rattrapage exploitable** (`revision`
//! vaut 0 en permanence, `events.wait` n'implémente pas
//! `pane_output_changed`) — le rattrapage est donc assuré ICI, par un
//! journal borné à identifiants monotones : un client qui se reconnecte avec
//! son dernier identifiant reçoit exactement ce qu'il a manqué.
//!
//! ⚠️ **Le journal est en mémoire** (E04) : un redémarrage le perd — d'où
//! l'identifiant opaque `<boot>:<sequence>` (C11) : un curseur d'un boot
//! étranger provoque un resync, jamais une continuité inventée.
//!
//! ⚠️ **Deux bornes, pas une** : 500 événements ET 4 MiB d'octets — la
//! cardinalité ne prétend pas borner une taille de payload arbitraire.
//! L'éviction par octets rompt la continuité EXPLICITEMENT (resync), jamais
//! silencieusement. Un événement au-delà de 256 KiB est REFUSÉ, jamais
//! tronqué.
//!
//! ⚠️ **Un seul resync** (B04) : le resync porte le curseur courant
//! (`reprendre_de`) — le client repart de là et ne redemande jamais le même
//! point.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

/// La rétention par défaut : 500 événements.
pub const JOURNAL_EVENEMENTS: usize = 500;
/// La rétention par défaut : 4 MiB d'octets cumulés.
pub const JOURNAL_OCTETS: usize = 4 * 1024 * 1024;
/// Le plus grand événement accepté — au-delà, refus, jamais troncature.
pub const EVENEMENT_MAX_OCTETS: usize = 256 * 1024;

/// L'identifiant opaque `<boot>:<sequence>` (C11).
///
/// Le boot distingue les époques du journal (en mémoire, un redémarrage le
/// perd) ; la séquence est monotone à partir de 1. L'identifiant est opaque
/// pour EventSource — le client ne le parse pas.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct IdJournal {
    pub boot: String,
    pub sequence: u64,
}

impl IdJournal {
    /// La forme opaque envoyée au client.
    #[must_use]
    pub fn opaque(&self) -> String {
        format!("{}:{}", self.boot, self.sequence)
    }

    /// Parse la forme opaque — `None` pour un curseur legacy numérique ou
    /// malformé (les deux provoquent un resync, C11).
    #[must_use]
    pub fn depuis_opaque(raw: &str) -> Option<IdJournal> {
        let (boot, sequence) = raw.rsplit_once(':')?;
        if boot.is_empty() {
            return None;
        }
        let sequence = sequence.parse::<u64>().ok()?;
        Some(IdJournal {
            boot: String::from(boot),
            sequence,
        })
    }
}

/// Un événement du journal.
#[derive(Clone, Debug)]
pub struct EvenementJournal {
    pub id: IdJournal,
    /// Le genre du journal (`agent_status`, `prompt`, …) — une chaîne
    /// opaque, le journal ne connaît pas les genres.
    pub genre: String,
    /// Le corps JSON déjà sérialisé — jamais tronqué, jamais réinterprété.
    pub donnees: Vec<u8>,
}

/// Le rattrapage d'un curseur : les événements strictement postérieurs, et
/// l'état de continuité.
#[derive(Clone, Debug)]
pub struct Rattrapage {
    pub evenements: Vec<EvenementJournal>,
    /// `true` quand la continuité n'est pas garantie (trou, éviction par
    /// octets, curseur futur, boot étranger, curseur legacy).
    pub resync_requis: bool,
    /// Le dernier identifiant émis — le curseur de reprise APRÈS un resync
    /// (un seul resync, jamais deux).
    pub reprendre_de: IdJournal,
}

/// Pourquoi un événement a été refusé.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ErreurJournal {
    EvenementTropGros,
}

struct EtatJournal {
    evenements: VecDeque<EvenementJournal>,
    prochaine_sequence: u64,
    octets: usize,
}

/// Le journal borné — partageable entre tous les consommateurs du direct.
/// La publication est UNE étape de possession courte : attribution de
/// l'identifiant, rétention, notification (TECH §7).
pub struct Journal {
    etat: Mutex<EtatJournal>,
    boot: String,
    max_evenements: usize,
    max_octets: usize,
    max_evenement: usize,
}

impl Journal {
    /// Un journal avec les bornes du contrat (500 / 4 MiB / 256 KiB) et un
    /// boot frais — chaque démarrage change d'époque (E04).
    #[must_use]
    pub fn nouveau() -> Self {
        Self::avec_limites(JOURNAL_EVENEMENTS, JOURNAL_OCTETS, EVENEMENT_MAX_OCTETS)
    }

    /// Un journal avec des bornes sur mesure — réservé aux tests.
    #[must_use]
    pub fn avec_limites(max_evenements: usize, max_octets: usize, max_evenement: usize) -> Self {
        Self {
            etat: Mutex::new(EtatJournal {
                evenements: VecDeque::new(),
                prochaine_sequence: 1,
                octets: 0,
            }),
            boot: boot_frais(),
            max_evenements,
            max_octets,
            max_evenement,
        }
    }

    /// Publie un événement : attribution de l'identifiant, rétention et
    /// éviction sous UNE possession — un lecteur ne voit jamais un état
    /// à moitié écrit.
    pub fn publie(&self, genre: &str, donnees: Vec<u8>) -> Result<EvenementJournal, ErreurJournal> {
        if donnees.len() > self.max_evenement {
            return Err(ErreurJournal::EvenementTropGros);
        }
        let mut etat = self.etat.lock().unwrap_or_else(PoisonError::into_inner);
        let evenement = EvenementJournal {
            id: IdJournal {
                boot: self.boot.clone(),
                sequence: etat.prochaine_sequence,
            },
            genre: String::from(genre),
            donnees,
        };
        etat.prochaine_sequence += 1;
        etat.octets += evenement.donnees.len();
        etat.evenements.push_back(evenement.clone());
        self.evince(&mut etat);
        Ok(evenement)
    }

    /// Le rattrapage depuis un curseur opaque — l'éviction par octets, le
    /// trou, le futur, le boot étranger et le curseur legacy provoquent un
    /// resync ; un curseur absent ne rejoue PAS l'historique (C11).
    pub fn depuis(&self, curseur: &str) -> Rattrapage {
        if curseur.is_empty() {
            // Pas de Last-Event-ID : on part de la frontière courante après
            // ready — on ne rejoue pas tout l'historique dans une nouvelle
            // fenêtre (C11).
            return Rattrapage {
                evenements: Vec::new(),
                resync_requis: false,
                reprendre_de: self.dernier_id_ou_zero(),
            };
        }
        let id = match IdJournal::depuis_opaque(curseur) {
            Some(id) => id,
            None => {
                // Curseur legacy numérique ou malformé : un resync.
                return Rattrapage {
                    evenements: Vec::new(),
                    resync_requis: true,
                    reprendre_de: self.dernier_id_ou_zero(),
                };
            }
        };
        self.depuis_id(&id)
    }

    /// Le rattrapage depuis un identifiant déjà parsé.
    pub fn depuis_id(&self, id: &IdJournal) -> Rattrapage {
        let etat = self.etat.lock().unwrap_or_else(PoisonError::into_inner);
        let plus_ancien = etat.evenements.front().map(|e| e.id.sequence);
        let dernier = etat.evenements.back().map(|e| e.id.sequence);
        let resync = id.boot != self.boot
            || match plus_ancien {
                Some(ancien) => id.sequence < ancien.saturating_sub(1),
                None => false,
            }
            || match dernier {
                Some(dernier) => id.sequence > dernier,
                None => false,
            };
        let evenements = etat
            .evenements
            .iter()
            .filter(|e| e.id.sequence > id.sequence)
            .cloned()
            .collect();
        let reprendre_de = etat
            .evenements
            .back()
            .map(|e| e.id.clone())
            .unwrap_or_else(|| IdJournal {
                boot: self.boot.clone(),
                sequence: etat.prochaine_sequence.saturating_sub(1),
            });
        Rattrapage {
            evenements,
            resync_requis: resync,
            reprendre_de,
        }
    }

    /// Le dernier identifiant émis, ou `None` si le journal est vide.
    #[must_use]
    pub fn dernier_id(&self) -> Option<IdJournal> {
        self.etat
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .evenements
            .back()
            .map(|e| e.id.clone())
    }

    /// L'époque du journal — un curseur d'une autre époque provoque un
    /// resync (C11).
    #[must_use]
    pub fn boot(&self) -> &str {
        &self.boot
    }

    /// Le nombre d'événements retenus.
    #[must_use]
    pub fn nb_evenements(&self) -> usize {
        self.etat
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .evenements
            .len()
    }

    /// Le nombre d'octets retenus.
    #[must_use]
    pub fn octets(&self) -> usize {
        self.etat
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .octets
    }

    /// La prochaine séquence à attribuer — la frontière courante quand le
    /// journal est vide (le resync repart d'ici).
    #[must_use]
    pub fn prochaine_sequence(&self) -> u64 {
        self.etat
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .prochaine_sequence
    }

    fn dernier_id_ou_zero(&self) -> IdJournal {
        self.dernier_id().unwrap_or_else(|| IdJournal {
            boot: self.boot.clone(),
            sequence: 0,
        })
    }

    /// L'éviction : par nombre PUIS par octets — la seconde rompt la
    /// continuité explicitement (le resync la signale), jamais en silence.
    fn evince(&self, etat: &mut EtatJournal) {
        while etat.evenements.len() > self.max_evenements {
            if let Some(ancien) = etat.evenements.pop_front() {
                etat.octets -= ancien.donnees.len();
            }
        }
        while etat.octets > self.max_octets {
            if let Some(ancien) = etat.evenements.pop_front() {
                etat.octets -= ancien.donnees.len();
            }
        }
    }
}

/// Un identifiant de boot frais, unique par démarrage : les nanosecondes
/// depuis l'époque + un compteur de processus. Pas un UUID RFC-4122 (aucune
/// dépendance aléatoire) — l'opacité suffit, EventSource ne parse pas.
fn boot_frais() -> String {
    static COMPTEUR: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let compteur = COMPTEUR.fetch_add(1, Ordering::SeqCst);
    format!("boot-{nanos:x}-{compteur:x}")
}
