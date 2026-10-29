//! Le veilleur d'agents (T041, E01–E03, E06) : il produit le **direct**.
//!
//! Sans lui, le flux d'événements n'émettait que les envois de prompt :
//! l'onglet Activité restait vide et l'interface ne montrait jamais un agent
//! passer de `working` à `done`. Le veilleur interroge la source à intervalle
//! régulier, **diffe** l'état précédent et ne publie que les changements — un
//! état republié à l'identique toutes les deux secondes noierait le flux.
//!
//! ⚠️ **Pas de rafale initiale** (E03) : le premier parcours ne dit pas que
//! tout le parc est « apparu » — chaque démarrage produirait une rafale.
//!
//! ⚠️ **Panne ≠ disparition** (E06) : une source injoignable ne vide pas le
//! parc — elle compte une erreur et la boucle continue ; au rétablissement,
//! le diff repart de la DERNIÈRE vue réussie (un agent réellement parti
//! pendant la panne est alors annoncé, pas la masse).
//!
//! ⚠️ **Identité conservée** (E03) : un agent qui disparaît garde sa dernière
//! vue — sans elle, un agent qui s'en va ne peut pas être **nommé** dans la
//! notification, et le message serait générique.
//!
//! ⚠️ **On ne prévient que si quelque chose était en cours** (E06) : un agent
//! `working` ou `blocked` qui disparaît, c'est un travail interrompu ou une
//! question qui n'attend plus ; un agent `idle` ou `done` qu'on ferme est une
//! fin normale, et le notifier serait du bruit. La cause n'est jamais
//! inventée : Herdr rend `pane.exited` sans code ni raison — on dit que
//! l'agent n'est plus là, jamais pourquoi.

use crate::refresh::SourceMaintenant;
use domain::ids::PaneId;
use domain::observation::AgentView;
use domain::status::AgentStatus;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// La cadence de la veille : 2 s APRÈS une itération complète (E01) — une
/// itération lente retarde la suivante, jamais deux lectures en même temps.
/// La période d'observation de Herdr.
///
/// ⚠️ **C'est la borne de fraîcheur de toute l'application.** Le flux SSE ne
/// peut pas publier plus vite que cette veille ne voit : 2 s de retard sur
/// l'écran de l'ordinateur, même avec un client parfaitement événementiel.
/// Passé à **500 ms** : Herdr est local, l'appel est un aller-retour sur un
/// socket Unix, et le banc T065 a mesuré `session.snapshot` sous la milliseconde
/// côté serveur. Le client, lui, ne relit que ce qui a changé (curseur).
pub const INTERVALLE_VEILLE: Duration = Duration::from_millis(500);

/// La signature d'un agent : le diff ne publie que les changements réels
/// (E02) — statut, titre, cwd, type, chemin de session. Un changement de
/// métadonnées peut émettre un statut de→vers identiques : c'est voulu.
#[must_use]
pub fn signature_de(agent: &AgentView) -> String {
    [
        agent.status.to_string(),
        agent.title.clone().unwrap_or_default(),
        agent.cwd.clone().unwrap_or_default(),
        agent
            .agent
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default(),
        agent.session_path.clone().unwrap_or_default(),
    ]
    .join("\u{0}")
}

/// La **révision opaque** de la source d'un agent (T053, TECH : « source
/// revision from actual source observations, **no prompt text/path** »).
///
/// ⚠️ Le client n'a besoin que d'une chose : « la source a-t-elle changé ? ».
/// Le chemin (ou l'identifiant) de session ne sort donc PAS du veilleur — il
/// est réduit à une empreinte stable, et deux observations de la même source
/// donnent la même révision (donc aucune publication, T053 : « repeated
/// observations of the same revision are coalesced »).
///
/// L'absence de source est sa **propre identité** : elle a une révision
/// stable, distincte de toute source réelle.
#[must_use]
pub fn revision_de(vue: &AgentView) -> String {
    /*
      ⚠️ **La révision doit changer quand le CONTENU change, sinon
      `session_changed` ne se déclenche jamais.**

      Elle ne hachait que l'identité de la source (chemin ou identifiant) : pour
      une session donnée, la valeur était donc **constante**, et le serveur ne
      publiait l'événement qu'une fois — à l'apparition de la session. D'où le
      symptôme rapporté : aucune arrivée de message en direct sur la PWA, et une
      latence bornée par le filet de relecture (15 s).

      On ajoute donc la **taille et la date de modification** du fichier (ou de la
      base). L'empreinte reste un condensé de 16 hexadécimaux : ni chemin, ni
      texte ne sortent de l'événement — le contrat TECH §7 est tenu.
    */
    let (identite, chemin) = match (&vue.session_kind, &vue.session_path, &vue.session_id) {
        (_, Some(chemin), _) if !chemin.is_empty() => {
            (format!("path{}{chemin}", '\u{0}'), Some(chemin.clone()))
        }
        (_, _, Some(id)) if !id.as_str().is_empty() => (
            format!("id{}{}", '\u{0}', id.as_str()),
            vue.session_path.clone(),
        ),
        _ => (String::from("absent"), None),
    };
    // Une source introuvable garde une révision stable : l'absence est un état,
    // pas un changement.
    let croissance = chemin
        .as_deref()
        .and_then(observation_de_fichier)
        .map_or_else(
            || String::from("-"),
            |(taille, mtime)| format!("{taille}:{mtime}"),
        );
    empreinte_de_source(&format!("{identite}\u{0}{croissance}"))
}

/// Taille et date de modification d'un fichier, en nanosecondes.
///
/// Une erreur (fichier absent, droits) donne `None` : la révision reste alors
/// celle de l'identité seule, et rien n'est inventé.
fn observation_de_fichier(chemin: &str) -> Option<(u64, u128)> {
    let metadonnees = std::fs::metadata(chemin).ok()?;
    let mtime = metadonnees
        .modified()
        .ok()
        .and_then(|instant| instant.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |duree| duree.as_nanos());
    Some((metadonnees.len(), mtime))
}

/// La révision de l'absence de source — une identité stable, distincte de
/// toute source réelle.
#[must_use]
pub fn revision_absente() -> String {
    empreinte_de_source("absent")
}

/// L'empreinte d'une identité de source — 16 hexadécimaux, jamais réversible
/// vers un chemin.
fn empreinte_de_source(identite: &str) -> String {
    use sha2::Digest;
    let mut hacheur = sha2::Sha256::new();
    hacheur.update(identite.as_bytes());
    hacheur
        .finalize()
        .iter()
        .take(8)
        .map(|octet| format!("{octet:02x}"))
        .collect()
}

/// Le genre d'un changement publié.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GenreDeChangement {
    /// Un agent est apparu (jamais au premier parcours, E03).
    Apparu,
    /// La signature a changé (statut, titre, cwd, type ou session).
    Statut,
    /// L'agent n'est plus dans le parc.
    Disparu,
    /// Seul le **contenu** de la source a changé (le fichier grandit, la base
    /// est réécrite) : l'agent travaille, son titre et son statut ne bougent
    /// pas. Ne produit que `session_changed`, jamais un `agent_status`.
    Contenu,
}

/// La cible d'un changement : un état réel, ou la disparition (« gone » —
/// pas un état Herdr, un artefact du veilleur).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CibleDeChangement {
    Statut(AgentStatus),
    Disparu,
}

/// Un changement publié par un tour de veille.
#[derive(Clone, Debug)]
pub struct Changement {
    pub pane_id: PaneId,
    pub de: Option<AgentStatus>,
    pub a: CibleDeChangement,
    pub genre: GenreDeChangement,
    /// La dernière vue connue quand l'agent a **disparu** (E03).
    pub disparu: Option<AgentView>,
    /// Les **révisions opaques** de la source avant et après (T053) — la
    /// seule matière de `session_changed`. Aucun chemin n'est transporté.
    pub revision_avant: String,
    pub revision_apres: String,
}

impl Changement {
    /// La source a-t-elle changé ? (apparition, disparition ou autre source)
    /// — la question que `session_changed` répond, et la seule.
    #[must_use]
    pub fn source_change(&self) -> bool {
        self.revision_avant != self.revision_apres
    }
}

/// Un tour de veille : la vue à jour et les changements qu'elle entraîne.
#[derive(Clone, Debug)]
pub struct TourDeVeille {
    pub agents: Vec<AgentView>,
    pub changements: Vec<Changement>,
}

struct EntreePrecedente {
    signature: String,
    revision: String,
    statut: AgentStatus,
    vue: AgentView,
}

/// Le moteur de diff — partageable (une seule mémoire entre tous les
/// consommateurs du direct).
pub struct Veilleur {
    precedent: Mutex<HashMap<PaneId, EntreePrecedente>>,
}

impl Veilleur {
    /// Un veilleur vierge : le premier tour ne publie rien (E03).
    #[must_use]
    pub fn nouveau() -> Self {
        Self {
            precedent: Mutex::new(HashMap::new()),
        }
    }

    /// Diff l'état précédent et publie les changements.
    pub fn tick(&self, agents: Vec<AgentView>) -> TourDeVeille {
        let mut precedent = self
            .precedent
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let premiere_fois = precedent.is_empty();
        let mut suivantes = HashMap::with_capacity(agents.len());
        let mut changements = Vec::new();

        for agent in &agents {
            let signature = signature_de(agent);
            let revision = revision_de(agent);
            suivantes.insert(
                agent.pane_id.clone(),
                EntreePrecedente {
                    signature: signature.clone(),
                    revision: revision.clone(),
                    statut: agent.status,
                    vue: agent.clone(),
                },
            );
            match precedent.get(&agent.pane_id) {
                None => {
                    // Premier passage : on n'annonce pas « apparu » pour tout
                    // le parc, sinon chaque démarrage produirait une rafale.
                    if !premiere_fois {
                        changements.push(Changement {
                            pane_id: agent.pane_id.clone(),
                            de: None,
                            a: CibleDeChangement::Statut(agent.status),
                            genre: GenreDeChangement::Apparu,
                            disparu: None,
                            // La révision d'AVANT est celle de l'identité
                            // absente : une apparition avec source change
                            // bien la révision.
                            revision_avant: revision_absente(),
                            revision_apres: revision.clone(),
                        });
                    }
                }
                Some(ancienne) if ancienne.signature != signature => {
                    changements.push(Changement {
                        pane_id: agent.pane_id.clone(),
                        de: Some(ancienne.statut),
                        a: CibleDeChangement::Statut(agent.status),
                        genre: GenreDeChangement::Statut,
                        disparu: None,
                        revision_avant: ancienne.revision.clone(),
                        revision_apres: revision,
                    });
                }
                /*
                  ⚠️ **Le cas qui manquait : l'agent travaille.** Pendant un long
                  tour, statut et titre restent identiques — la signature aussi.
                  Seule la révision (taille + mtime de la source) bouge. Sans ce
                  bras, aucun `session_changed` ne partait et la PWA attendait sa
                  relecture de secours (15 s) pour voir la suite.
                */
                Some(ancienne) if ancienne.revision != revision => {
                    changements.push(Changement {
                        pane_id: agent.pane_id.clone(),
                        de: Some(ancienne.statut),
                        a: CibleDeChangement::Statut(agent.status),
                        genre: GenreDeChangement::Contenu,
                        disparu: None,
                        revision_avant: ancienne.revision.clone(),
                        revision_apres: revision,
                    });
                }
                Some(_) => {}
            }
        }

        for pane_id in precedent.keys() {
            if !suivantes.contains_key(pane_id) {
                let connue = precedent.get(pane_id);
                changements.push(Changement {
                    pane_id: pane_id.clone(),
                    de: connue.map(|entree| entree.statut),
                    a: CibleDeChangement::Disparu,
                    genre: GenreDeChangement::Disparu,
                    disparu: connue.map(|entree| entree.vue.clone()),
                    // La source s'éteint avec l'agent : révision d'absence.
                    revision_avant: connue
                        .map_or_else(revision_absente, |entree| entree.revision.clone()),
                    revision_apres: revision_absente(),
                });
            }
        }

        *precedent = suivantes;
        TourDeVeille {
            agents,
            changements,
        }
    }
}

/// E06 : faut-il prévenir l'utilisateur de ce changement d'état ?
///
/// Un agent qui `working` ou qui `blocked` disparaît, c'est un travail
/// interrompu ou une question qui n'attend plus ; `idle`/`done` qu'on ferme
/// est une fin normale. Un agent qui passe de `working` à autre chose a fini
/// ou demande de l'attention.
#[must_use]
pub fn faut_notifier(de: Option<AgentStatus>, a: CibleDeChangement) -> bool {
    match a {
        CibleDeChangement::Disparu => {
            matches!(de, Some(AgentStatus::Working | AgentStatus::Blocked))
        }
        CibleDeChangement::Statut(a) => {
            de == Some(AgentStatus::Working) && a != AgentStatus::Working
        }
    }
}

/// La source des vues du veilleur — `Err` est une **panne** (source
/// injoignable), jamais une disparition de masse (E06).
pub trait SourceDeVues: Send + Sync {
    fn vues(&self) -> Result<Vec<AgentView>, String>;
}

/// La publication des changements — le journal (T042) la câblera ici.
pub trait PublicateurDeChangements: Send + Sync {
    fn publie(&self, changements: &[Changement]);
}

/// La boucle de veille (E01) : une itération complète, puis 2 s — le cache
/// des dernières vues, le dernier succès et le compte d'erreurs restent
/// interrogables ; une panne garde la boucle vivante.
pub struct BoucleDeVeille {
    source: Arc<dyn SourceDeVues>,
    veilleur: Arc<Veilleur>,
    publicateur: Arc<dyn PublicateurDeChangements>,
    intervalle: Duration,
    maintenant: Arc<dyn SourceMaintenant>,
    derniers_agents: Mutex<Vec<AgentView>>,
    dernier_succes: Mutex<Option<Instant>>,
    erreurs: AtomicU64,
    en_marche: AtomicBool,
}

impl BoucleDeVeille {
    /// La boucle avec la cadence du contrat (2 s) et l'horloge injectée.
    #[must_use]
    pub fn nouvelle(
        source: Arc<dyn SourceDeVues>,
        veilleur: Arc<Veilleur>,
        publicateur: Arc<dyn PublicateurDeChangements>,
        maintenant: Arc<dyn SourceMaintenant>,
    ) -> Self {
        Self {
            source,
            veilleur,
            publicateur,
            intervalle: INTERVALLE_VEILLE,
            maintenant,
            derniers_agents: Mutex::new(Vec::new()),
            dernier_succes: Mutex::new(None),
            erreurs: AtomicU64::new(0),
            en_marche: AtomicBool::new(true),
        }
    }

    /// La boucle avec une cadence raccourcie — réservé aux tests.
    #[must_use]
    pub fn avec_intervalle(
        source: Arc<dyn SourceDeVues>,
        veilleur: Arc<Veilleur>,
        publicateur: Arc<dyn PublicateurDeChangements>,
        maintenant: Arc<dyn SourceMaintenant>,
        intervalle: Duration,
    ) -> Self {
        let mut boucle = Self::nouvelle(source, veilleur, publicateur, maintenant);
        boucle.intervalle = intervalle;
        boucle
    }

    /// Une itération : la source, le diff, la publication, le cache — ou la
    /// panne comptée, sans toucher au parc (E06).
    pub fn une_fois(&self) -> Result<TourDeVeille, String> {
        match self.source.vues() {
            Err(panne) => {
                self.erreurs.fetch_add(1, Ordering::SeqCst);
                Err(panne)
            }
            Ok(agents) => {
                let tour = self.veilleur.tick(agents);
                self.publicateur.publie(&tour.changements);
                *self
                    .derniers_agents
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner) = tour.agents.clone();
                *self
                    .dernier_succes
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner) = Some(self.maintenant.maintenant());
                Ok(tour)
            }
        }
    }

    /// La boucle elle-même : itération complète PUIS attente (E01) — une
    /// itération lente retarde la suivante, jamais deux lectures en même
    /// temps. À lancer dans son propre fil ; `arreter` la fait sortir.
    pub fn boucle(&self) {
        while self.en_marche.load(Ordering::SeqCst) {
            let _ = self.une_fois();
            std::thread::sleep(self.intervalle);
        }
    }

    /// Arrête la boucle — au prochain point de contrôle.
    pub fn arreter(&self) {
        self.en_marche.store(false, Ordering::SeqCst);
    }

    /// Les dernières vues réussies — le cache du direct (E01).
    #[must_use]
    pub fn derniers_agents(&self) -> Vec<AgentView> {
        self.derniers_agents
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// L'instant du dernier succès, ou `None` si aucun (E01).
    #[must_use]
    pub fn dernier_succes(&self) -> Option<Instant> {
        *self
            .dernier_succes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Le nombre d'échecs depuis le démarrage (E01).
    #[must_use]
    pub fn erreurs(&self) -> u64 {
        self.erreurs.load(Ordering::SeqCst)
    }
}
