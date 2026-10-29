//! La liste des conversations (T039, D18–D20) : une ligne par pane visible
//! même sans session, erreur d'une session isolée (les autres lignes
//! restent), permis à 4 lectures, invitation mesurée à l'écran (question /
//! confiance / attente), branche du dossier du pane.

use application::conversations::{
    BrancheDeProjet, CompteTaches, ConfianceRequise, EntreeLu, ErreurDeLecture, GenreDeLigne,
    GenreTache, IssueTaches, LitSessions, MAX_SESSION_READS, OutilAppele, RoleDeSession,
    ServiceConversations, StatutTache, TacheDeFond,
};
use application::overview::{ResoutSessions, SourceDeSession};
use application::state::ObservationBorne;
use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::observation::{
    AgentObservation, ScreenObservation, SessionRefKind, Snapshot, TabObservation,
    WorkspaceObservation,
};
use domain::status::{AgentStatus, SessionState};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};
use test_support::fake_herdr::{HerdrFaux, Op};

/// Le faux lecteur de sessions : sources et fenêtres par pane, avec une
/// PORTE pour mesurer le permis (le PIC des lectures en vol). La porte est
/// OUVERTE par défaut — seul le test du permis la retient.
#[derive(Debug, Clone)]
struct FauxSessions {
    sources: BTreeMap<PaneId, Option<SourceDeSession>>,
    lectures: BTreeMap<PaneId, Result<Vec<EntreeLu>, ErreurDeLecture>>,
    en_vol: Arc<AtomicU64>,
    pic: Arc<AtomicU64>,
    porte: Arc<(Mutex<bool>, Condvar)>,
    /// Les tâches de fond rendues pour toute source — `None` : capacité
    /// absente (la famille n'en expose pas).
    taches: Option<Result<Vec<TacheDeFond>, String>>,
}

impl FauxSessions {
    fn nouveau() -> Self {
        Self {
            sources: BTreeMap::new(),
            lectures: BTreeMap::new(),
            en_vol: Arc::new(AtomicU64::new(0)),
            pic: Arc::new(AtomicU64::new(0)),
            porte: Arc::new((Mutex::new(true), Condvar::new())),
            taches: None,
        }
    }

    fn avec_taches(mut self, taches: Result<Vec<TacheDeFond>, String>) -> Self {
        self.taches = Some(taches);
        self
    }

    fn avec_source(mut self, pane: &str, source: SourceDeSession) -> Self {
        self.sources
            .insert(PaneId::from(String::from(pane)), Some(source));
        self
    }

    fn avec_lecture(mut self, pane: &str, lu: Result<Vec<EntreeLu>, ErreurDeLecture>) -> Self {
        self.lectures.insert(PaneId::from(String::from(pane)), lu);
        self
    }

    fn ferme_la_porte(&self) {
        *self.porte.0.lock().unwrap_or_else(PoisonError::into_inner) = false;
    }
}

impl ResoutSessions for FauxSessions {
    fn source_de(&self, agent: &AgentObservation) -> Option<SourceDeSession> {
        self.sources.get(&agent.pane_id).cloned().flatten()
    }
}

impl LitSessions for FauxSessions {
    fn fenetre(
        &self,
        pane: &PaneId,
        _source: &SourceDeSession,
    ) -> Result<Vec<EntreeLu>, ErreurDeLecture> {
        let en_vol = self.en_vol.fetch_add(1, Ordering::SeqCst) + 1;
        self.pic.fetch_max(en_vol, Ordering::SeqCst);
        // Porte fermée : la lecture reste bloquée EN LA COMPTANT — le pic
        // devient le nombre de lectures réellement ouvertes en même temps.
        let mut verrou = self.porte.0.lock().unwrap_or_else(PoisonError::into_inner);
        while !*verrou {
            verrou = self
                .porte
                .1
                .wait(verrou)
                .unwrap_or_else(PoisonError::into_inner);
        }
        drop(verrou);
        self.en_vol.fetch_sub(1, Ordering::SeqCst);
        match self.lectures.get(pane) {
            Some(Ok(entrees)) => Ok(entrees.clone()),
            Some(Err(panne)) => Err(panne.clone()),
            None => Ok(Vec::new()),
        }
    }

    fn taches(&self, _source: &SourceDeSession) -> Option<Result<Vec<TacheDeFond>, String>> {
        self.taches.clone()
    }

    fn transcription_de_tache(&self, source: &SourceDeSession, id: &str) -> Option<String> {
        let taches = self.taches.clone()?.ok()?;
        taches
            .iter()
            .any(|tache| tache.id == id && tache.transcription)
            .then(|| format!("{}/{id}.jsonl", source.base.clone().unwrap_or_default()))
    }
}

/// La branche : une table simple par cwd.
fn branche_simple(cwd: &str, branche: &str) -> std::sync::Arc<dyn BrancheDeProjet> {
    #[derive(Clone)]
    struct Simple(String, String);
    impl BrancheDeProjet for Simple {
        fn branche(&self, cwd: &str) -> Option<String> {
            (cwd == self.0).then(|| self.1.clone())
        }
    }
    std::sync::Arc::new(Simple(String::from(cwd), String::from(branche)))
}

fn agent(
    pane: &str,
    kind: Option<&str>,
    status: AgentStatus,
    name: Option<&str>,
) -> AgentObservation {
    AgentObservation {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from("t1")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        terminal_id: String::from("term"),
        revision: 1,
        status,
        focused: false,
        agent: kind.map(|k| domain::ids::AgentKind::from(String::from(k))),
        name: name.map(|n| domain::ids::AgentName::from(String::from(n))),
        terminal_title: None,
        cwd: Some(String::from("/projets/atelier")),
        foreground_cwd: None,
        completion_seq: None,
        state_change_seq: None,
        session: None,
    }
}

fn source(base: &str) -> SourceDeSession {
    SourceDeSession {
        kind: SessionRefKind::Path,
        base: Some(String::from(base)),
        session_id: None,
        cwd: None,
        parent: None,
    }
}

fn borne(agents: Vec<AgentObservation>) -> ObservationBorne {
    let photo = Snapshot {
        agents,
        workspaces: vec![WorkspaceObservation {
            workspace_id: WorkspaceId::from(String::from("w1")),
            label: Some(String::from("atelier")),
            agent_status: None,
            focused: None,
            number: None,
            pane_count: Some(1),
            tab_count: Some(1),
            active_tab_id: None,
            worktree: None,
        }],
        tabs: Some(vec![TabObservation {
            tab_id: TabId::from(String::from("t1")),
            workspace_id: WorkspaceId::from(String::from("w1")),
            label: Some(String::from("1")),
            number: 1,
            agent_status: None,
            pane_count: Some(1),
        }]),
        ..Snapshot::default()
    };
    ObservationBorne {
        generation: 1,
        observe_a: Instant::now(),
        snapshot: photo,
    }
}

fn service(faux: FauxSessions) -> ServiceConversations {
    ServiceConversations::nouveau(
        Arc::new(faux),
        branche_simple("/projets/atelier", "plan/rust-backend"),
    )
}

fn entree_texte(role: RoleDeSession, texte: &str) -> EntreeLu {
    EntreeLu {
        role,
        genre: GenreDeLigne::Message,
        texte: Some(String::from(texte)),
        outil: None,
        modele: None,
        fournisseur: None,
        niveau_pensee: None,
        horodatage: Some(1_700_000_000_000),
        en_cours_de_tour: false,
    }
}

fn entree_outil(nom: &str, indice: &str) -> EntreeLu {
    EntreeLu {
        role: RoleDeSession::Assistant,
        genre: GenreDeLigne::Message,
        texte: None,
        outil: Some(OutilAppele {
            nom: String::from(nom),
            indice: Some(String::from(indice)),
        }),
        modele: None,
        fournisseur: None,
        niveau_pensee: None,
        horodatage: None,
        en_cours_de_tour: false,
    }
}

#[test]
fn une_ligne_par_pane_visible_meme_sans_session() {
    // D18 : un agent fraîchement lancé n'a pas encore de session — il a
    // quand même SA ligne (`absent`, pas une erreur).
    let faux = FauxSessions::nouveau();
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent(
            "p1",
            Some("pi"),
            AgentStatus::Idle,
            Some("le-vérif"),
        )]),
    );
    assert_eq!(lignes.len(), 1, "une ligne, pas zéro");
    let ligne = &lignes[0];
    assert_eq!(ligne.session_state, SessionState::Absent);
    assert_eq!(ligne.pane_id.as_str(), "p1");
    assert_eq!(ligne.name.as_ref().map(|n| n.as_str()), Some("le-vérif"));
    assert_eq!(ligne.status, AgentStatus::Idle);
    assert_eq!(
        ligne.title, "atelier",
        "titre Herdr → onglet utile → projet → pane_id (le nom étiquette l'agent, il n'entre pas dans le titre)"
    );
    assert_eq!(ligne.branche.as_deref(), Some("plan/rust-backend"));
}

#[test]
fn le_titre_suit_l_ordre_du_fil() {
    // Titre Herdr → libellé d'onglet utile → projet → pane_id (exact).
    let mut particulier = agent("p1", Some("pi"), AgentStatus::Done, None);
    particulier.terminal_title = Some(String::from("  mon titre  "));
    let service = service(FauxSessions::nouveau());
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(&port, &borne(vec![particulier]));
    assert_eq!(lignes[0].title, "mon titre", "trimé, pas inventé");
}

#[test]
fn le_titre_numerique_d_onglet_est_ignore_pour_le_projet() {
    // « 1 » est le libellé par défaut : le projet prend le relais.
    let service = service(FauxSessions::nouveau());
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Done, None)]),
    );
    assert_eq!(lignes[0].title, "atelier");
}

#[test]
fn l_apercu_et_la_derniere_demande_viennent_de_la_fenetre() {
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![
                entree_texte(RoleDeSession::User, "refactorise le module"),
                entree_texte(RoleDeSession::Assistant, "voilà, c'est fait"),
            ]),
        );
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Done, None)]),
    );
    assert_eq!(lignes[0].session_state, SessionState::Available);
    assert_eq!(
        lignes[0].dernier_texte.as_deref(),
        Some("refactorise le module"),
        "la DEMANDE de l'utilisateur, pas la réponse"
    );
    assert_eq!(lignes[0].apercu.as_deref(), Some("voilà, c'est fait"));
    assert_eq!(lignes[0].horodatage, Some(1_700_000_000_000));
    assert!(
        lignes[0].cause.is_none() && lignes[0].branche.is_some(),
        "la ligne est riche, pas en erreur"
    );
}

#[test]
fn l_apercu_se_rabat_sur_le_dernier_outil_sans_texte() {
    // Un agent bloqué n'a souvent rien DIT : le dernier outil, résumé en
    // une ligne (nom · indice), fait l'aperçu — jamais du JSON déversé.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![entree_outil(
                "write_file",
                "/projets/atelier/src/main.rs",
            )]),
        );
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("codex"), AgentStatus::Blocked, None)]),
    );
    assert_eq!(
        lignes[0].apercu.as_deref(),
        Some("write_file · /projets/atelier/src/main.rs")
    );
    assert_eq!(lignes[0].dernier_texte, None);
}

#[test]
fn le_modele_et_la_pensee_en_vigueur_suivent_la_derniere_declaration() {
    // D22 : la paire modèle/fournisseur vient de la MÊME entrée ; une
    // déclaration plus récente sans fournisseur fait perdre l'ancien — on
    // ne colle jamais deux sources.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![
                EntreeLu {
                    role: RoleDeSession::System,
                    genre: GenreDeLigne::ChangementModele,
                    texte: None,
                    outil: None,
                    modele: Some(String::from("old-model")),
                    fournisseur: None,
                    niveau_pensee: None,
                    horodatage: None,
                    en_cours_de_tour: false,
                },
                EntreeLu {
                    role: RoleDeSession::Autre,
                    genre: GenreDeLigne::Message,
                    texte: None,
                    outil: None,
                    modele: Some(String::from("plan-4")),
                    fournisseur: Some(String::from("anthropic")),
                    niveau_pensee: Some(String::from("max")),
                    horodatage: None,
                    en_cours_de_tour: false,
                },
            ]),
        );
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Done, None)]),
    );
    let ligne = &lignes[0];
    assert_eq!(
        ligne.modele.as_deref(),
        Some("plan-4"),
        "la plus récente gagne"
    );
    assert_eq!(
        ligne.fournisseur.as_deref(),
        Some("anthropic"),
        "la même entrée"
    );
    assert_eq!(ligne.pensee.as_deref(), Some("max"));
}

#[test]
fn la_panne_d_une_session_ne_perd_pas_les_autres_lignes() {
    // D20/C23 : une session illisible donne SA ligne en erreur avec SA
    // cause — la ligne voisine reste riche.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_source("p2", source("/sessions/p2.jsonl"))
        .avec_lecture(
            "p1",
            Err(ErreurDeLecture {
                benin: false,
                cause: String::from("permission refusée (EACCES)"),
            }),
        )
        .avec_lecture(
            "p2",
            Ok(vec![entree_texte(RoleDeSession::Assistant, "tout va bien")]),
        );
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let mut lignes = service.lignes(
        &port,
        &borne(vec![
            agent("p1", Some("pi"), AgentStatus::Done, None),
            agent("p2", Some("pi"), AgentStatus::Done, None),
        ]),
    );
    lignes.sort_by(|a, b| a.pane_id.as_str().cmp(b.pane_id.as_str()));
    assert_eq!(lignes[0].session_state, SessionState::Error);
    assert_eq!(
        lignes[0].cause.as_deref(),
        Some("permission refusée (EACCES)"),
        "la cause réelle, jamais générique"
    );
    assert_eq!(lignes[1].session_state, SessionState::Available);
    assert_eq!(lignes[1].apercu.as_deref(), Some("tout va bien"));
}

#[test]
fn la_panne_benigne_est_disponible_et_vide() {
    // Une absence reste une absence : la session existe, elle est vide —
    // pas une erreur (le fil distinguait déjà les deux).
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Err(ErreurDeLecture {
                benin: true,
                cause: String::from("pas encore écrit"),
            }),
        );
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Idle, None)]),
    );
    assert_eq!(lignes[0].session_state, SessionState::Available);
    assert_eq!(lignes[0].cause, None);
}

#[test]
fn le_permis_borne_les_lectures_a_quatre() {
    // D20 : au plus 4 sessions en lecture en même temps — le PIC mesuré
    // derrière la porte ci-dessous.
    let mut faux = FauxSessions::nouveau();
    for index in 1..=8 {
        let pane = format!("p{index}");
        faux.sources.insert(
            PaneId::from(pane.clone()),
            Some(source(&format!("/sessions/{pane}.jsonl"))),
        );
        faux.lectures.insert(PaneId::from(pane), Ok(Vec::new()));
    }
    let pic = faux.pic.clone();
    let porte = faux.porte.clone();
    faux.ferme_la_porte();
    let agents: Vec<AgentObservation> = (1..=8)
        .map(|index| agent(&format!("p{index}"), Some("pi"), AgentStatus::Done, None))
        .collect();
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let porteur = std::thread::spawn(move || service.lignes(&port, &borne(agents)));
    // Le temps que les lectures se bloquent toutes derrière la porte.
    std::thread::sleep(Duration::from_millis(150));
    // La MÊME porte (celle du faux passé au service) est rouverte.
    {
        let mut verrou = porte.0.lock().unwrap_or_else(PoisonError::into_inner);
        *verrou = true;
    }
    porte.1.notify_all();
    let lignes = porteur.join().unwrap_or_else(|_| panic!("porteur paniqué"));
    assert_eq!(lignes.len(), 8);
    let pic = pic.load(Ordering::SeqCst);
    assert!(
        pic <= MAX_SESSION_READS as u64 && pic >= 1,
        "le permis plafonne à {MAX_SESSION_READS}, pic = {pic} — jamais au-delà, jamais zéro"
    );
}

#[test]
fn la_question_est_lue_a_l_ecran_mesuree_par_ligne() {
    // D20 : un `blocked` sans aperçu se fait lire — la question est celle
    // de l'ÉCRAN, jamais de la session.
    let port = HerdrFaux::nouveau();
    port.remplace_ecran(ScreenObservation {
        pane_id: PaneId::from(String::from("p1")),
        text: Some(String::from(
            "Hooks need review\n\n1. Run all hooks\n2. Skip hooks\n\nEnter to submit | esc to cancel",
        )),
        truncated: None,
        source: None,
    });
    let service = service(FauxSessions::nouveau());
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("codex"), AgentStatus::Blocked, None)]),
    );
    let question = lignes[0]
        .question
        .as_ref()
        .unwrap_or_else(|| panic!("question mesurée"));
    assert!(
        question.texte.contains("Hooks need review"),
        "le texte de la question, pas un substitut"
    );
    assert_eq!(question.choix.len(), 2);
    // Aucune frappe, aucun texte envoyé — mesurer n'est pas répondre.
    assert!(
        port.actions()
            .iter()
            .all(|action| { !matches!(action.op, Op::EnvoiTexte | Op::EnvoiTouches | Op::Prompt) }),
        "mesurer ≠ répondre : {:?}",
        port.actions()
    );
}

#[test]
fn un_idle_qui_a_deja_parle_ne_se_fait_pas_relire() {
    // La règle mesurée : on lit un agent qui n'a RIEN à montrer (ni aperçu
    // ni dernière demande) ou qui est bloqué — jamais un `working`, et pas
    // deux fois celui qui a déjà parlé.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![entree_texte(RoleDeSession::Assistant, "déjà parlé")]),
        );
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let _ = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Idle, None)]),
    );
    assert!(
        port.actions()
            .iter()
            .all(|action| action.op != Op::LectureEcran),
        "un agent qui a parlé n'est pas relu : {:?}",
        port.actions()
    );
}

#[test]
fn la_confiance_est_detectee_et_exposee_sans_repondre() {
    let port = HerdrFaux::nouveau();
    port.remplace_ecran(ScreenObservation {
        pane_id: PaneId::from(String::from("p1")),
        text: Some(String::from(
            "codex is asking: Do you trust this folder?\n1. Yes, trust\n2. No\n",
        )),
        truncated: None,
        source: None,
    });
    let service = service(FauxSessions::nouveau());
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("codex"), AgentStatus::Blocked, None)]),
    );
    let confiance: &ConfianceRequise = lignes[0]
        .confiance
        .as_ref()
        .unwrap_or_else(|| panic!("confiance exposée"));
    assert_eq!(confiance.dossier, "/projets/atelier", "le cwd du pane");
    assert_eq!(confiance.type_agent, "codex");
    assert!(
        confiance.message.contains("codex"),
        "le message nomme l'agent"
    );
    assert!(confiance.message.contains("/projets/atelier"));
}

#[test]
fn l_attente_brute_est_montee_pour_un_bloque_sans_question() {
    // Un agent bloqué sans question lisible n'est pas un agent sans
    // attente : l'écran, montré tel quel.
    let port = HerdrFaux::nouveau();
    port.remplace_ecran(ScreenObservation {
        pane_id: PaneId::from(String::from("p1")),
        text: Some(String::from(
            "Reviewing changes\n  - src/main.rs\n  - tests/unit.rs\nPick a field:",
        )),
        truncated: None,
        source: None,
    });
    let service = service(FauxSessions::nouveau());
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("codex"), AgentStatus::Blocked, None)]),
    );
    let attente = lignes[0]
        .attente
        .as_deref()
        .unwrap_or_else(|| panic!("attente montrée"));
    assert!(attente.contains("Reviewing changes"));
    assert!(attente.contains("Pick a field"));
    assert!(lignes[0].question.is_none(), "aucun choix inventé");
}

#[test]
fn un_working_ne_demande_rien_a_l_ecran() {
    let service = service(FauxSessions::nouveau());
    let port = HerdrFaux::nouveau();
    let lignes = service.lignes(
        &port,
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Working, None)]),
    );
    assert_eq!(lignes.len(), 1);
    assert_eq!(lignes[0].question, None);
    assert_eq!(lignes[0].attente, None);
}

#[test]
fn l_ordre_des_lignes_suit_celui_du_snapshot() {
    // Deux appels au même snapshot donnent la même réponse (l'exigence du
    // contrat) — l'ordre est celui de la photo, pas celui des workers.
    let faux = FauxSessions::nouveau().avec_source("p1", source("/s/p1.jsonl"));
    let service = service(faux);
    let port = HerdrFaux::nouveau();
    let agents = vec![
        agent("p1", Some("pi"), AgentStatus::Done, None),
        agent("p2", Some("pi"), AgentStatus::Done, None),
    ];
    let premiere = service.lignes(&port, &borne(agents.clone()));
    let seconde = service.lignes(&port, &borne(agents.clone()));
    let ids: Vec<&str> = premiere.iter().map(|l| l.pane_id.as_str()).collect();
    assert_eq!(ids, vec!["p1", "p2"], "l'ordre du snapshot");
    assert_eq!(premiere, seconde, "deux appels identiques");
}

fn entree_datee(
    role: RoleDeSession,
    texte: &str,
    horodatage: u64,
    en_cours_de_tour: bool,
) -> EntreeLu {
    EntreeLu {
        horodatage: Some(horodatage),
        en_cours_de_tour,
        ..entree_texte(role, texte)
    }
}

fn tache(id: &str, statut: StatutTache) -> TacheDeFond {
    TacheDeFond {
        id: String::from(id),
        genre: GenreTache::Agent,
        description: Some(String::from("Audit")),
        type_agent: Some(String::from("general-purpose")),
        statut,
        debut: Some(1_000),
        fin: None,
        derniere_activite: Some(2_000),
        resume: None,
        transcription: true,
    }
}

#[test]
fn le_harnais_n_est_jamais_la_derniere_demande() {
    // Un rapport de sous-agent arrive APRÈS la demande : la ligne garde la
    // demande de l'utilisateur, rognée.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![
                entree_datee(RoleDeSession::User, "lance l'audit\n", 1_000, false),
                entree_datee(RoleDeSession::Assistant, "audit lancé", 1_100, false),
                entree_datee(
                    RoleDeSession::Harnais,
                    "## Rapport du sous-agent",
                    1_200,
                    false,
                ),
            ]),
        );
    let lignes = service(faux).lignes(
        &HerdrFaux::nouveau(),
        &borne(vec![agent(
            "p1",
            Some("claude"),
            AgentStatus::Working,
            None,
        )]),
    );
    assert_eq!(lignes[0].dernier_texte.as_deref(), Some("lance l'audit"));
    assert_eq!(lignes[0].apercu.as_deref(), Some("audit lancé"));
}

#[test]
fn le_tour_part_de_la_demande_qui_l_a_ouvert() {
    // Une demande envoyée PENDANT le travail, et un rapport injecté dans le
    // tour, ne relancent pas le chronomètre.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![
                entree_datee(RoleDeSession::User, "ancienne", 500, false),
                entree_datee(RoleDeSession::User, "corrige le bug", 1_000, false),
                entree_datee(RoleDeSession::Assistant, "je regarde", 1_100, false),
                entree_datee(RoleDeSession::User, "et le test aussi", 1_500, true),
                entree_datee(RoleDeSession::Harnais, "rapport", 1_600, true),
            ]),
        );
    let lignes = service(faux).lignes(
        &HerdrFaux::nouveau(),
        &borne(vec![agent(
            "p1",
            Some("claude"),
            AgentStatus::Working,
            None,
        )]),
    );
    assert_eq!(lignes[0].tour_debut, Some(1_000));
    // La demande envoyée pendant le travail reste la dernière demande.
    assert_eq!(lignes[0].dernier_texte.as_deref(), Some("et le test aussi"));

    // Un rapport arrivé agent AU REPOS ouvre un tour : le chronomètre part
    // de lui.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture(
            "p1",
            Ok(vec![
                entree_datee(RoleDeSession::User, "corrige le bug", 1_000, false),
                entree_datee(RoleDeSession::Harnais, "rapport", 9_000, false),
            ]),
        );
    let lignes = service(faux).lignes(
        &HerdrFaux::nouveau(),
        &borne(vec![agent(
            "p1",
            Some("claude"),
            AgentStatus::Working,
            None,
        )]),
    );
    assert_eq!(lignes[0].tour_debut, Some(9_000));
}

#[test]
fn les_taches_de_fond_sont_comptees_sur_la_ligne() {
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture("p1", Ok(vec![entree_texte(RoleDeSession::User, "go")]))
        .avec_taches(Ok(vec![
            tache("a1", StatutTache::EnCours),
            tache("a2", StatutTache::EnCours),
            tache("a3", StatutTache::Inconnu),
            tache("a4", StatutTache::Terminee),
        ]));
    let lignes = service(faux).lignes(
        &HerdrFaux::nouveau(),
        &borne(vec![agent("p1", Some("claude"), AgentStatus::Done, None)]),
    );
    // `inconnu` n'est PAS compté en cours.
    assert_eq!(
        lignes[0].taches_de_fond,
        Some(CompteTaches {
            en_cours: 2,
            total: 4
        })
    );
    // Capacité absente : pas de décompte inventé.
    let faux = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_lecture("p1", Ok(vec![entree_texte(RoleDeSession::User, "go")]));
    let lignes = service(faux).lignes(
        &HerdrFaux::nouveau(),
        &borne(vec![agent("p1", Some("pi"), AgentStatus::Done, None)]),
    );
    assert_eq!(lignes[0].taches_de_fond, None);
}

#[test]
fn les_taches_d_un_pane_nomment_chaque_issue() {
    let avec = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_taches(Ok(vec![tache("a1", StatutTache::EnCours)]));
    let photo = borne(vec![
        agent("p1", Some("claude"), AgentStatus::Working, None),
        agent("p2", Some("claude"), AgentStatus::Idle, None),
    ]);
    let service_avec = service(avec.clone());
    assert!(matches!(
        service_avec.taches_de(&photo, "p1"),
        IssueTaches::Liste(taches) if taches.len() == 1
    ));
    assert_eq!(
        service_avec.taches_de(&photo, "p2"),
        IssueTaches::SansSource
    );
    assert_eq!(
        service_avec.taches_de(&photo, "p9"),
        IssueTaches::PaneInconnu
    );
    assert_eq!(
        service_avec.transcription_de_tache(&photo, "p1", "a1"),
        Ok(String::from("/sessions/p1.jsonl/a1.jsonl"))
    );
    assert!(matches!(
        service_avec.transcription_de_tache(&photo, "p1", "absente"),
        Err(IssueTaches::Erreur(_))
    ));
    let sans = FauxSessions::nouveau().avec_source("p1", source("/sessions/p1.jsonl"));
    assert_eq!(
        service(sans).taches_de(&photo, "p1"),
        IssueTaches::NonPrisEnCharge
    );
    let panne = FauxSessions::nouveau()
        .avec_source("p1", source("/sessions/p1.jsonl"))
        .avec_taches(Err(String::from("permission refusée")));
    assert_eq!(
        service(panne).taches_de(&photo, "p1"),
        IssueTaches::Erreur(String::from("permission refusée"))
    );
}

#[test]
fn le_fournisseur_du_meme_modele_tient_la_paire() {
    let changement = |modele: &str, fournisseur: Option<&str>| EntreeLu {
        role: RoleDeSession::Autre,
        genre: GenreDeLigne::ChangementModele,
        texte: None,
        outil: None,
        modele: Some(String::from(modele)),
        fournisseur: fournisseur.map(String::from),
        niveau_pensee: None,
        horodatage: None,
        en_cours_de_tour: false,
    };
    let reponse = |modele: &str| EntreeLu {
        modele: Some(String::from(modele)),
        ..entree_texte(RoleDeSession::Assistant, "fait")
    };
    let ligne_de = |entrees: Vec<EntreeLu>| {
        let faux = FauxSessions::nouveau()
            .avec_source("p1", source("/sessions/p1.jsonl"))
            .avec_lecture("p1", Ok(entrees));
        service(faux).lignes(
            &HerdrFaux::nouveau(),
            &borne(vec![agent("p1", Some("codex"), AgentStatus::Done, None)]),
        )[0]
        .clone()
    };
    // codex : le changement porte « openai », les réponses du même modèle non.
    let ligne = ligne_de(vec![
        changement("gpt-6-luna", Some("openai")),
        reponse("gpt-6-luna"),
    ]);
    assert_eq!(ligne.modele.as_deref(), Some("gpt-6-luna"));
    assert_eq!(ligne.fournisseur.as_deref(), Some("openai"));
    // Un AUTRE modèle plus récent : le fournisseur de l'ancien n'est pas collé.
    let ligne = ligne_de(vec![
        changement("gpt-6-luna", Some("openai")),
        reponse("autre-modele"),
    ]);
    assert_eq!(ligne.modele.as_deref(), Some("autre-modele"));
    assert_eq!(ligne.fournisseur, None);
}
