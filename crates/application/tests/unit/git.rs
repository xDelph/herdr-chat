//! Le lecteur de branches (T040, D21) : cache 30 s, argv fixe, un job par
//! cwd, exécuteur borné, délai qui tue le retardataire seul, capture bornée,
//! et les trois absences (pas de dépôt, délai, git absent) qui se confondent
//! en une branche ABSENTE.

use application::conversations::BrancheDeProjet;
use application::git::{GIT_CONCURRENTS, LanceGit, LecteurBranches, MAX_SORTIE, ProcessusGit};
use application::refresh::SourceMaintenant;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

/// L'horloge contrôlée — la fenêtre de cache se teste sans dormir.
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

/// Les mesures partagées du faux : le PIC des processus RETENUS (ceux dont
/// l'interrogation d'état est bloquée par la porte) — la mesure réelle de
/// l'exécuteur borné.
#[derive(Clone, Default)]
struct Mesures {
    en_vol: Arc<AtomicU64>,
    pic: Arc<AtomicU64>,
}

/// Un processus faux : un état scripté, une sortie, une PORTE pour retenir
/// la lecture, le compte des tués (le délai n'annule QUE le sien) et les
/// mesures partagées.
#[derive(Clone)]
struct FauxProcessus {
    etat: Option<i32>,
    sortie: String,
    tue: Arc<AtomicU64>,
    porte: Arc<(Mutex<bool>, Condvar)>,
    mesures: Mesures,
}

impl FauxProcessus {
    fn qui_sort(code: i32, sortie: &str) -> Self {
        Self {
            etat: Some(code),
            sortie: String::from(sortie),
            tue: Arc::new(AtomicU64::new(0)),
            porte: Arc::new((Mutex::new(true), Condvar::new())),
            mesures: Mesures::default(),
        }
    }

    fn qui_ne_sort_jamais() -> Self {
        Self {
            etat: None,
            sortie: String::new(),
            tue: Arc::new(AtomicU64::new(0)),
            porte: Arc::new((Mutex::new(true), Condvar::new())),
            mesures: Mesures::default(),
        }
    }
}

impl ProcessusGit for FauxProcessus {
    fn etat(&mut self) -> Option<i32> {
        self.mesures.en_vol.fetch_add(1, Ordering::SeqCst);
        self.mesures
            .pic
            .fetch_max(self.mesures.en_vol.load(Ordering::SeqCst), Ordering::SeqCst);
        // Porte fermée : le processus « tourne encore » (retient le job).
        let porte = self.porte.0.lock().unwrap_or_else(PoisonError::into_inner);
        let resultat = if *porte { self.etat } else { None };
        drop(porte);
        self.mesures.en_vol.fetch_sub(1, Ordering::SeqCst);
        resultat
    }

    fn tuer(&mut self) {
        self.tue.fetch_add(1, Ordering::SeqCst);
        // Le processus est mort : sa porte se rouvre (le poll suivant voit
        // un état — inutile ici, mais honnête).
        *self.porte.0.lock().unwrap_or_else(PoisonError::into_inner) = true;
    }

    fn sortie(&mut self, max: usize) -> Option<String> {
        Some(self.sortie.chars().take(max).collect())
    }
}

/// Le lanceur faux : un processus par dossier, le compte des lancements,
/// et les mesures partagées (le PIC des processus retenus).
#[derive(Clone, Default)]
struct FauxLanceur {
    processus: Arc<Mutex<BTreeMap<String, FauxProcessus>>>,
    lancements: Arc<AtomicU64>,
    mesures: Mesures,
}

impl FauxLanceur {
    fn avec(self, dossier: &str, processus: FauxProcessus) -> Self {
        let mut processus = processus;
        processus.mesures = self.mesures.clone();
        self.processus
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(String::from(dossier), processus);
        self
    }

    fn nombre_de_lancements(&self) -> u64 {
        self.lancements.load(Ordering::SeqCst)
    }
}

impl LanceGit for FauxLanceur {
    fn lance(&self, dossier: &str) -> Result<Box<dyn ProcessusGit>, String> {
        self.lancements.fetch_add(1, Ordering::SeqCst);
        let processus = self
            .processus
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(dossier)
            .cloned()
            .ok_or_else(|| String::from("git absent (faux)"))?;
        Ok(Box::new(processus))
    }
}

fn lecteur(lanceur: FauxLanceur, horloge: &MaintenantTest) -> LecteurBranches {
    LecteurBranches::nouveau(Box::new(lanceur), Arc::new(horloge.clone()))
}

#[test]
fn la_branche_est_mise_en_cache_trente_secondes() {
    // D21 : une branche ne change pas toutes les 4 s — dans la fenêtre,
    // zéro git de plus.
    let horloge = MaintenantTest::nouvelle();
    let lanceur = FauxLanceur::default().avec(
        "/projets/atelier",
        FauxProcessus::qui_sort(0, "plan/rust-backend\n"),
    );
    let lecteur = lecteur(lanceur.clone(), &horloge);
    let premiere = lecteur.branche("/projets/atelier");
    let seconde = lecteur.branche("/projets/atelier");
    assert_eq!(premiere.as_deref(), Some("plan/rust-backend"));
    assert_eq!(seconde, premiere, "servie depuis le cache");
    assert_eq!(lanceur.nombre_de_lancements(), 1, "un seul git");
    horloge.avance_ms(30_001);
    let tierce = lecteur.branche("/projets/atelier");
    assert_eq!(tierce.as_deref(), Some("plan/rust-backend"));
    assert_eq!(lanceur.nombre_de_lancements(), 2, "le TTL est passé");
}

#[test]
fn la_branche_change_apres_la_fenetre() {
    let horloge = MaintenantTest::nouvelle();
    let lanceur =
        FauxLanceur::default().avec("/projets/atelier", FauxProcessus::qui_sort(0, "main\n"));
    let lecteur = lecteur(lanceur.clone(), &horloge);
    assert_eq!(lecteur.branche("/projets/atelier").as_deref(), Some("main"));
    // Le changement de branche est visible après le TTL (une nouvelle
    // réponse du lanceur).
    horloge.avance_ms(30_001);
    lanceur
        .processus
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(
            String::from("/projets/atelier"),
            FauxProcessus::qui_sort(0, "feature/cache\n"),
        );
    assert_eq!(
        lecteur.branche("/projets/atelier").as_deref(),
        Some("feature/cache"),
        "le changement après TTL est visible"
    );
}

#[test]
fn le_code_non_zero_est_une_branche_absente() {
    // Pas de dépôt (128) : branche ABSENTE, pas une erreur.
    let horloge = MaintenantTest::nouvelle();
    let lanceur = FauxLanceur::default().avec(
        "/projets/atelier",
        FauxProcessus::qui_sort(128, "fatal: not a git repository\n"),
    );
    let lecteur = lecteur(lanceur.clone(), &horloge);
    assert_eq!(lecteur.branche("/projets/atelier"), None);
    // L'absence EST mise en cache (pas de re-git dans la fenêtre).
    let _ = lecteur.branche("/projets/atelier");
    assert_eq!(lanceur.nombre_de_lancements(), 1);
}

#[test]
fn le_head_detache_et_la_sortie_vide_sont_absents() {
    let horloge = MaintenantTest::nouvelle();
    let lanceur = FauxLanceur::default()
        .avec("/projets/detache", FauxProcessus::qui_sort(0, "HEAD\n"))
        .avec("/projets/vide", FauxProcessus::qui_sort(0, "  \n"));
    let lecteur = lecteur(lanceur.clone(), &horloge);
    assert_eq!(
        lecteur.branche("/projets/detache"),
        None,
        "HEAD détaché n'est pas une branche"
    );
    assert_eq!(lecteur.branche("/projets/vide"), None, "sortie vide");
}

#[test]
fn la_capture_est_bornee_a_4096() {
    let horloge = MaintenantTest::nouvelle();
    let longue = "x".repeat(10_000);
    let lanceur =
        FauxLanceur::default().avec("/projets/verbeux", FauxProcessus::qui_sort(0, &longue));
    let lecteur = lecteur(lanceur.clone(), &horloge);
    let branche = lecteur.branche("/projets/verbeux");
    assert!(
        branche.as_ref().map(String::len).unwrap_or(0) <= MAX_SORTIE,
        "la capture ne dépasse jamais {MAX_SORTIE}"
    );
}

#[test]
fn le_delai_annule_le_job_retardataire_et_lui_seul() {
    // D21 : un processus qui ne sort pas est tué au délai ; le voisin,
    // sain, rend sa branche — le kill n'a touché QUE le retardataire.
    let horloge = MaintenantTest::nouvelle();
    let lent = FauxProcessus::qui_ne_sort_jamais();
    let tue = lent.tue.clone();
    let lanceur = FauxLanceur::default()
        .avec("/projets/lent", lent)
        .avec("/projets/sain", FauxProcessus::qui_sort(0, "main\n"));
    let lecteur = LecteurBranches::avec_delai(
        Box::new(lanceur.clone()),
        Arc::new(horloge.clone()),
        Duration::from_millis(60),
    );
    let debut = Instant::now();
    assert_eq!(lecteur.branche("/projets/lent"), None, "délai → absent");
    assert!(
        debut.elapsed() < Duration::from_secs(1),
        "le délai raccourci a bien tranché"
    );
    assert_eq!(
        tue.load(Ordering::SeqCst),
        1,
        "le retardataire a été tué exactement une fois"
    );
    assert_eq!(
        lecteur.branche("/projets/sain").as_deref(),
        Some("main"),
        "le voisin n'a pas été touché"
    );
    assert_eq!(tue.load(Ordering::SeqCst), 1, "toujours UN seul tué");
}

#[test]
fn la_panne_du_lanceur_est_une_branche_absente() {
    // Git absent : le lanceur échoue, la branche reste absente.
    let horloge = MaintenantTest::nouvelle();
    let lecteur = lecteur(FauxLanceur::default(), &horloge);
    assert_eq!(lecteur.branche("/projets/inconnu"), None);
}

#[test]
fn un_seul_job_par_dossier_concurrent() {
    // TECH §4 : deux demandes simultanées du même dossier partagent le
    // processus — un seul lancement, deux réponses identiques.
    let horloge = MaintenantTest::nouvelle();
    let retenu = FauxProcessus::qui_sort(0, "plan/rust-backend\n");
    *retenu
        .porte
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = false;
    let porte = retenu.porte.clone();
    let lanceur = FauxLanceur::default().avec("/projets/atelier", retenu);
    let lecteur = Arc::new(LecteurBranches::avec_delai(
        Box::new(lanceur.clone()),
        Arc::new(horloge.clone()),
        Duration::from_secs(1),
    ));

    let premier = {
        let lecteur = Arc::clone(&lecteur);
        std::thread::spawn(move || lecteur.branche("/projets/atelier"))
    };
    // Le premier job est en vol (porte fermée). Le second arrive pendant.
    std::thread::sleep(Duration::from_millis(50));
    let second = {
        let lecteur = Arc::clone(&lecteur);
        std::thread::spawn(move || lecteur.branche("/projets/atelier"))
    };
    std::thread::sleep(Duration::from_millis(50));
    // Le processus sort : le premier rend la branche, le second la reçoit
    // du cache (aucun second lancement).
    *porte.0.lock().unwrap_or_else(PoisonError::into_inner) = true;
    porte.1.notify_all();
    let premiere = premier.join().unwrap_or_else(|_| panic!("premier joint"));
    let seconde = second.join().unwrap_or_else(|_| panic!("second joint"));
    assert_eq!(premiere.as_deref(), Some("plan/rust-backend"));
    assert_eq!(seconde, premiere);
    assert_eq!(
        lanceur.nombre_de_lancements(),
        1,
        "UN job pour deux demandes concurrentes"
    );
}

#[test]
fn l_executeur_borne_les_processus_simultanes() {
    // L'exécuteur borné : six dossiers, au plus GIT_CONCURRENTS processus
    // en même temps — le PIC derrière la porte.
    let horloge = MaintenantTest::nouvelle();
    let mut lanceur = FauxLanceur::default();
    let mut portes = Vec::new();
    for index in 1..=6 {
        let dossier = format!("/projets/p{index}");
        let processus = FauxProcessus::qui_sort(0, "main\n");
        *processus
            .porte
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = false;
        portes.push(processus.porte.clone());
        lanceur = lanceur.avec(&dossier, processus);
    }
    let pic = lanceur.mesures.pic.clone();
    let lecteur = Arc::new(LecteurBranches::avec_delai(
        Box::new(lanceur),
        Arc::new(horloge.clone()),
        Duration::from_secs(1),
    ));
    let mut porteurs = Vec::new();
    for index in 1..=6 {
        let lecteur = Arc::clone(&lecteur);
        porteurs.push(std::thread::spawn(move || {
            lecteur.branche(&format!("/projets/p{index}"))
        }));
    }
    std::thread::sleep(Duration::from_millis(150));
    for porte in &portes {
        *porte.0.lock().unwrap_or_else(PoisonError::into_inner) = true;
        porte.1.notify_all();
    }
    for porteur in porteurs {
        assert_eq!(
            porteur
                .join()
                .unwrap_or_else(|_| panic!("porteur joint"))
                .as_deref(),
            Some("main")
        );
    }
    let pic = pic.load(Ordering::SeqCst);
    assert!(
        pic <= GIT_CONCURRENTS as u64 && pic >= 1,
        "l'exécuteur plafonne à {GIT_CONCURRENTS}, pic = {pic}"
    );
}

#[test]
fn le_cache_est_purge_des_entrees_expirees() {
    let horloge = MaintenantTest::nouvelle();
    let lanceur = FauxLanceur::default()
        .avec("/projets/a", FauxProcessus::qui_sort(0, "main\n"))
        .avec("/projets/b", FauxProcessus::qui_sort(0, "main\n"));
    let lecteur = lecteur(lanceur.clone(), &horloge);
    let _ = lecteur.branche("/projets/a");
    let _ = lecteur.branche("/projets/b");
    assert_eq!(lecteur.nb_entrees_cache(), 2);
    horloge.avance_ms(31_000);
    // La lecture suivante purge TOUTES les entrées expirées (a et b),
    // puis re-cache a.
    let _ = lecteur.branche("/projets/a");
    assert_eq!(lecteur.nb_entrees_cache(), 1, "b purgée, a re-ajoutée");
    let _ = lecteur.branche("/projets/b");
    assert_eq!(lecteur.nb_entrees_cache(), 2);
}

#[test]
fn le_lecteur_est_une_branche_de_projet() {
    // Le câblage T039→T040 : le lecteur EST la branche injectée de la liste.
    let horloge = MaintenantTest::nouvelle();
    let lanceur = FauxLanceur::default().avec(
        "/projets/atelier",
        FauxProcessus::qui_sort(0, "plan/rust-backend\n"),
    );
    let lecteur = lecteur(lanceur.clone(), &horloge);
    let branche: &dyn BrancheDeProjet = &lecteur;
    assert_eq!(
        branche.branche("/projets/atelier").as_deref(),
        Some("plan/rust-backend")
    );
}
