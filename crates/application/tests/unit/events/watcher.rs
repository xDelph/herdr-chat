//! Le veilleur d'agents (T041, E01–E03, E06) : pas de rafale initiale,
//! diff par signature, identité conservée à la disparition, panne ≠
//! disparition, transitions de notification — le tout sur horloge fake.
//! Prouve : E02.

use application::events::watcher::{
    BoucleDeVeille, CibleDeChangement, GenreDeChangement, PublicateurDeChangements, SourceDeVues,
    Veilleur, faut_notifier, revision_absente,
};
use application::refresh::SourceMaintenant;
use domain::ids::{AgentKind, PaneId, TabId, WorkspaceId};
use domain::observation::AgentView;
use domain::status::AgentStatus;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// L'horloge contrôlée — le dernier succès se vérifie sans dormir.
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

/// La vue d'un agent, avec les seuls champs que la signature lit.
fn vue(pane: &str, statut: AgentStatus, titre: &str, cwd: &str) -> AgentView {
    AgentView {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from("t1")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        agent: Some(AgentKind::from(String::from("pi"))),
        status: statut,
        focused: false,
        name: None,
        title: Some(String::from(titre)),
        cwd: Some(String::from(cwd)),
        tab_label: None,
        tab_number: Some(1),
        workspace_label: None,
        pane_rank: Some(0),
        tab_pane_count: 1,
        session_kind: None,
        session_path: Some(format!("/sessions/{pane}.jsonl")),
        session_id: None,
        session_cwd: None,
        parent_session: None,
        session_cwd_matches: domain::observation::CwdMatch::Unverifiable,
    }
}

fn pane_id(pane: &str) -> PaneId {
    PaneId::from(String::from(pane))
}

// ─────────────────────────── le diff (E02, E03) ───────────────────────────

#[test]
fn le_premier_tour_n_annonce_rien() {
    // E03 : pas de rafale initiale — un démarrage ne dit pas que tout le
    // parc est « apparu ».
    let veilleur = Veilleur::nouveau();
    let tour = veilleur.tick(vec![vue("p1", AgentStatus::Working, "t", "/p")]);
    assert!(tour.changements.is_empty(), "premier parcours muet");
    // Un second tour identique reste muet (aucun changement).
    let tour = veilleur.tick(vec![vue("p1", AgentStatus::Working, "t", "/p")]);
    assert!(tour.changements.is_empty(), "inchangé → rien");
}

#[test]
fn une_apparition_est_annoncee_apres_le_premier_tour() {
    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![vue("p1", AgentStatus::Idle, "t", "/p")]);
    let tour = veilleur.tick(vec![
        vue("p1", AgentStatus::Idle, "t", "/p"),
        vue("p2", AgentStatus::Working, "t", "/p"),
    ]);
    assert_eq!(tour.changements.len(), 1);
    let changement = &tour.changements[0];
    assert_eq!(changement.pane_id, pane_id("p2"));
    assert_eq!(changement.genre, GenreDeChangement::Apparu);
    assert_eq!(changement.de, None);
    assert_eq!(
        changement.a,
        CibleDeChangement::Statut(AgentStatus::Working)
    );
}

#[test]
fn un_changement_de_statut_est_annonce() {
    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![vue("p1", AgentStatus::Working, "t", "/p")]);
    let tour = veilleur.tick(vec![vue("p1", AgentStatus::Blocked, "t", "/p")]);
    assert_eq!(tour.changements.len(), 1);
    let changement = &tour.changements[0];
    assert_eq!(changement.genre, GenreDeChangement::Statut);
    assert_eq!(changement.de, Some(AgentStatus::Working));
    assert_eq!(
        changement.a,
        CibleDeChangement::Statut(AgentStatus::Blocked)
    );
}

#[test]
fn un_changement_de_metadonnees_est_annonce_meme_statut() {
    // E02 : un changement de titre change la signature — le statut peut
    // rester identique de→vers, c'est voulu.
    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![vue("p1", AgentStatus::Working, "ancien", "/p")]);
    let tour = veilleur.tick(vec![vue("p1", AgentStatus::Working, "nouveau", "/p")]);
    assert_eq!(tour.changements.len(), 1);
    let changement = &tour.changements[0];
    assert_eq!(changement.de, Some(AgentStatus::Working));
    assert_eq!(
        changement.a,
        CibleDeChangement::Statut(AgentStatus::Working)
    );
}

#[test]
fn une_disparition_garde_l_identite_et_le_statut() {
    // E03 : l'agent disparu porte sa dernière vue — la notification peut le
    // nommer, et le diff sait d'où il venait.
    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![vue("p1", AgentStatus::Blocked, "t", "/p")]);
    let tour = veilleur.tick(Vec::new());
    assert_eq!(tour.changements.len(), 1);
    let changement = &tour.changements[0];
    assert_eq!(changement.genre, GenreDeChangement::Disparu);
    assert_eq!(changement.de, Some(AgentStatus::Blocked));
    assert_eq!(changement.a, CibleDeChangement::Disparu);
    let disparu = changement
        .disparu
        .as_ref()
        .unwrap_or_else(|| panic!("la dernière vue est conservée"));
    assert_eq!(disparu.pane_id, pane_id("p1"));
    assert_eq!(disparu.status, AgentStatus::Blocked);
}

#[test]
fn un_agent_reapparu_est_annonce_comme_apparu() {
    // Disparition puis retour (pendant que d'autres agents restent) : le
    // diff le voit réapparaître — le précédent n'existe plus.
    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![
        vue("p1", AgentStatus::Idle, "t", "/p"),
        vue("p2", AgentStatus::Idle, "t", "/p"),
    ]);
    let _ = veilleur.tick(vec![vue("p2", AgentStatus::Idle, "t", "/p")]);
    let tour = veilleur.tick(vec![
        vue("p1", AgentStatus::Working, "t", "/p"),
        vue("p2", AgentStatus::Idle, "t", "/p"),
    ]);
    assert_eq!(tour.changements.len(), 1);
    assert_eq!(tour.changements[0].genre, GenreDeChangement::Apparu);
    assert_eq!(tour.changements[0].de, None);
}

#[test]
fn la_reapparition_apres_disparition_totale_est_muette() {
    // E03, mesuré sur le fil : `before.size > 0` — quand le parc précédent
    // est VIDE, un retour est traité comme un premier parcours (pas de
    // rafale). Une disparition totale puis un retour ne ré-annonce rien.
    let veilleur = Veilleur::nouveau();
    let _ = veilleur.tick(vec![vue("p1", AgentStatus::Idle, "t", "/p")]);
    let _ = veilleur.tick(Vec::new());
    let tour = veilleur.tick(vec![vue("p1", AgentStatus::Working, "t", "/p")]);
    assert!(tour.changements.is_empty(), "parc vide → premier passage");
}

// ─────────────────────── les transitions de notification (E06) ───────────────────────

#[test]
fn working_vers_tout_autre_statut_notifie() {
    for cible in [
        AgentStatus::Idle,
        AgentStatus::Blocked,
        AgentStatus::Done,
        AgentStatus::Unknown,
    ] {
        assert!(
            faut_notifier(Some(AgentStatus::Working), CibleDeChangement::Statut(cible)),
            "working → {cible} doit notifier"
        );
    }
    assert!(
        !faut_notifier(
            Some(AgentStatus::Working),
            CibleDeChangement::Statut(AgentStatus::Working)
        ),
        "working → working ne notifie pas"
    );
}

#[test]
fn seuls_working_et_blocked_disparus_notifient() {
    assert!(faut_notifier(
        Some(AgentStatus::Working),
        CibleDeChangement::Disparu
    ));
    assert!(faut_notifier(
        Some(AgentStatus::Blocked),
        CibleDeChangement::Disparu
    ));
    // Une fin normale (idle/done qu'on ferme) n'est pas du bruit.
    assert!(!faut_notifier(
        Some(AgentStatus::Idle),
        CibleDeChangement::Disparu
    ));
    assert!(!faut_notifier(
        Some(AgentStatus::Done),
        CibleDeChangement::Disparu
    ));
    assert!(!faut_notifier(
        Some(AgentStatus::Unknown),
        CibleDeChangement::Disparu
    ));
    assert!(!faut_notifier(None, CibleDeChangement::Disparu));
}

#[test]
fn un_etat_inchange_ne_notifie_pas() {
    assert!(!faut_notifier(
        Some(AgentStatus::Idle),
        CibleDeChangement::Statut(AgentStatus::Idle)
    ));
    assert!(!faut_notifier(
        Some(AgentStatus::Done),
        CibleDeChangement::Statut(AgentStatus::Done)
    ));
    assert!(!faut_notifier(
        None,
        CibleDeChangement::Statut(AgentStatus::Working)
    ));
}

// ─────────────────────────── la boucle (E01, E06) ───────────────────────────

/// La source fausse : une file scriptée de résultats (le dernier se répète),
/// une porte pour retenir une lecture, et le pic des lectures simultanées
/// (la propriété « une itération à la fois »).
struct FauxSource {
    vues: Mutex<VecDeque<Result<Vec<AgentView>, String>>>,
    derniere: Mutex<Option<Result<Vec<AgentView>, String>>>,
    lectures: AtomicU64,
    en_lecture: AtomicU64,
    pic: Arc<AtomicU64>,
    porte: Arc<(Mutex<bool>, Condvar)>,
}

impl FauxSource {
    fn qui_rend(agents: Vec<AgentView>) -> Self {
        Self {
            vues: Mutex::new(VecDeque::from([Ok(agents)])),
            derniere: Mutex::new(None),
            lectures: AtomicU64::new(0),
            en_lecture: AtomicU64::new(0),
            pic: Arc::new(AtomicU64::new(0)),
            porte: Arc::new((Mutex::new(true), Condvar::new())),
        }
    }

    fn scriptee(resultats: Vec<Result<Vec<AgentView>, String>>) -> Self {
        let source = Self::qui_rend(Vec::new());
        *source.vues.lock().unwrap_or_else(PoisonError::into_inner) = VecDeque::from(resultats);
        source
    }
}

impl SourceDeVues for FauxSource {
    fn vues(&self) -> Result<Vec<AgentView>, String> {
        self.lectures.fetch_add(1, Ordering::SeqCst);
        self.en_lecture.fetch_add(1, Ordering::SeqCst);
        self.pic
            .fetch_max(self.en_lecture.load(Ordering::SeqCst), Ordering::SeqCst);
        let porte = self.porte.0.lock().unwrap_or_else(PoisonError::into_inner);
        let resultat = if *porte {
            let mut vues = self.vues.lock().unwrap_or_else(PoisonError::into_inner);
            let prochaine = vues.pop_front();
            match prochaine {
                Some(resultat) => {
                    *self.derniere.lock().unwrap_or_else(PoisonError::into_inner) =
                        Some(resultat.clone());
                    resultat
                }
                None => self
                    .derniere
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone()
                    .unwrap_or_else(|| panic!("plus de vues scriptées")),
            }
        } else {
            Err(String::from("porte fermée"))
        };
        drop(porte);
        self.en_lecture.fetch_sub(1, Ordering::SeqCst);
        resultat
    }
}

/// Le publicateur faux : il capture les changements publiés.
#[derive(Default)]
struct FauxPublicateur {
    publies: Mutex<Vec<usize>>,
}

impl PublicateurDeChangements for FauxPublicateur {
    fn publie(&self, changements: &[application::events::watcher::Changement]) {
        self.publies
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(changements.len());
    }
}

fn boucle(
    source: Arc<dyn SourceDeVues>,
    veilleur: Arc<Veilleur>,
    publicateur: Arc<dyn PublicateurDeChangements>,
    horloge: MaintenantTest,
) -> BoucleDeVeille {
    BoucleDeVeille::nouvelle(source, veilleur, publicateur, Arc::new(horloge))
}

#[test]
fn la_panne_n_est_pas_une_disparition_et_le_retablissement_repart_de_la_derniere_vue() {
    // E06 : une source injoignable compte une erreur et ne vide pas le parc —
    // aucun changement publié, les dernières vues restent ; au
    // rétablissement, le diff repart de la DERNIÈRE vue réussie (un agent
    // réellement nouveau est annoncé, jamais la masse).
    let horloge = MaintenantTest::nouvelle();
    let veilleur = Arc::new(Veilleur::nouveau());
    let publicateur = Arc::new(FauxPublicateur::default());
    let source = Arc::new(FauxSource::scriptee(vec![
        Ok(vec![vue("p1", AgentStatus::Working, "t", "/p")]),
        Err(String::from("Herdr injoignable")),
        Ok(vec![
            vue("p1", AgentStatus::Working, "t", "/p"),
            vue("p2", AgentStatus::Idle, "t", "/p"),
        ]),
    ]));
    let boucle = boucle(source, veilleur, publicateur.clone(), horloge);

    // 1) Premier tour : p1, rien à annoncer, cache rempli.
    let _ = boucle.une_fois();
    assert_eq!(boucle.derniers_agents().len(), 1);
    assert!(boucle.dernier_succes().is_some());

    // 2) La panne : une erreur comptée, AUCUNE publication nouvelle (le
    //    premier tour a publié son tour vide), le parc n'est pas vidé.
    let resultat = boucle.une_fois();
    assert!(resultat.is_err());
    assert_eq!(boucle.erreurs(), 1);
    assert_eq!(
        publicateur
            .publies
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len(),
        1,
        "la panne n'a rien publié de plus"
    );

    // 3) Le rétablissement : SEUL p2 apparaît — p1, inchangé, n'est pas
    //    ré-annoncé, et rien ne ressemble à une disparition de masse.
    let tour = boucle
        .une_fois()
        .unwrap_or_else(|_| panic!("le rétablissement réussit"));
    assert_eq!(tour.changements.len(), 1);
    assert_eq!(tour.changements[0].genre, GenreDeChangement::Apparu);
    assert_eq!(tour.changements[0].pane_id, pane_id("p2"));
}

#[test]
fn le_dernier_succes_et_les_agents_sont_caches() {
    // E01 : le cache du direct — dernières vues, instant du dernier succès.
    let horloge = MaintenantTest::nouvelle();
    let source = Arc::new(FauxSource::qui_rend(vec![vue(
        "p1",
        AgentStatus::Working,
        "t",
        "/p",
    )]));
    let publicateur = Arc::new(FauxPublicateur::default());
    let boucle = boucle(
        source,
        Arc::new(Veilleur::nouveau()),
        publicateur,
        horloge.clone(),
    );
    assert!(
        boucle.dernier_succes().is_none(),
        "aucun succès avant le premier tour"
    );
    horloge.avance_ms(5_000);
    let _ = boucle.une_fois();
    assert_eq!(boucle.derniers_agents().len(), 1);
    assert_eq!(
        boucle.dernier_succes(),
        Some(horloge.maintenant()),
        "l'instant du succès porte l'horloge injectée"
    );
}

#[test]
fn la_boucle_attend_apres_une_iteration_complete() {
    // E01 : une itération complète, PUIS l'attente — jamais deux lectures en
    // même temps, même avec une cadence plus courte que la lecture.
    let horloge = MaintenantTest::nouvelle();
    let source = Arc::new(FauxSource::qui_rend(vec![vue(
        "p1",
        AgentStatus::Working,
        "t",
        "/p",
    )]));
    *source
        .porte
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = false;
    let pic = source.pic.clone();
    let porte = source.porte.clone();
    let publicateur = Arc::new(FauxPublicateur::default());
    let source_trait: Arc<dyn SourceDeVues> = source.clone();
    let boucle = Arc::new(BoucleDeVeille::avec_intervalle(
        source_trait,
        Arc::new(Veilleur::nouveau()),
        publicateur,
        Arc::new(horloge),
        Duration::from_millis(20),
    ));
    // La porte fermée fait échouer la lecture : la boucle compte des erreurs
    // et continue — jamais deux lectures simultanées.
    let fil = {
        let boucle = Arc::clone(&boucle);
        std::thread::spawn(move || boucle.boucle())
    };
    std::thread::sleep(Duration::from_millis(120));
    let lectures = source.lectures.load(Ordering::SeqCst);
    assert!(lectures >= 2, "la boucle tourne malgré les pannes");
    assert_eq!(
        pic.load(Ordering::SeqCst),
        1,
        "une seule lecture à la fois (l'itération complète précède l'attente)"
    );
    *porte.0.lock().unwrap_or_else(PoisonError::into_inner) = true;
    porte.1.notify_all();
    boucle.arreter();
    fil.join().unwrap_or_else(|_| panic!("la boucle s'arrête"));
}

#[test]
fn la_boucle_publie_les_changements_des_tours_reussis() {
    // E01 : chaque itération réussie publie ses changements au publicateur.
    let horloge = MaintenantTest::nouvelle();
    let source = Arc::new(FauxSource::qui_rend(vec![vue(
        "p1",
        AgentStatus::Working,
        "t",
        "/p",
    )]));
    let publicateur = Arc::new(FauxPublicateur::default());
    let boucle = boucle(
        source,
        Arc::new(Veilleur::nouveau()),
        publicateur.clone(),
        horloge,
    );
    let _ = boucle.une_fois();
    let _ = boucle.une_fois();
    let publies = publicateur
        .publies
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    assert_eq!(publies.len(), 2, "deux tours, deux publications");
    assert_eq!(publies[0], 0, "premier tour muet (pas de rafale)");
    assert_eq!(publies[1], 0, "second tour inchangé");
}

#[test]
fn la_signature_distingue_les_champs_du_contrat() {
    // E02 : la signature couvre statut, titre, cwd, type et session — un
    // changement de session suffit à émettre.
    let veilleur = Veilleur::nouveau();
    let mut premier = vue("p1", AgentStatus::Working, "t", "/p");
    let _ = veilleur.tick(vec![premier.clone()]);
    premier.session_path = Some(String::from("/sessions/autre.jsonl"));
    let tour = veilleur.tick(vec![premier]);
    assert_eq!(
        tour.changements.len(),
        1,
        "la session a changé la signature"
    );
}

// ──────────────── la source de session (T053, C26) ────────────────

#[test]
fn la_source_change_quand_le_chemin_change() {
    // Le pane publie d'abord un chemin, puis un AUTRE : le chat doit être
    // invalidé (le fichier lu n'est plus le même).
    let veilleur = Veilleur::nouveau();
    veilleur.tick(vec![vue("w1:p1", AgentStatus::Idle, "un", "/a")]);
    let mut nouvelle = vue("w1:p1", AgentStatus::Idle, "un", "/a");
    nouvelle.session_path = Some(String::from("/sessions/autre.jsonl"));
    let tour = veilleur.tick(vec![nouvelle]);
    assert_eq!(tour.changements.len(), 1);
    let changement = &tour.changements[0];
    assert!(
        changement.source_change(),
        "un autre chemin = une autre source"
    );
    // ⚠️ La révision est OPAQUE : aucun chemin ne sort du veilleur (TECH §7),
    // et deux sources différentes donnent deux révisions différentes.
    assert_ne!(changement.revision_avant, changement.revision_apres);
    assert_eq!(changement.revision_avant.len(), 16);
    assert_eq!(changement.revision_apres.len(), 16);
    assert!(
        !changement.revision_apres.contains('/'),
        "aucun chemin dans la révision"
    );
}

#[test]
fn une_source_inchangee_ne_publie_rien_de_plus() {
    // Un changement de statut sans changement de source : `session_changed`
    // ne doit PAS être émis (il n'y a rien à invalider).
    let veilleur = Veilleur::nouveau();
    veilleur.tick(vec![vue("w1:p1", AgentStatus::Working, "un", "/a")]);
    let tour = veilleur.tick(vec![vue("w1:p1", AgentStatus::Done, "un", "/a")]);
    assert_eq!(tour.changements.len(), 1);
    assert!(!tour.changements[0].source_change());
}

#[test]
fn une_apparition_publie_la_source_quand_elle_existe() {
    let veilleur = Veilleur::nouveau();
    // Le premier tour établit le parc (aucune publication, E03).
    veilleur.tick(vec![vue("w1:p1", AgentStatus::Idle, "un", "/a")]);
    // Un nouvel agent : il apparaît, et sa source est une information neuve.
    let tour = veilleur.tick(vec![
        vue("w1:p1", AgentStatus::Idle, "un", "/a"),
        vue("w1:p2", AgentStatus::Working, "deux", "/b"),
    ]);
    let apparu = tour
        .changements
        .iter()
        .find(|changement| changement.genre == GenreDeChangement::Apparu)
        .unwrap_or_else(|| panic!("un agent apparaît"));
    assert!(
        apparu.source_change(),
        "la révision d'absence cède la place à une source"
    );
    assert_ne!(apparu.revision_apres, revision_absente());
}

#[test]
fn une_disparition_eteint_la_source() {
    let veilleur = Veilleur::nouveau();
    veilleur.tick(vec![vue("w1:p1", AgentStatus::Working, "un", "/a")]);
    let tour = veilleur.tick(Vec::new());
    assert_eq!(tour.changements.len(), 1);
    let disparu = &tour.changements[0];
    assert_eq!(disparu.genre, GenreDeChangement::Disparu);
    assert!(disparu.source_change(), "la source s'éteint avec l'agent");
    assert_eq!(disparu.revision_apres, revision_absente());
}

#[test]
fn la_revision_est_stable_et_ne_transporte_aucun_chemin() {
    let vue_a = vue("w1:p1", AgentStatus::Idle, "un", "/a");
    let meme = vue("w1:p1", AgentStatus::Working, "autre titre", "/b");
    // Même source (même session_path) : MÊME révision, malgré un statut et un
    // titre différents — c'est ce qui rend le coalescing possible.
    assert_eq!(revision_absente(), revision_absente());
    assert_ne!(
        revision_absente(),
        application::events::watcher::revision_de(&vue_a)
    );
    assert_eq!(
        application::events::watcher::revision_de(&vue_a),
        application::events::watcher::revision_de(&meme)
    );
    // Un identifiant de session compte comme une identité de source.
    let mut par_id = vue("w1:p1", AgentStatus::Idle, "un", "/a");
    par_id.session_path = None;
    par_id.session_id = Some(domain::ids::SessionId::from(String::from("sess-1")));
    assert_ne!(
        application::events::watcher::revision_de(&par_id),
        application::events::watcher::revision_de(&vue_a)
    );
}

#[test]
fn la_revision_change_quand_le_fichier_grandit() {
    // ⚠️ **Le défaut qui privait la PWA de direct.** La révision ne hachait que
    // l'identité de la source : constante pour une session donnée, donc
    // `session_changed` n'était publié qu'à l'apparition de la session — aucun
    // message n'arrivait ensuite en direct.
    let racine = std::env::temp_dir().join(format!("revision-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&racine);
    let chemin = racine.join("s.jsonl");
    let _ = std::fs::write(&chemin, b"{\"n\":1}\n");
    let mut vue = vue("w1:p1", AgentStatus::Idle, "titre", "/projet");
    vue.session_path = Some(chemin.to_string_lossy().to_string());
    let avant = application::events::watcher::revision_de(&vue);

    let mut fichier = std::fs::OpenOptions::new()
        .append(true)
        .open(&chemin)
        .unwrap_or_else(|cause| panic!("ouverture : {cause}"));
    use std::io::Write as _;
    fichier
        .write_all(b"{\"n\":2}\n")
        .unwrap_or_else(|cause| panic!("ecriture : {cause}"));
    drop(fichier);

    let apres = application::events::watcher::revision_de(&vue);
    assert_ne!(avant, apres, "la révision doit suivre le CONTENU");
    assert_eq!(apres.len(), 16, "16 hexadécimaux, opaque");
    assert!(!apres.contains("s.jsonl"), "aucun chemin dans la révision");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn la_revision_ne_bouge_pas_sans_ecriture() {
    // Deux observations du même fichier stable donnent la même révision : sinon
    // on publierait un événement à chaque tour de veille.
    let racine = std::env::temp_dir().join(format!("revision-stable-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&racine);
    let chemin = racine.join("s.jsonl");
    let _ = std::fs::write(&chemin, b"{\"n\":1}\n");
    let mut vue = vue("w1:p1", AgentStatus::Idle, "titre", "/projet");
    vue.session_path = Some(chemin.to_string_lossy().to_string());
    assert_eq!(
        application::events::watcher::revision_de(&vue),
        application::events::watcher::revision_de(&vue)
    );
    let _ = std::fs::remove_dir_all(&racine);
}
