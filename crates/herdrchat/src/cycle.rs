//! Le cycle de vie du démon (T056, O01–O04) : admission, drain **borné**,
//! flush, fermeture — et l'issue partielle **tracée**.
//!
//! ⚠️ **L'ordre est le contrat** : on cesse d'admettre, on laisse finir ce
//! qui est en cours pendant au plus `DELAI_DRAIN` (10 s), puis on ferme. Un
//! drain non borné laisserait un flux SSE ouvert empêcher l'arrêt pour
//! toujours ; un arrêt sans drain couperait une commande à moitié appliquée.
//!
//! ⚠️ **Aucun agent n'est tué ni fermé à l'arrêt.** Le démon ne possède pas
//! les agents de l'utilisateur : il ferme ses sockets, pas les onglets.
//!
//! ⚠️ **Une commande encore en cours au terme du délai est DITE** : le
//! diagnostic nomme le nombre de requêtes coupées, jamais un silence.

use application::diagnostics::{EntreeDiagnostic, Niveau, SinkDiagnostic};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::watch;

/// Le temps laissé aux requêtes en cours — la valeur du fil (10 s).
pub const DELAI_DRAIN: Duration = Duration::from_secs(10);

/// L'arrêt demandé : un signal, une erreur fatale, ou le test qui le décide.
#[derive(Clone)]
pub struct Arret {
    reception: watch::Receiver<bool>,
}

impl Arret {
    /// Attend l'arrêt. Rend `true` dès qu'il est demandé (ou si le
    /// déclencheur est tombé : on ne reste pas bloqué pour toujours).
    pub async fn recu(&mut self) {
        // `wait_for` rend immédiatement si la valeur est déjà `true`.
        let _ = self.reception.wait_for(|demande| *demande).await;
    }

    /// L'arrêt est-il déjà demandé ?
    #[must_use]
    pub fn demande(&self) -> bool {
        *self.reception.borrow()
    }
}

/// Le déclencheur d'arrêt — un seul pour tout le processus.
pub struct Declencheur {
    emission: watch::Sender<bool>,
}

impl Declencheur {
    /// Le couple déclencheur / arrêt.
    #[must_use]
    pub fn nouveau() -> (Self, Arret) {
        let (emission, reception) = watch::channel(false);
        (Self { emission }, Arret { reception })
    }

    /// Demande l'arrêt — idempotent (deux signaux ne cassent rien).
    pub fn demande(&self) {
        let _ = self.emission.send(true);
    }

    /// L'arrêt, pour le transmettre aux composants.
    #[must_use]
    pub fn arret(&self) -> Arret {
        Arret {
            reception: self.emission.subscribe(),
        }
    }
}

/// Ce qui empêche de démarrer — nommé, jamais un `exit` muet.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurDemarrage {
    /// Le port est déjà pris (ou l'adresse refusée par le système).
    Bind { adresse: String, detail: String },
}

impl std::fmt::Display for ErreurDemarrage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErreurDemarrage::Bind { adresse, detail } => {
                write!(f, "impossible d'écouter sur {adresse} : {detail}")
            }
        }
    }
}

impl std::error::Error for ErreurDemarrage {}

/// Le compte des requêtes en cours — lu au terme du drain pour dire l'issue
/// partielle.
#[derive(Debug, Default)]
pub struct EnCours(AtomicUsize);

impl EnCours {
    #[must_use]
    pub fn nouveau() -> Self {
        Self(AtomicUsize::new(0))
    }

    /// Une requête entre : le compte monte.
    pub fn entre(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }

    /// Une requête sort : le compte descend (jamais sous zéro).
    pub fn sort(&self) {
        let _ = self
            .0
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |valeur| {
                Some(valeur.saturating_sub(1))
            });
    }

    /// Le nombre de requêtes encore en vol.
    #[must_use]
    pub fn nombre(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

/// Le compte des tâches de fond (veilleur, livreur push, …) — zéro après
/// l'arrêt est la preuve qu'aucun worker ne survit.
#[derive(Debug, Default)]
pub struct Taches(AtomicUsize);

impl Taches {
    #[must_use]
    pub fn nouveau() -> Self {
        Self(AtomicUsize::new(0))
    }

    /// Déclare une tâche vivante — rendu à sa fin.
    pub fn vive(&self) -> GardeTache<'_> {
        self.0.fetch_add(1, Ordering::SeqCst);
        GardeTache { taches: self }
    }

    /// Les tâches encore vivantes.
    #[must_use]
    pub fn vivantes(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

/// La garde d'une tâche : sa chute décrémente le compte, quelle que soit la
/// sortie (retour, panique, annulation).
pub struct GardeTache<'a> {
    taches: &'a Taches,
}

impl Drop for GardeTache<'_> {
    fn drop(&mut self) {
        let _ = self
            .taches
            .0
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |valeur| {
                Some(valeur.saturating_sub(1))
            });
    }
}

/// Ce que l'arrêt a réellement fait — le rapport, jamais un silence.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RapportArret {
    /// Le drain a-t-il dépassé son délai ? `true` = des requêtes ont été
    /// coupées.
    pub drain_interrompu: bool,
    /// Les requêtes encore en vol au moment de fermer.
    pub requetes_coupees: usize,
    /// Les tâches de fond encore vivantes (doit être zéro).
    pub taches_vivantes: usize,
}

/// Sert le routeur jusqu'à l'arrêt demandé, puis draine, trace et ferme.
///
/// ⚠️ L'écouteur est **fourni** (déjà lié) : un bind occupé est détecté
/// AVANT d'annoncer que le démon tourne, avec l'adresse dans l'erreur.
pub async fn sert(
    ecouteur: tokio::net::TcpListener,
    routeur: axum::Router,
    en_cours: Arc<EnCours>,
    taches: Arc<Taches>,
    diagnostics: Arc<dyn SinkDiagnostic>,
    arret: Arret,
    delai: Duration,
) -> RapportArret {
    let service = routeur.into_make_service();
    // ⚠️ **Le drain ne borne PAS la durée de vie.** Il y avait ici un
    // `timeout(delai, serveur)` autour du serveur entier : le démon
    // s'arrêtait donc tout seul après 10 s, même sans signal — trouvé en
    // LANÇANT le binaire (le journal disait « arrêt : 0 requête coupée »
    // sans qu'aucun signal n'ait été envoyé). Le délai ne commence qu'UNE
    // FOIS l'arrêt demandé.
    let signal = {
        let mut pour_le_serveur = arret.clone();
        async move { pour_le_serveur.recu().await }
    };
    let serveur = axum::serve(ecouteur, service)
        .with_graceful_shutdown(signal)
        .into_future();
    tokio::pin!(serveur);
    let mut pour_le_drain = arret.clone();
    let (drain_interrompu, requetes_coupees) = tokio::select! {
        // Le serveur s'arrête de lui-même (erreur d'écoute, ou fin propre).
        resultat = &mut serveur => match resultat {
            Ok(()) => (false, 0),
            Err(cause) => {
                diagnostics.ecrit(
                    &EntreeDiagnostic::nouvelle(
                        Niveau::Error,
                        "server",
                        &format!("le serveur s'est arrêté sur une erreur : {cause}"),
                    ),
                );
                (false, en_cours.nombre())
            }
        },
        // L'arrêt est demandé : on lui laisse `delai` au plus.
        _ = pour_le_drain.recu() => {
            match tokio::time::timeout(delai, &mut serveur).await {
                Ok(Ok(())) => (false, 0),
                Ok(Err(cause)) => {
                    diagnostics.ecrit(
                        &EntreeDiagnostic::nouvelle(
                            Niveau::Error,
                            "server",
                            &format!("le serveur s'est arrêté sur une erreur : {cause}"),
                        ),
                    );
                    (false, en_cours.nombre())
                }
                // Le délai expire : des requêtes sont encore en vol, on ferme.
                Err(_) => (true, en_cours.nombre()),
            }
        }
    };
    // L'issue partielle est TRACÉE : combien de commandes ont été coupées.
    if drain_interrompu || requetes_coupees > 0 {
        diagnostics.ecrit(&EntreeDiagnostic::nouvelle(
            Niveau::Warn,
            "server",
            &format!(
                "arrêt : {} requête(s) encore en cours après {} s — coupées",
                requetes_coupees,
                delai.as_secs()
            ),
        ));
    }
    diagnostics.ecrit(&EntreeDiagnostic::nouvelle(
        Niveau::Info,
        "server",
        "arrêt terminé : écoute fermée, aucune tâche de fond",
    ));
    RapportArret {
        drain_interrompu,
        requetes_coupees,
        taches_vivantes: taches.vivantes(),
    }
}

/// Lie le socket d'écoute — un port occupé est une erreur NOMMÉE, avant toute
/// annonce de démarrage.
pub async fn ecoute(adresse: SocketAddr) -> Result<tokio::net::TcpListener, ErreurDemarrage> {
    tokio::net::TcpListener::bind(adresse)
        .await
        .map_err(|cause| ErreurDemarrage::Bind {
            adresse: adresse.to_string(),
            detail: cause.to_string(),
        })
}

/// Les signaux d'arrêt du processus : `SIGINT` (Ctrl+C) et `SIGTERM`
/// (systemd, launchd). Le premier gagne ; le second ne casse rien.
#[cfg(unix)]
pub async fn signaux() {
    use tokio::signal::unix::{SignalKind, signal};
    let mut terminaison = match signal(SignalKind::terminate()) {
        Ok(flux) => flux,
        Err(cause) => {
            // Sans gestionnaire SIGTERM, Ctrl+C reste le seul chemin : on le
            // dit plutôt que de mourir sur un `unwrap`.
            eprintln!("SIGTERM indisponible ({cause}) — Ctrl+C reste actif");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => (),
        _ = terminaison.recv() => (),
    }
}

/// Hors Unix, seul `Ctrl+C` existe.
#[cfg(not(unix))]
pub async fn signaux() {
    let _ = tokio::signal::ctrl_c().await;
}
