//! La **veille de production** : la source des vues, la publication, le fil.
//!
//! ⚠️ **Ce module manquait, et c'est ce qui rendait l'écran lent.** Le moteur de
//! diff existait (`application::events::watcher`), la traduction en événements
//! existait (`http_api::publication`), le journal et les abonnements existaient
//! — mais **personne ne les reliait** : `evenements_de_changement` n'avait aucun
//! appelant hors de ses tests, et aucune boucle ne tournait dans le démon. Le
//! serveur ne publiait donc **jamais** `agent_status` ni `session_changed`, et
//! la PWA retombait sur son filet (30 s / 120 s) : ni statut en direct, ni
//! message en direct, même en gardant l'écran ouvert.
//!
//! Ce fichier relie les trois pièces, sans rien réinventer : il ne compose pas
//! de vue, il ne diff rien, il ne sérialise rien.

use application::events::subscription::ServiceAbonnements;
use application::events::watcher::{
    BoucleDeVeille, Changement, CibleDeChangement, PublicateurDeChangements, SourceDeVues,
    Veilleur, faut_notifier,
};
use application::noyau::{AgentStatus, AgentView};
use application::overview::ComposeurOverview;
use application::refresh::SourceMaintenant;
use http_api::services::Services;
use notifications::notifieur::Notifieur;
use notifications::payload::{
    IdentiteNotification, PayloadNotification, StatutDeFin, nom_de_notification,
    payload_de_notification,
};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::Duration;
use tracing::{info, warn};

/// La cadence de la veille de production.
///
/// ⚠️ **2 s, et c'est mesuré, pas choisi.** À 500 ms, la veille composait la vue
/// complète — résolution de session comprise (SQLite opencode, globs claude) —
/// cinq fois par seconde : `/api/conversations` est passé de **0,14 s** à
/// **2,65 s**, et l'application ne chargeait plus rien (liste vide, « Herdr not
/// readable »). Deux secondes suffisent à voir un changement ; c'est la borne
/// de fraîcheur déjà documentée (E01), et la veille ne prend plus le CPU des
/// requêtes.
pub const INTERVALLE_VEILLE_PRODUCTION: Duration = Duration::from_millis(2_000);

/// Les agents, lus **par la même composition que `/api/overview`**.
///
/// ⚠️ La veille ne devine pas les vues : elle demande l'observation partagée,
/// celle que les handlers servent déjà. Une seconde composition aurait produit
/// des différences invisibles (session résolue ici, absente là) et donc des
/// `session_changed` fantômes.
pub struct VuesDesServices {
    services: Arc<Services>,
}

impl VuesDesServices {
    #[must_use]
    pub fn nouveau(services: Arc<Services>) -> Self {
        Self { services }
    }
}

impl SourceDeVues for VuesDesServices {
    fn vues(&self) -> Result<Vec<AgentView>, String> {
        let borne = self
            .services
            .snapshots
            .lecture()
            .map_err(|cause| format!("observation unavailable: {cause:?}"))?;
        let vue = ComposeurOverview::nouveau().compose(&borne, self.services.resout.as_ref());
        Ok(vue.agents)
    }
}

/// Les dernières vues rendues par la source — la matière du **nom** d'une
/// notification.
///
/// ⚠️ Un `Changement` de statut ne porte que le pane : sans la vue courante,
/// la notification ne pourrait pas dire QUI a fini (projet, onglet, type).
/// La boucle appelle la source PUIS le publicateur, sur le même fil : la
/// mémoire est donc exactement la vue du tour publié.
pub type DernieresVues = Arc<Mutex<Vec<AgentView>>>;

/// Une source qui **mémorise** ce qu'elle rend — sans rien changer à ce
/// qu'elle rend (une panne reste une panne, la mémoire garde le dernier
/// succès).
pub struct SourceMemorisee {
    source: Arc<dyn SourceDeVues>,
    dernieres: DernieresVues,
}

impl SourceMemorisee {
    #[must_use]
    pub fn nouvelle(source: Arc<dyn SourceDeVues>, dernieres: DernieresVues) -> Self {
        Self { source, dernieres }
    }
}

impl SourceDeVues for SourceMemorisee {
    fn vues(&self) -> Result<Vec<AgentView>, String> {
        let vues = self.source.vues()?;
        *self
            .dernieres
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = vues.clone();
        Ok(vues)
    }
}

/// Le payload push d'un changement — `None` quand il n'y a rien à dire (E06 :
/// on ne prévient que si quelque chose était en cours).
///
/// Les trois profils du fil (`AgentWatcher.ts` → `agentFinished`) :
/// `blocked` → « Agent needs you » (`waiting-<pane>`), disparu → « Agent
/// stopped » (`gone-<pane>`), tout le reste → « Agent finished »
/// (`done-<pane>`). L'agent est nommé par sa vue COURANTE, ou par sa dernière
/// vue connue s'il a disparu.
#[must_use]
pub fn notification_de_changement(
    changement: &Changement,
    vues: &[AgentView],
) -> Option<PayloadNotification> {
    if !faut_notifier(changement.de, changement.a) {
        return None;
    }
    let (statut, vue) = match changement.a {
        CibleDeChangement::Disparu => (StatutDeFin::Disparu, changement.disparu.as_ref()),
        CibleDeChangement::Statut(statut) => (
            if statut == AgentStatus::Blocked {
                StatutDeFin::EnAttente
            } else {
                StatutDeFin::Fini
            },
            vues.iter().find(|vue| vue.pane_id == changement.pane_id),
        ),
    };
    let identite = vue.map(IdentiteNotification::depuis_vue);
    Some(payload_de_notification(
        &nom_de_notification(identite.as_ref()),
        Some(changement.pane_id.as_str()),
        statut,
    ))
}

/// Les changements de veille **traduits en événements du fil** — et, quand un
/// notifieur est composé, **en notifications push**.
///
/// Un seul point de traduction : `http_api::publication` est la fonction que le
/// contrat a définie (C26), et la dupliquer ici aurait fait diverger les deux
/// charges utiles.
pub struct PublieDansLeJournal {
    journal: Arc<ServiceAbonnements>,
    notifications: Option<(Arc<Notifieur>, DernieresVues)>,
}

impl PublieDansLeJournal {
    #[must_use]
    pub fn nouveau(journal: Arc<ServiceAbonnements>) -> Self {
        Self {
            journal,
            notifications: None,
        }
    }

    /// Ajoute les notifications push : le notifieur, et la mémoire des vues
    /// que la source de la boucle remplit ([`SourceMemorisee`]).
    #[must_use]
    pub fn avec_notifications(mut self, notifieur: Arc<Notifieur>, vues: DernieresVues) -> Self {
        self.notifications = Some((notifieur, vues));
        self
    }

    /// Enfile les notifications d'un tour — jamais d'attente réseau ici.
    fn notifie(&self, changements: &[Changement]) {
        let Some((notifieur, vues)) = &self.notifications else {
            return;
        };
        let vues = vues.lock().unwrap_or_else(PoisonError::into_inner).clone();
        for changement in changements {
            let Some(payload) = notification_de_changement(changement, &vues) else {
                continue;
            };
            match notifieur.notifie(&payload) {
                Ok(vises) => info!(
                    "notification push « {} » ({}) enfilée vers {vises} abonnement(s)",
                    payload.title, payload.tag
                ),
                // La cause est DITE : une notification perdue en silence est
                // exactement le défaut que ce câblage corrige.
                Err(erreur) => warn!(
                    "notification push « {} » ({}) non enfilée : {erreur}",
                    payload.title, payload.tag
                ),
            }
        }
    }
}

impl PublicateurDeChangements for PublieDansLeJournal {
    fn publie(&self, changements: &[Changement]) {
        for changement in changements {
            for evenement in http_api::publication::evenements_de_changement(changement) {
                /*
                  ⚠️ Une écriture de journal qui échoue **ne casse pas la
                  veille** : le journal est borné et peut refuser un événement.
                  La prochaine révision republiera l'état vrai ; s'arrêter ici
                  figerait l'écran pour une erreur d'écriture.
                */
                let _ = self.journal.publie(evenement.genre, evenement.donnees);
            }
        }
        self.notifie(changements);
    }
}

/// La veille qui tourne : la boucle et le fil qui l'exécute.
pub struct Veille {
    boucle: Arc<BoucleDeVeille>,
    fil: Option<JoinHandle<()>>,
}

impl Veille {
    /// Démarre la veille sur son propre fil.
    ///
    /// ⚠️ Un **fil**, pas une tâche asynchrone : le travail de la source est un
    /// aller-retour bloquant sur le socket Unix d'Herdr. L'exécuter dans le
    /// runtime asynchrone bloquerait les requêtes HTTP qui partagent le fil.
    ///
    /// `notifieur` : les notifications push (`None` = capacité absente, la
    /// veille ne publie alors que le journal).
    #[must_use]
    pub fn demarre(
        services: Arc<Services>,
        maintenant: Arc<dyn SourceMaintenant>,
        notifieur: Option<Arc<Notifieur>>,
    ) -> Self {
        let vues: DernieresVues = Arc::new(Mutex::new(Vec::new()));
        let mut publicateur = PublieDansLeJournal::nouveau(Arc::clone(&services.journal));
        if let Some(notifieur) = notifieur {
            publicateur = publicateur.avec_notifications(notifieur, Arc::clone(&vues));
        }
        let boucle = Arc::new(BoucleDeVeille::avec_intervalle(
            Arc::new(SourceMemorisee::nouvelle(
                Arc::new(VuesDesServices::nouveau(Arc::clone(&services))),
                vues,
            )),
            Arc::new(Veilleur::nouveau()),
            Arc::new(publicateur),
            maintenant,
            INTERVALLE_VEILLE_PRODUCTION,
        ));
        let pour_fil = Arc::clone(&boucle);
        let fil = std::thread::Builder::new()
            .name(String::from("veille-herdr"))
            .spawn(move || pour_fil.boucle())
            .ok();
        Self { boucle, fil }
    }

    /// Arrête la veille et attend la fin du fil (au plus une itération).
    pub fn arrete(&mut self) {
        self.boucle.arreter();
        if let Some(fil) = self.fil.take() {
            let _ = fil.join();
        }
    }
}

impl Drop for Veille {
    fn drop(&mut self) {
        self.arrete();
    }
}
