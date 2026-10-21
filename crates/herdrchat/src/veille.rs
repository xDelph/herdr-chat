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
    BoucleDeVeille, Changement, INTERVALLE_VEILLE, PublicateurDeChangements, SourceDeVues, Veilleur,
};
use application::noyau::AgentView;
use application::overview::ComposeurOverview;
use application::refresh::SourceMaintenant;
use http_api::services::Services;
use std::sync::Arc;
use std::thread::JoinHandle;

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
            .map_err(|cause| format!("observation indisponible : {cause:?}"))?;
        let vue = ComposeurOverview::nouveau().compose(&borne, self.services.resout.as_ref());
        Ok(vue.agents)
    }
}

/// Les changements de veille **traduits en événements du fil**.
///
/// Un seul point de traduction : `http_api::publication` est la fonction que le
/// contrat a définie (C26), et la dupliquer ici aurait fait diverger les deux
/// charges utiles.
pub struct PublieDansLeJournal {
    journal: Arc<ServiceAbonnements>,
}

impl PublieDansLeJournal {
    #[must_use]
    pub fn nouveau(journal: Arc<ServiceAbonnements>) -> Self {
        Self { journal }
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
    #[must_use]
    pub fn demarre(services: Arc<Services>, maintenant: Arc<dyn SourceMaintenant>) -> Self {
        let boucle = Arc::new(BoucleDeVeille::avec_intervalle(
            Arc::new(VuesDesServices::nouveau(Arc::clone(&services))),
            Arc::new(Veilleur::nouveau()),
            Arc::new(PublieDansLeJournal::nouveau(Arc::clone(&services.journal))),
            maintenant,
            INTERVALLE_VEILLE,
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
