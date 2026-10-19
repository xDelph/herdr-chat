//! Le moteur de lancement (T037/C07/A06–A08) : tout valider avant l'onglet,
//! la réservation concurrente du nom, le retry coquille borné, le nettoyage
//! possédé, la confiance renvoyée sans y répondre, le timeout ambigu sans
//! doublon.
//! Prouve : A07.

use application::commands::launch::{
    BUDGET_TOTAL, DELAI_DEMARRAGE, DemandeLancement, ErreurLancement, HorlogeMoteur,
    IssueLancement, LanceurAgent,
};
use domain::errors::PortError;
use domain::ids::{AgentKind, AgentName, PaneId, TabId, WorkspaceId};
use domain::observation::{AgentObservation, ScreenObservation, Snapshot, WorkspaceObservation};
use domain::ports::{CreatedTab, StartEvidence};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use test_support::fake_herdr::{HerdrFaux, Op};

/// L'horloge contrôlée du test : `ecoule` n'avance que quand on l'y pousse.
/// Par défaut chaque `attend` avance exactement la durée demandée ; le test
/// peut régler `sur_saut` pour avancer davantage (couper un délai d'un
/// coup, sans dormir trente secondes).
#[derive(Clone, Default)]
struct HorlogeTest {
    ecoule_ms: Arc<AtomicU64>,
    sur_saut: Arc<AtomicU64>,
    attentes: Arc<AtomicU64>,
}

impl HorlogeTest {
    fn nouvelle() -> Self {
        Self::default()
    }

    fn et_regle_le_saut_ms(self, millis: u64) -> Self {
        self.sur_saut.store(millis, Ordering::SeqCst);
        self
    }

    fn nombre_d_attentes(&self) -> u64 {
        self.attentes.load(Ordering::SeqCst)
    }
}

impl HorlogeMoteur for HorlogeTest {
    fn attend(&self, duree: Duration) {
        self.attentes.fetch_add(1, Ordering::SeqCst);
        let saut = match self.sur_saut.load(Ordering::SeqCst) {
            0 => duree.as_millis() as u64,
            regle => regle,
        };
        self.ecoule_ms.fetch_add(saut, Ordering::SeqCst);
    }

    fn ecoule(&self) -> Duration {
        Duration::from_millis(self.ecoule_ms.load(Ordering::SeqCst))
    }
}

fn workspace_avec_chemin(libelle: &str, chemin: &str) -> WorkspaceObservation {
    WorkspaceObservation {
        workspace_id: WorkspaceId::from(String::from("w1")),
        label: Some(String::from(libelle)),
        agent_status: None,
        focused: None,
        number: None,
        pane_count: None,
        tab_count: None,
        active_tab_id: None,
        worktree: Some(domain::observation::WorkspaceWorktree {
            checkout_path: String::from(chemin),
            is_linked_worktree: false,
            repo_key: String::new(),
            repo_name: String::new(),
            repo_root: String::new(),
        }),
    }
}

fn agent_nomme(pane: &str, nom: &str) -> AgentObservation {
    AgentObservation {
        pane_id: PaneId::from(String::from(pane)),
        tab_id: TabId::from(String::from("t-voisin")),
        workspace_id: WorkspaceId::from(String::from("w1")),
        terminal_id: String::from("term-sim"),
        revision: 1,
        status: domain::status::AgentStatus::Idle,
        focused: false,
        agent: None,
        name: Some(AgentName::from(String::from(nom))),
        terminal_title: None,
        cwd: None,
        foreground_cwd: None,
        completion_seq: None,
        state_change_seq: None,
        session: None,
    }
}

fn photo_avec(workspace: WorkspaceObservation, agents: Vec<AgentObservation>) -> Snapshot {
    Snapshot {
        agents,
        workspaces: vec![workspace],
        ..Snapshot::default()
    }
}

fn demande(workspace: &str, kind: &str) -> DemandeLancement {
    DemandeLancement {
        workspace: WorkspaceId::from(String::from(workspace)),
        kind: AgentKind::from(String::from(kind)),
        nom_demande: None,
        modele: None,
        thinking: None,
    }
}

fn args_acceptes(
    _kind: &str,
    _modele: Option<&str>,
    _thinking: Option<&str>,
) -> Result<Vec<String>, String> {
    Ok(vec![String::from("--sim")])
}

/// Le faux prêt pour le scénario heureux : snapshot à deux agents (dossier
/// connu, `atelier-1` pris), création → `t-1`/`p-1`.
fn faux_heureux() -> HerdrFaux {
    let faux = HerdrFaux::nouveau();
    faux.repond_snapshot(photo_avec(
        workspace_avec_chemin("atelier", "/projets/atelier"),
        vec![agent_nomme("p-voisin", "atelier-1")],
    ));
    faux.repond_creation_tab(CreatedTab {
        tab: TabId::from(String::from("t-1")),
        pane: PaneId::from(String::from("p-1")),
    });
    faux
}

#[test]
fn le_lancement_heureux_cree_un_onglet_et_demarre() {
    // A07 : nouvel onglet (le projet peut déjà porter un agent), dossier
    // connu, nom généré numéroté dès le premier, puis démarrage.
    let faux = faux_heureux();
    faux.repond_lancement(StartEvidence::Started {
        pane: PaneId::from(String::from("p-1")),
    });
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Ok(IssueLancement::Lance {
            kind,
            nom,
            pane,
            tab,
        }) => {
            assert!(kind.as_str() == "pi");
            assert!(nom.as_str() == "atelier-2", "numéroté dès le premier");
            assert!(pane.as_str() == "p-1" && tab.as_str() == "t-1");
        }
        Ok(autre) => panic!("lancement attendu, pas {autre:?}"),
        Err(erreur) => panic!("le scénario heureux doit passer : {erreur:?}"),
    }
    let actions = faux.actions();
    assert!(
        actions.len() == 3,
        "snapshot, onglet, démarrage : {}",
        actions.len()
    );
    assert!(
        actions[0].op == Op::Snapshot
            && actions[1].op == Op::CreationTab
            && actions[2].op == Op::LancementAgent,
        "l'ordre : photo PUIS onglet PUIS démarrage — {:?}",
        actions
    );
    assert!(
        actions[1].cible == "w1" && actions[1].detail == "/projets/atelier",
        "l'onglet naît avec le cwd connu : {:?}",
        actions[1]
    );
    assert!(
        actions[2].detail.contains("atelier-2"),
        "le démarrage porte le nom réservé : {:?}",
        actions[2]
    );
    assert!(
        actions
            .iter()
            .filter(|action| action.op == Op::LancementAgent)
            .count()
            == 1,
        "un seul démarrage, pas de second agent automatique"
    );
}

#[test]
fn le_nom_demande_passe_tel_quel_sans_renumerotation() {
    let faux = faux_heureux();
    faux.repond_lancement(StartEvidence::Started {
        pane: PaneId::from(String::from("p-1")),
    });
    let mut ma_demande = demande("w1", "codex");
    ma_demande.nom_demande = Some(AgentName::from(String::from("mon-nom")));
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &ma_demande) {
        Ok(IssueLancement::Lance { nom, .. }) => assert!(nom.as_str() == "mon-nom"),
        issue => panic!("le nom demandé passe tel quel : {issue:?}"),
    }
    assert!(
        faux.actions()[2].detail.contains("mon-nom"),
        "le démarrage porte le nom demandé : {:?}",
        faux.actions()[2]
    );
}

#[test]
fn l_entree_invalide_cree_zero_onglet_et_zero_appel() {
    // C07 : args refusées AVANT tout appel au port — une demande invalide
    // ne crée aucun onglet.
    let faux = faux_heureux();
    let horloge = HorlogeTest::nouvelle();
    let refus = |_kind: &str,
                 _modele: Option<&str>,
                 _thinking: Option<&str>|
     -> Result<Vec<String>, String> {
        Err(String::from("cursor: le niveau est dans le nom"))
    };
    match LanceurAgent::nouveau().lance(&faux, &horloge, &refus, &demande("w1", "cursor")) {
        Err(ErreurLancement::ValidationRefusee { erreur }) => {
            assert!(erreur.contains("dans le nom"), "{erreur}");
        }
        issue => panic!("refus de validation attendu : {issue:?}"),
    }
    assert!(
        faux.actions().is_empty(),
        "zéro appel au port pour une demande invalide : {:?}",
        faux.actions()
    );
}

#[test]
fn le_projet_absent_refuse_avant_tout_onglet() {
    let faux = HerdrFaux::nouveau();
    // Un AUTRE projet existe, pas celui demandé : le lancement refuse.
    let autre = WorkspaceObservation {
        workspace_id: WorkspaceId::from(String::from("w-autre")),
        label: Some(String::from("autre")),
        agent_status: None,
        focused: None,
        number: None,
        pane_count: None,
        tab_count: None,
        active_tab_id: None,
        worktree: Some(domain::observation::WorkspaceWorktree {
            checkout_path: String::from("/projets/autre"),
            is_linked_worktree: false,
            repo_key: String::new(),
            repo_name: String::new(),
            repo_root: String::new(),
        }),
    };
    faux.repond_snapshot(Snapshot {
        agents: vec![],
        workspaces: vec![autre],
        ..Snapshot::default()
    });
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Err(ErreurLancement::WorkspaceAbsent) => (),
        issue => panic!("projet absent attendu : {issue:?}"),
    }
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::CreationTab),
        "aucun onglet créé pour un projet inconnu"
    );
}

#[test]
fn le_shell_refuse_deux_fois_puis_demarre() {
    // A08 : le retry 3 s ne remonte que sur le refus EXPLICITE de coquille —
    // deux refus puis le succès : trois tentatives, deux attentes de 3 s.
    let faux = faux_heureux();
    faux.scripte_lancements(vec![
        StartEvidence::ShellNotReady {
            detail: String::from("is not an available shell"),
        },
        StartEvidence::ShellNotReady {
            detail: String::from("is not an available shell"),
        },
        StartEvidence::Started {
            pane: PaneId::from(String::from("p-1")),
        },
    ]);
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Ok(IssueLancement::Lance { pane, .. }) => assert!(pane.as_str() == "p-1"),
        issue => panic!("le retry coquille aboutit : {issue:?}"),
    }
    assert!(
        horloge.nombre_d_attentes() == 2 && horloge.ecoule().as_secs() == 6,
        "deux attentes de 3 s : {} attentes, {} s",
        horloge.nombre_d_attentes(),
        horloge.ecoule().as_secs()
    );
    assert!(
        faux.actions()
            .iter()
            .filter(|action| action.op == Op::LancementAgent)
            .count()
            == 3,
        "trois tentatives"
    );
}

#[test]
fn un_refus_autre_que_coquille_ne_retry_pas() {
    // A08 : seul « not an available shell » se rejoue ; un refus d'une
    // autre nature casse immédiatement — un seul démarrage tenté.
    let faux = faux_heureux();
    faux.repond_lancement(StartEvidence::Failed {
        detail: String::from("agent refused to start"),
    });
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Err(ErreurLancement::AgentRefuse { pane, tab, detail }) => {
            assert!(
                pane.as_str() == "p-1" && tab.as_str() == "t-1",
                "l'identité est signalée"
            );
            assert!(detail.contains("refused"), "{detail}");
        }
        issue => panic!("refus attendu : {issue:?}"),
    }
    assert!(
        faux.actions()
            .iter()
            .filter(|action| action.op == Op::LancementAgent)
            .count()
            == 1
            && horloge.nombre_d_attentes() == 0,
        "un seul essai, aucune attente"
    );
    assert!(
        faux.actions()
            .iter()
            .all(|action| action.op != Op::FermetureOnglet),
        "un agent peut exister : l'onglet est gardé"
    );
}

#[test]
fn le_budget_coquille_epuise_ferme_l_onglet_possede() {
    // A08 : 10 retries max (11 tentatives) ; l'agent n'a JAMAIS amorcé —
    // l'onglet créé par CETTE opération est fermé, et lui seul.
    let faux = faux_heureux();
    faux.scripte_lancements(vec![StartEvidence::ShellNotReady {
        detail: String::from("is not an available shell"),
    }]);
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Err(ErreurLancement::CoquilleNonPrete { pane, tab, .. }) => {
            assert!(pane.as_str() == "p-1" && tab.as_str() == "t-1");
        }
        issue => panic!("budget coquille épuisé attendu : {issue:?}"),
    }
    let lancements = faux
        .actions()
        .iter()
        .filter(|action| action.op == Op::LancementAgent)
        .count();
    assert!(
        lancements == 11,
        "dix retries + l'essai initial = 11 tentatives : {lancements}"
    );
    assert!(
        horloge.ecoule() == Duration::from_secs(30),
        "dix attentes de 3 s : {}",
        horloge.ecoule().as_secs()
    );
    let toutes = faux.actions();
    let fermetures: Vec<_> = toutes
        .iter()
        .filter(|action| action.op == Op::FermetureOnglet)
        .collect();
    assert!(
        fermetures.len() == 1 && fermetures[0].cible == "t-1",
        "exactement l'onglet possédé, et lui seul : {:?}",
        fermetures
    );
}

#[test]
fn le_delai_de_demarrage_tranche_avant_les_retries_infinis() {
    // Délai 125 s : une attente qui fait dépasser la fenêtre stoppe le
    // retry — au plus une tentative après le premier refus.
    let faux = faux_heureux();
    faux.scripte_lancements(vec![StartEvidence::ShellNotReady {
        detail: String::from("is not an available shell"),
    }]);
    let horloge = HorlogeTest::nouvelle().et_regle_le_saut_ms(130_000);
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Err(ErreurLancement::CoquilleNonPrete { .. }) => (),
        issue => panic!("délai dépassé attendu : {issue:?}"),
    }
    assert!(
        faux.actions()
            .iter()
            .filter(|action| action.op == Op::LancementAgent)
            .count()
            == 1
            && horloge.nombre_d_attentes() == 1,
        "le délai coupe APRÈS la première attente, sans relancer"
    );
    assert!(
        DELAI_DEMARRAGE.as_secs() == 125,
        "le délai mesuré du contrat"
    );
    assert!(BUDGET_TOTAL.as_secs() == 160, "le budget global du contrat");
}

#[test]
fn le_timeout_ambigu_ne_double_pas_l_agent() {
    // C07 : un délai SANS verdict — jamais de retry, jamais de fermeture :
    // l'agent PEUT exister, l'onglet est gardé, l'ambiguïté est nommée.
    let faux = faux_heureux();
    faux.panne_sur(Op::LancementAgent, PortError::Timeout);
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "pi")) {
        Err(ErreurLancement::AmorcageAmbigu { pane, tab, detail }) => {
            assert!(pane.as_str() == "p-1" && tab.as_str() == "t-1");
            assert!(detail.contains("may exist"), "{detail}");
        }
        issue => panic!("ambiguïté attendue : {issue:?}"),
    }
    let toutes = faux.actions();
    let actions: Vec<_> = toutes
        .iter()
        .filter(|action| action.op == Op::LancementAgent || action.op == Op::FermetureOnglet)
        .collect();
    assert!(
        actions.len() == 1,
        "un seul démarrage, AUCUNE fermeture : {:?}",
        actions
    );
}

#[test]
fn le_bloque_sur_l_invite_de_confiance_est_renvoye_sans_repondre() {
    // A08 : « blocked » + l'invite de confiance à l'écran → la décision est
    // EXPOSÉE (409 au fil) ; aucun texte, aucune touche ne partent.
    let faux = faux_heureux();
    faux.repond_lancement(StartEvidence::Failed {
        detail: String::from("agent is blocked and requires interactive input"),
    });
    faux.remplace_ecran(ScreenObservation {
        pane_id: PaneId::from(String::from("p-1")),
        text: Some(String::from(
            "codex is asking: Do you trust this folder?\n\nTrust this folder?\n1. Yes\n2. No\n",
        )),
        truncated: None,
        source: None,
    });
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "codex")) {
        Ok(IssueLancement::ConfianceRequise {
            kind,
            nom,
            pane,
            dossier,
        }) => {
            assert!(kind.as_str() == "codex");
            assert!(nom.as_str() == "atelier-2");
            assert!(pane.as_str() == "p-1");
            assert!(dossier == "atelier", "le dossier nommé, pas l'identifiant");
        }
        issue => panic!("confiance requise attendue : {issue:?}"),
    }
    let actions = faux.actions();
    let dernieres: Vec<_> = actions
        .iter()
        .filter(|action| {
            action.op == Op::LectureEcran
                || action.op == Op::EnvoiTexte
                || action.op == Op::EnvoiTouches
                || action.op == Op::Prompt
                || action.op == Op::FermetureOnglet
        })
        .collect();
    assert!(
        dernieres.len() == 1 && dernieres[0].op == Op::LectureEcran,
        "lecture d'écran SEULE — aucune réponse, aucune fermeture : {:?}",
        dernieres
    );
}

#[test]
fn le_bloque_sur_une_autre_question_reste_un_refus() {
    // Un agent bloqué sur un AUTRE dialogue n'est pas une confiance : le
    // refus reste, l'onglet gardé, l'identité signalée.
    let faux = faux_heureux();
    faux.repond_lancement(StartEvidence::Failed {
        detail: String::from("agent is blocked and requires interactive input"),
    });
    faux.remplace_ecran(ScreenObservation {
        pane_id: PaneId::from(String::from("p-1")),
        text: Some(String::from("What now?\n1. Allow once\n2. Deny\n")),
        truncated: None,
        source: None,
    });
    let horloge = HorlogeTest::nouvelle();
    match LanceurAgent::nouveau().lance(&faux, &horloge, &args_acceptes, &demande("w1", "codex")) {
        Err(ErreurLancement::AgentRefuse { pane, .. }) => assert!(pane.as_str() == "p-1"),
        issue => panic!("refus attendu sans invitation : {issue:?}"),
    }
}

#[test]
fn la_reservation_evite_la_collision_concurrente_d_un_meme_libelle() {
    // Deux lancements successifs sur la MÊME photo (aucun nouveau snapshot
    // entre les deux, même moteur partagé) : la réservation déplace le
    // second nom, jamais repris — le conflit amont demeure autoritaire
    // mais la collision locale est évitée.
    let lance = |moteur: &LanceurAgent, horloge: &HorlogeTest| {
        let faux = faux_heureux();
        faux.repond_lancement(StartEvidence::Started {
            pane: PaneId::from(String::from("p-1")),
        });
        match moteur.lance(&faux, horloge, &args_acceptes, &demande("w1", "pi")) {
            Ok(IssueLancement::Lance { nom, .. }) => nom.as_str().to_string(),
            issue => panic!("lancement attendu : {issue:?}"),
        }
    };
    let horloge = HorlogeTest::nouvelle();
    let moteur = LanceurAgent::nouveau();
    let premier = lance(&moteur, &horloge);
    let second = lance(&moteur, &horloge);
    assert!(
        premier == "atelier-2" && second == "atelier-3",
        "le second lancement est décalé : {premier} puis {second}"
    );
}
