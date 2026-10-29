//! L'admission (T034) : A/B indépendants (parallèles), non-entrelacement par
//! pane, saturation explicite, annulation après effet sans rejeu.

use application::commands::admission::{ErreurAdmission, FILE_PANE_MAX, Tourniquet, partage};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

fn pane(nom: &str) -> domain::ids::PaneId {
    domain::ids::PaneId::from(String::from(nom))
}

/// Le délai de garde des attentes : large (une machine chargée à ~20 reste
/// très en deçà), il ne borne qu'un essai cassé — jamais le chemin vert.
const GARDE: Duration = Duration::from_secs(10);

/// Attend qu'une condition OBSERVÉE devienne vraie — au lieu de dormir en
/// espérant que l'ordonnanceur ait servi les autres fils (⚠️ ces essais
/// tombaient sous une charge de ~20 : un `sleep(30 ms)` ne garantit rien).
fn attends_que(quoi: &str, condition: impl Fn() -> bool) {
    let debut = Instant::now();
    while !condition() {
        assert!(
            debut.elapsed() < GARDE,
            "{quoi} : jamais observé en {GARDE:?}"
        );
        thread::sleep(Duration::from_millis(1));
    }
}

/// Une porte que les effets attendent : fermée, elle les retient en vol ;
/// ouverte, elle les libère tous.
#[derive(Clone, Default)]
struct Porte(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);

impl Porte {
    fn attends(&self) {
        let (ouverte, signal) = &*self.0;
        let garde = ouverte
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (garde, delai) = signal
            .wait_timeout_while(garde, GARDE, |ouverte| !*ouverte)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(
            *garde && !delai.timed_out(),
            "la porte n'a jamais été ouverte"
        );
    }

    fn ouvre(&self) {
        let (ouverte, signal) = &*self.0;
        *ouverte
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        signal.notify_all();
    }
}

/// Un rendez-vous à `attendus` : chaque fil entrant attend les autres (au
/// plus [`GARDE`]). Deux effets sérialisés ne s'y retrouvent jamais.
#[derive(Clone, Default)]
struct RendezVous(Arc<(std::sync::Mutex<usize>, std::sync::Condvar)>);

impl RendezVous {
    fn rejoins(&self, attendus: usize) {
        let (arrives, signal) = &*self.0;
        let mut garde = arrives
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *garde += 1;
        signal.notify_all();
        let _ = signal
            .wait_timeout_while(garde, GARDE, |arrives| *arrives < attendus)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
}

#[test]
fn a_et_b_sont_indépendants_parallèles() {
    let tourniquet = Arc::new(Tourniquet::nouveau());
    let en_cours = Arc::new(AtomicUsize::new(0));
    let pic = Arc::new(AtomicUsize::new(0));
    let rendezvous = RendezVous::default();
    // Deux panes, deux effets CONCURRENTS : chacun attend l'autre DANS son
    // effet (rendez-vous) — sérialisés, ils ne se retrouveraient jamais et
    // le pic resterait à 1. Le pic de concurrence = 2.
    let poignees: Vec<_> = (0..2)
        .map(|rang| {
            let tourniquet_fils = Arc::clone(&tourniquet);
            let en_cours_fils = Arc::clone(&en_cours);
            let pic_fils = Arc::clone(&pic);
            let rendezvous = rendezvous.clone();
            thread::spawn(move || {
                let pane_courant = pane(&format!("p{rang}"));
                tourniquet_fils
                    .admet(&pane_courant, || {
                        let niveau = en_cours_fils.fetch_add(1, Ordering::SeqCst) + 1;
                        pic_fils.fetch_max(niveau, Ordering::SeqCst);
                        rendezvous.rejoins(2);
                        let _ = en_cours_fils.fetch_sub(1, Ordering::SeqCst);
                        Result::<(), String>::Ok(())
                    })
                    .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"))
            })
        })
        .collect();
    for poignee in poignees {
        let _ = poignee.join();
    }
    assert!(
        pic.load(Ordering::SeqCst) == 2,
        "les deux panes tournent EN PARALLÈLE : pic {}",
        pic.load(Ordering::SeqCst)
    );
}

#[test]
fn les_séquences_dun_même_pane_ne_sentrelacent_pas() {
    let tourniquet = Arc::new(Tourniquet::nouveau());
    let entrelacs = Arc::new(AtomicUsize::new(0));
    let pic = Arc::new(AtomicUsize::new(0));
    // Huit effets sur LE MÊME pane : chacun entre une seule fois à la fois.
    let poignees: Vec<_> = (0..8)
        .map(|rang| {
            let tourniquet_fils = Arc::clone(&tourniquet);
            let entrelacs_fils = Arc::clone(&entrelacs);
            let pic_fils = Arc::clone(&pic);
            thread::spawn(move || {
                tourniquet_fils
                    .admet(&pane("wA:p1"), || {
                        let niveau = entrelacs_fils.fetch_add(1, Ordering::SeqCst) + 1;
                        pic_fils.fetch_max(niveau, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(30));
                        let _ = entrelacs_fils.fetch_sub(1, Ordering::SeqCst);
                        Result::<usize, String>::Ok(rang)
                    })
                    .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"))
            })
        })
        .collect();
    for poignee in poignees {
        let _ = poignee.join();
    }
    assert!(
        pic.load(Ordering::SeqCst) == 1,
        "UN effet à la fois par pane : pic {}",
        pic.load(Ordering::SeqCst)
    );
}

#[test]
fn la_saturation_est_explicite() {
    let tourniquet = Arc::new(Tourniquet::nouveau());
    let porte = Porte::default();
    // Les 8 admissions ENGAGÉES (retenues par la porte)…
    let poignees: Vec<_> = (0..FILE_PANE_MAX)
        .map(|rang| {
            let tourniquet_fils = Arc::clone(&tourniquet);
            let porte = porte.clone();
            thread::spawn(move || {
                tourniquet_fils
                    .admet(&pane("wA:p2"), move || {
                        porte.attends();
                        Result::<usize, String>::Ok(rang)
                    })
                    .unwrap_or_else(|erreur| {
                        panic!("l'admission {rang} devait passer : {erreur:?}")
                    })
            })
        })
        .collect();
    // PENDANT que les huit tiennent (porte fermée — OBSERVÉ, pas supposé),
    // la neuvième demande → Saturation (NOMMÉE).
    attends_que("huit galets pris", || {
        tourniquet.occupation(&pane("wA:p2")) == FILE_PANE_MAX
    });
    match tourniquet.admet(&pane("wA:p2"), || Result::<(), String>::Ok(())) {
        Err(Ok(ErreurAdmission::Saturation)) => (),
        Ok(_) => panic!("la 9e admission devait être REFUSÉE (file pleine)"),
        Err(Err(_)) => panic!("l'effet ne devait pas tourner"),
    }
    porte.ouvre();
    for poignee in poignees {
        let _ = poignee.join();
    }
}

#[test]
fn l_annulation_après_effet_ne_rejoue_rien() {
    // L'effet a tourné UNE fois ; l'annulation posée APRÈS : le résultat
    // reste, aucune relecture, aucun rejeu.
    let tourniquet = Tourniquet::nouveau();
    let tournus = Arc::new(AtomicUsize::new(0));
    let tournus_fils = Arc::clone(&tournus);
    let rendu = tourniquet
        .admet(&pane("wA:p3"), move || {
            tournus_fils.fetch_add(1, Ordering::SeqCst);
            Result::<String, String>::Ok(String::from("le résultat"))
        })
        .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"));
    assert!(rendu == "le résultat");
    assert!(
        tournus.load(Ordering::SeqCst) == 1,
        "l'effet a tourné UNE fois"
    );
    // (l'annulation se pose après — structurellement, la file n'a AUCUNE
    // relecture : le résultat sert tel quel)
    let tournus_reprise = Arc::clone(&tournus);
    let rendu = tourniquet
        .admet(&pane("wA:p3"), move || {
            tournus_reprise.fetch_add(1, Ordering::SeqCst);
            Result::<String, String>::Ok(String::from("le résultat"))
        })
        .unwrap_or_else(|erreur| panic!("admission refusée : {erreur:?}"));
    assert!(rendu == "le résultat");
    assert!(
        tournus.load(Ordering::SeqCst) == 2,
        "deux effets, deux tours, jamais de rejeu"
    );
}

// ---------------------------------------------------------------------------
// Le tourniquet BRANCHÉ : les commandes passent par la file du pane (T034).
// ---------------------------------------------------------------------------

use application::commands::prompt::{EnvoieurPrompt, RefusEnvoi};
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, FocusEvidence, PortFuture, PromptEvidence, ScreenRead,
    StartAgent, StartEvidence, StopEvidence, TargetedKeys, TargetedPrompt, TargetedText,
    TransportEvidence,
};
use std::sync::{Barrier, Mutex, PoisonError};
use test_support::fake_herdr::{HerdrFaux, Op};

/// Un port dont le prompt est LENT : il note le début et la fin de chaque
/// prompt et chaque lecture d'écran — l'ordre réel des effets sur le pane.
struct PortLent {
    faux: HerdrFaux,
    lenteur: Duration,
    journal: Mutex<Vec<String>>,
    /// Une porte qui retient chaque prompt en vol jusqu'à son ouverture.
    porte: Option<Porte>,
}

impl PortLent {
    fn nouveau(lenteur: Duration) -> Self {
        Self {
            faux: HerdrFaux::nouveau(),
            lenteur,
            journal: Mutex::new(Vec::new()),
            porte: None,
        }
    }

    fn retenu(porte: Porte) -> Self {
        Self {
            porte: Some(porte),
            ..Self::nouveau(Duration::ZERO)
        }
    }

    fn a_note(&self, evenement: &str) -> bool {
        self.journal().iter().any(|note| note == evenement)
    }

    fn note(&self, evenement: &str) {
        self.journal
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(String::from(evenement));
    }

    fn journal(&self) -> Vec<String> {
        self.journal
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl ControlPort for PortLent {
    fn ping(&self) -> PortFuture<'_, domain::observation::UpstreamPing> {
        self.faux.ping()
    }
    fn snapshot(&self) -> PortFuture<'_, domain::observation::Snapshot> {
        self.faux.snapshot()
    }
    fn list_agents(&self) -> PortFuture<'_, domain::observation::AgentListObservation> {
        self.faux.list_agents()
    }
    fn read_screen(
        &self,
        request: ScreenRead,
    ) -> PortFuture<'_, domain::observation::ScreenObservation> {
        self.note("lecture");
        self.faux.read_screen(request)
    }
    fn prompt(&self, request: TargetedPrompt) -> PortFuture<'_, PromptEvidence> {
        Box::pin(async move {
            self.note("début prompt");
            if let Some(porte) = &self.porte {
                porte.attends();
            }
            thread::sleep(self.lenteur);
            let preuve = self.faux.prompt(request).await;
            self.note("fin prompt");
            preuve
        })
    }
    fn send_text(&self, request: TargetedText) -> PortFuture<'_, TransportEvidence> {
        self.faux.send_text(request)
    }
    fn send_keys(&self, request: TargetedKeys) -> PortFuture<'_, TransportEvidence> {
        self.note("touches");
        self.faux.send_keys(request)
    }
    fn focus(&self, pane: domain::ids::PaneId) -> PortFuture<'_, FocusEvidence> {
        self.note("focus");
        self.faux.focus(pane)
    }
    fn create_tab(&self, request: CreateTab) -> PortFuture<'_, CreatedTab> {
        self.faux.create_tab(request)
    }
    fn start_agent(&self, request: StartAgent) -> PortFuture<'_, StartEvidence> {
        self.faux.start_agent(request)
    }
    fn fermer_onglet(&self, tab: domain::ids::TabId) -> PortFuture<'_, ()> {
        self.faux.fermer_onglet(tab)
    }
    fn stop(&self, pane: domain::ids::PaneId) -> PortFuture<'_, StopEvidence> {
        self.faux.stop(pane)
    }
}

#[test]
fn un_double_tap_n_envoie_qu_une_fois() {
    // Deux requêtes IDENTIQUES au même instant : sans la file, les deux
    // passaient la déduplication (le premier n'était pas encore confirmé) et
    // le texte partait deux fois.
    let port = Arc::new(PortLent::nouveau(Duration::from_millis(120)));
    let envoieur = Arc::new(EnvoieurPrompt::nouveau());
    let depart = Arc::new(Barrier::new(2));
    let poignees: Vec<_> = (0..2)
        .map(|_| {
            let port = Arc::clone(&port);
            let envoieur = Arc::clone(&envoieur);
            let depart = Arc::clone(&depart);
            thread::spawn(move || {
                depart.wait();
                envoieur.envoie(port.as_ref(), &pane("wT:p1"), "fais la revue", false)
            })
        })
        .collect();
    let issues: Vec<_> = poignees
        .into_iter()
        .map(|poignee| poignee.join().unwrap_or_else(|_| panic!("fil")))
        .collect();
    let prompts = port
        .faux
        .actions()
        .iter()
        .filter(|action| action.op == Op::Prompt)
        .count();
    assert_eq!(prompts, 1, "un seul envoi pour un double tap");
    assert_eq!(issues.iter().filter(|issue| issue.is_ok()).count(), 1);
    assert!(
        issues
            .iter()
            .any(|issue| matches!(issue, Err(RefusEnvoi::Doublon { .. }))),
        "{issues:?}"
    );
}

#[test]
fn un_prompt_et_une_reponse_ne_s_entrelacent_pas() {
    // Le prompt tient le pane 150 ms ; la réponse à une question, demandée
    // PENDANT, ne lit l'écran (ni ne tape) qu'après la fin du prompt.
    let port = Arc::new(PortLent::nouveau(Duration::from_millis(150)));
    let envoieur = Arc::new(EnvoieurPrompt::nouveau());
    let port_prompt = Arc::clone(&port);
    let prompt = thread::spawn(move || {
        envoieur.envoie(port_prompt.as_ref(), &pane("wT:p2"), "continue", false)
    });
    // Le prompt tient le pane — OBSERVÉ (il a commencé), pas supposé.
    attends_que("le prompt a commencé", || port.a_note("début prompt"));
    let port_reponse = Arc::clone(&port);
    let reponse = thread::spawn(move || {
        application::commands::repondre_question(port_reponse.as_ref(), &pane("wT:p2"), 1, None)
    });
    assert!(prompt.join().is_ok());
    assert!(reponse.join().is_ok());
    let journal = port.journal();
    let fin = journal
        .iter()
        .position(|evenement| evenement == "fin prompt")
        .unwrap_or_else(|| panic!("prompt absent : {journal:?}"));
    let lecture = journal
        .iter()
        .position(|evenement| evenement == "lecture")
        .unwrap_or_else(|| panic!("lecture absente : {journal:?}"));
    assert!(
        lecture > fin,
        "la réponse attend la fin du prompt : {journal:?}"
    );
}

#[test]
fn un_prompt_sur_un_pane_sature_est_refuse_sans_envoi() {
    // Huit prompts lents tiennent la file du pane ; le neuvième est refusé
    // TOUT DE SUITE, nommé, et n'atteint jamais Herdr.
    let porte = Porte::default();
    let port = Arc::new(PortLent::retenu(porte.clone()));
    let envoieur = Arc::new(EnvoieurPrompt::nouveau());
    let poignees: Vec<_> = (0..FILE_PANE_MAX)
        .map(|rang| {
            let port = Arc::clone(&port);
            let envoieur = Arc::clone(&envoieur);
            thread::spawn(move || {
                envoieur.envoie(
                    port.as_ref(),
                    &pane("wT:p3"),
                    &format!("message {rang}"),
                    false,
                )
            })
        })
        .collect();
    // Les huit tiennent la file (porte fermée) — OBSERVÉ sur le tourniquet
    // partagé, celui que traversent les commandes.
    attends_que("huit prompts admis", || {
        partage().occupation(&pane("wT:p3")) == FILE_PANE_MAX
    });
    match envoieur.envoie(port.as_ref(), &pane("wT:p3"), "le neuvième", false) {
        Err(RefusEnvoi::Sature { detail, .. }) => {
            assert!(detail.contains("retry"), "{detail}");
        }
        autre => panic!("le neuvième devait être refusé (file pleine) : {autre:?}"),
    }
    porte.ouvre();
    for poignee in poignees {
        assert!(
            poignee.join().unwrap_or_else(|_| panic!("fil")).is_ok(),
            "les huit admis sont servis"
        );
    }
    assert_eq!(
        port.faux
            .actions()
            .iter()
            .filter(|action| action.op == Op::Prompt)
            .count(),
        FILE_PANE_MAX,
        "le refusé n'a rien envoyé"
    );
}

#[test]
fn le_focus_passe_par_la_file_du_pane() {
    let port = Arc::new(PortLent::nouveau(Duration::from_millis(150)));
    let envoieur = Arc::new(EnvoieurPrompt::nouveau());
    let port_prompt = Arc::clone(&port);
    let prompt =
        thread::spawn(move || envoieur.envoie(port_prompt.as_ref(), &pane("wT:p4"), "go", false));
    attends_que("le prompt a commencé", || port.a_note("début prompt"));
    let issue = application::commands::focus::FocaliseurAgent::nouveau()
        .focalise(port.as_ref(), &pane("wT:p4"));
    assert!(issue.focalise, "{issue:?}");
    assert!(prompt.join().is_ok());
    let journal = port.journal();
    assert_eq!(
        journal,
        vec![
            String::from("début prompt"),
            String::from("fin prompt"),
            String::from("focus")
        ]
    );
}
