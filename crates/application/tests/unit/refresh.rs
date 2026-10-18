//! Le service de rafraîchissement partagé (T038/C23) : fenêtre de cache
//! 2 s, coalescence des lecteurs simultanés (une seule requête amont),
//! cache vide valide, panne jamais remplacée par du périmé, force ignare de
//! la fenêtre, santé coalescée à 1 s, battement du poller. Toutes les
//! fenêtres se testent sur une HORLOGE INJECTÉE, sans dormir.

use application::refresh::{
    MaintenantReelle, PingBorne, ServiceSnapshots, SourceMaintenant, TTL_SANTE,
};
use application::state::ObservationBorne;
use domain::errors::PortError;
use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::observation::{Snapshot, UpstreamPing, WorkspaceObservation};
use domain::ports::{CreatedTab, StartEvidence};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};
use test_support::fake_herdr::{HerdrFaux, Op};

/// L'horloge contrôlée : chaque `avance` déplace l'instant monotone d'un
/// L'horloge contrôlée : une base fixe à la création + un déplacement —
/// `maintenant` avance avec le compteur, jamais dans le passé.
#[derive(Clone)]
struct MaintenantTest {
    base: Instant,
    ms: Arc<AtomicU64>,
}

impl MaintenantTest {
    fn nouvelle() -> Self {
        Self {
            base: Instant::now(),
            ms: Arc::new(AtomicU64::new(0)),
        }
    }

    fn avance_ms(&self, millis: u64) {
        self.ms.fetch_add(millis, Ordering::SeqCst);
    }
}

impl SourceMaintenant for MaintenantTest {
    fn maintenant(&self) -> Instant {
        self.base + Duration::from_millis(self.ms.load(Ordering::SeqCst))
    }
}

fn photo_non_vide() -> Snapshot {
    Snapshot {
        workspaces: vec![WorkspaceObservation {
            workspace_id: WorkspaceId::from(String::from("w1")),
            label: Some(String::from("atelier")),
            agent_status: None,
            focused: None,
            number: None,
            pane_count: None,
            tab_count: None,
            active_tab_id: None,
            worktree: None,
        }],
        ..Snapshot::default()
    }
}

fn service(port: HerdrFaux, horloge: &MaintenantTest) -> ServiceSnapshots {
    ServiceSnapshots::nouveau(Box::new(port), Arc::new(horloge.clone()))
}

fn appels_snapshot(faux: &HerdrFaux) -> usize {
    faux.actions()
        .iter()
        .filter(|action| action.op == Op::Snapshot)
        .count()
}

fn appels_ping(faux: &HerdrFaux) -> usize {
    faux.actions()
        .iter()
        .filter(|action| action.op == Op::Ping)
        .count()
}

/// La lecture ORDINAIRE du service — le test panique nommé, jamais
/// d'`expect` (convention du dépôt : un échec est décrit, pas avalé).
fn lecture(service: &ServiceSnapshots) -> ObservationBorne {
    match service.lecture() {
        Ok(borne) => borne,
        Err(erreur) => panic!("lecture attendue : {erreur:?}"),
    }
}

fn lecture_forcee(service: &ServiceSnapshots) -> ObservationBorne {
    match service.lecture_forcee() {
        Ok(borne) => borne,
        Err(erreur) => panic!("force attendue : {erreur:?}"),
    }
}

fn sante(service: &ServiceSnapshots) -> PingBorne {
    match service.sante() {
        Ok(borne) => borne,
        Err(erreur) => panic!("santé attendue : {erreur:?}"),
    }
}

fn pulse(service: &ServiceSnapshots) {
    match service.pulse() {
        Ok(()) => (),
        Err(erreur) => panic!("battement attendu : {erreur:?}"),
    }
}

#[test]
fn une_lecture_recente_sert_le_cache_sans_toucher_l_amont() {
    // La fenêtre de 2 s : après UN rafraîchissement, deux lectures servent
    // la même génération sans appel amont.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    let premiere = lecture(&service);
    let seconde = lecture(&service);
    assert!(appels_snapshot(&faux) == 1, "un seul appel amont");
    assert!(
        premiere.generation == 1 && seconde.generation == 1,
        "la même génération, sans avancer"
    );
    assert!(
        premiere.snapshot == seconde.snapshot
            && seconde
                .snapshot
                .workspaces
                .iter()
                .any(|ws| ws.label.as_deref() == Some("atelier")),
        "la même photo complète"
    );
}

#[test]
fn l_observation_expiree_fait_partir_un_nouveau_rafraichissement() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    let premiere = lecture(&service);
    horloge.avance_ms(2_001);
    let seconde = lecture(&service);
    assert!(
        seconde.generation == premiere.generation + 1,
        "la génération avance d'exactement UN"
    );
    assert!(appels_snapshot(&faux) == 2, "périmé → un nouveau vol");
}

#[test]
fn la_lecture_forcee_rafraichit_meme_avec_un_cache_frais() {
    // L'admission et les racines de fichiers EXIGENT une vraie fraîcheur :
    // la force ne sert jamais le cache.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    let premiere = lecture(&service);
    let forcee = lecture_forcee(&service);
    assert!(
        forcee.generation == premiere.generation + 1,
        "la force committe une nouvelle génération"
    );
    assert!(appels_snapshot(&faux) == 2, "force = 2ᵉ appel amont");
}

/// La porte d'un port lent : le snapshot est retenu jusqu'au signal — la
/// fenêtre d'envolement réelle qui permet de prouver que les forces
/// simultanées partagent UN vol déjà en cours (l'amont qui met du temps).
#[derive(Clone, Default)]
struct SasAmont {
    depart: Arc<(Mutex<bool>, std::sync::Condvar)>,
    demandes: Arc<AtomicU64>,
}

impl SasAmont {
    /// Compte une demande de snapshot et attend le feu vert.
    async fn attend_la_photo(&self, photo: Snapshot) -> Result<Snapshot, PortError> {
        self.demandes.fetch_add(1, Ordering::SeqCst);
        let mut depart = self.depart.0.lock().unwrap_or_else(PoisonError::into_inner);
        while !*depart {
            depart = self
                .depart
                .1
                .wait(depart)
                .unwrap_or_else(PoisonError::into_inner);
        }
        Ok(photo)
    }

    fn lache_la_photo(&self) {
        let mut depart = self.depart.0.lock().unwrap_or_else(PoisonError::into_inner);
        *depart = true;
        self.depart.1.notify_all();
    }
}

/// Le port gated : tout délègue au faux SAUF le snapshot, retenu au sas.
struct PortAvecSas {
    faux: HerdrFaux,
    sas: SasAmont,
    photo: Snapshot,
}

impl domain::ports::ControlPort for PortAvecSas {
    fn ping(&self) -> domain::ports::PortFuture<'_, UpstreamPing> {
        self.faux.ping()
    }
    fn snapshot(&self) -> domain::ports::PortFuture<'_, Snapshot> {
        let sas = self.sas.clone();
        let photo = self.photo.clone();
        Box::pin(async move { sas.attend_la_photo(photo).await })
    }
    fn list_agents(
        &self,
    ) -> domain::ports::PortFuture<'_, domain::observation::AgentListObservation> {
        self.faux.list_agents()
    }
    fn read_screen(
        &self,
        request: domain::ports::ScreenRead,
    ) -> domain::ports::PortFuture<'_, domain::observation::ScreenObservation> {
        self.faux.read_screen(request)
    }
    fn prompt(
        &self,
        request: domain::ports::TargetedPrompt,
    ) -> domain::ports::PortFuture<'_, domain::ports::PromptEvidence> {
        self.faux.prompt(request)
    }
    fn send_text(
        &self,
        request: domain::ports::TargetedText,
    ) -> domain::ports::PortFuture<'_, domain::ports::TransportEvidence> {
        self.faux.send_text(request)
    }
    fn send_keys(
        &self,
        request: domain::ports::TargetedKeys,
    ) -> domain::ports::PortFuture<'_, domain::ports::TransportEvidence> {
        self.faux.send_keys(request)
    }
    fn focus(&self, pane: PaneId) -> domain::ports::PortFuture<'_, domain::ports::FocusEvidence> {
        self.faux.focus(pane)
    }
    fn create_tab(
        &self,
        request: domain::ports::CreateTab,
    ) -> domain::ports::PortFuture<'_, CreatedTab> {
        self.faux.create_tab(request)
    }
    fn start_agent(
        &self,
        request: domain::ports::StartAgent,
    ) -> domain::ports::PortFuture<'_, StartEvidence> {
        self.faux.start_agent(request)
    }
    fn fermer_onglet(&self, tab: TabId) -> domain::ports::PortFuture<'_, ()> {
        self.faux.fermer_onglet(tab)
    }
    fn stop(&self, pane: PaneId) -> domain::ports::PortFuture<'_, domain::ports::StopEvidence> {
        self.faux.stop(pane)
    }
}

#[test]
fn les_signaux_simultanes_partagent_un_seul_rafraichissement() {
    // C23 : huit lecteurs arrivent pendant que l'observation est périmée —
    // UN SEUL appel amont, huit verdicts identiques.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = Arc::new(service(faux.clone(), &horloge));

    let mut porteurs = Vec::new();
    for _ in 0..8 {
        let service = Arc::clone(&service);
        porteurs.push(std::thread::spawn(move || {
            let borne = lecture(&service);
            borne.generation
        }));
    }
    let generations: Vec<u64> = porteurs
        .into_iter()
        .map(|porteur| porteur.join().unwrap_or_else(|_| panic!("porteur paniqué")))
        .collect();
    assert!(
        generations.iter().all(|&g| g == 1),
        "tous ont vu la MÊME génération : {generations:?}"
    );
    assert!(
        appels_snapshot(&faux) == 1,
        "UNE requête amont pour huit signaux simultanés"
    );
}

#[test]
fn les_signaux_simultanes_partagent_aussi_la_lecture_forcee() {
    // « Sharing only an already in-flight request » : huit forces pendant
    // que la photo amont est RETENUE (l'amont lent) — une seule demande
    // amont, une seule génération commitée pour tous.
    let sas = SasAmont::default();
    let port = PortAvecSas {
        faux: HerdrFaux::nouveau(),
        sas: sas.clone(),
        photo: photo_non_vide(),
    };
    let horloge = MaintenantTest::nouvelle();
    let service = Arc::new(ServiceSnapshots::nouveau(
        Box::new(port),
        Arc::new(horloge.clone()),
    ));

    // Le premier demandeur devient LE vol (retenu par le sas).
    let premier = {
        let service = Arc::clone(&service);
        std::thread::spawn(move || lecture_forcee(&service).generation)
    };
    while sas.demandes.load(Ordering::SeqCst) == 0 {
        std::thread::yield_now();
    }
    // Sept autres forces arrivent pendant que le vol est en cours.
    let mut porteurs = Vec::new();
    for _ in 0..7 {
        let service = Arc::clone(&service);
        porteurs.push(std::thread::spawn(move || {
            lecture_forcee(&service).generation
        }));
    }
    // Le temps que les sept rejoignent le vol (largement en deçà du
    // déclenchement : un joineur retardé = nouvelle génération, le test
    // tomberait sinon — la fenêtre du sleep est délibérée).
    std::thread::sleep(Duration::from_millis(150));
    sas.lache_la_photo();

    let mut generations = vec![premier.join().unwrap_or_else(|_| panic!("premier paniqué"))];
    for porteur in porteurs {
        generations.push(porteur.join().unwrap_or_else(|_| panic!("porteur paniqué")));
    }
    assert!(
        generations.iter().all(|&g| g == 1),
        "une seule génération commitée : {generations:?}"
    );
    assert!(
        sas.demandes.load(Ordering::SeqCst) == 1,
        "UNE demande amont pour huit forces simultanées"
    );
}

#[test]
fn la_panne_amont_n_est_jamais_masquee_par_du_perime() {
    // TECH §4 : « refresh failure maps to the existing endpoint error
    // instead of presenting stale data as fresh ». L'ancienne observation
    // est conservée mais REFUSÉE, la cause est la cause réelle.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    let fresche = lecture(&service);
    horloge.avance_ms(2_001);
    faux.panne_globale(PortError::Upstream {
        code: String::from("upstream_down"),
        message: String::from("herdr indisponible"),
    });
    match service.lecture() {
        Err(application::refresh::ErreurLecture::Amont { cause }) => {
            assert!(
                cause.description().contains("indisponible"),
                "la cause réelle : {}",
                cause.description()
            );
        }
        issue => panic!("la panne doit être remontée, pas masquée : {issue:?}"),
    }
    // L'ancienne génération n'a PAS bougé (rien n'a été servi ni effacé).
    assert!(service.generation_actuelle() == fresche.generation);
}

#[test]
fn la_reprise_apres_panne_rafraichit_de_nouveau() {
    // Un échec n'empoisonne pas : la demande suivante envoie un nouveau vol.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    faux.panne_sur(Op::Snapshot, PortError::Timeout);
    match service.lecture() {
        Err(application::refresh::ErreurLecture::Amont { cause }) => {
            assert!(cause == PortError::Timeout);
        }
        issue => panic!("première panne attendue : {issue:?}"),
    }
    faux.sans_panne();
    let reprise = lecture(&service);
    assert!(reprise.generation == 1);
    assert!(appels_snapshot(&faux) == 2, "un vol après la panne");
}

#[test]
fn un_snapshot_vide_est_une_observation_valide() {
    // « Cache empty snapshots as valid observations » : zéro agent et zéro
    // workspace est une OBSERVATION — servie 2 s sans rappel amont.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(Snapshot::default());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    let vide = lecture(&service);
    assert!(vide.snapshot.agents.is_empty() && vide.snapshot.workspaces.is_empty());
    let relecture = lecture(&service);
    assert!(relecture.generation == vide.generation);
    assert!(appels_snapshot(&faux) == 1);
}

#[test]
fn la_sante_coalesce_sur_une_seconde() {
    // La santé est coalescée SÉPARÉMENT : ping à 1 s de TTL, et son échec
    // n'entame pas le cache du snapshot.
    let faux = HerdrFaux::nouveau();
    faux.repond_ping(UpstreamPing {
        protocol: 22,
        version: String::from("0.9.3"),
    });
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    let premiere: PingBorne = sante(&service);
    assert!(premiere.ping.version == "0.9.3");
    let seconde = sante(&service);
    assert!(
        seconde.observe_a == premiere.observe_a,
        "le même ping servi dans la fenêtre"
    );
    assert!(appels_ping(&faux) == 1, "un seul ping dans la fenêtre");

    horloge.avance_ms(1_001);
    let tierce = sante(&service);
    assert!(tierce.observe_a > premiere.observe_a);
    assert!(appels_ping(&faux) == 2, "le TTL d'une seconde");

    // La santé reste servie pendant qu'une panne frappe le SNAPSHOT.
    horloge.avance_ms(2_001);
    faux.panne_sur(
        Op::Snapshot,
        PortError::Upstream {
            code: String::from("upstream_down"),
            message: String::from("snapshot en panne"),
        },
    );
    let _ = service.lecture(); // échoue (la panne snapshot)
    let toujours = sante(&service);
    assert!(toujours.ping.version == "0.9.3");
    assert!(TTL_SANTE.as_secs() == 1, "le TTL mesuré du contrat");
}

#[test]
fn la_panne_de_ping_remonte_sans_toucher_le_cache() {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    faux.panne_sur(
        Op::Ping,
        PortError::Transport {
            detail: String::from("socket fermé"),
        },
    );
    match service.sante() {
        Err(application::refresh::ErreurSante::Amont { cause }) => {
            assert!(cause.description().contains("socket"), "cause réelle");
        }
        issue => panic!("panne de ping attendue : {issue:?}"),
    }
    // Le cache du snapshot est intact et frais.
    let borne: ObservationBorne = lecture(&service);
    assert!(borne.generation == 1);
}

#[test]
fn le_battement_du_poller_ne_frappe_que_quand_l_observation_vieillit() {
    // `pulse()` = l'entrée du poller : un battement ne part à l'amont que
    // quand l'observation a vieilli — sinon c'est un no-op.
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_non_vide());
    let horloge = MaintenantTest::nouvelle();
    let service = service(faux.clone(), &horloge);

    pulse(&service);
    pulse(&service);
    assert!(appels_snapshot(&faux) == 1, "le second battement est no-op");
    horloge.avance_ms(2_001);
    pulse(&service);
    assert!(appels_snapshot(&faux) == 2, "le battement frappe à 2 s");
}

#[test]
fn l_horloge_reelle_est_utilisable_mais_independante_des_tests() {
    // Le contrat : l'horloge réelle rend des instants monotones qui
    // n'avancent pas dans le passé (sans dormir, juste la propriété).
    let reel = MaintenantReelle;
    let premier = reel.maintenant();
    let second = reel.maintenant();
    assert!(second >= premier);
}
