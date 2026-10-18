//! Le faux Herdr : capture ordonnée, panne injectée, absences honnêtes.

use crate::unit::pousse;
use domain::errors::PortError;
use domain::ids::{AgentKind, AgentName, DeliveryFingerprint, PaneId, TabId, WorkspaceId};
use domain::observation::ScreenObservation;
use domain::ports::{
    ControlPort, CreateTab, CreatedTab, PartialStep, PromptEvidence, ScreenRead, StartAgent,
    StartEvidence, TargetedPrompt,
};
use test_support::fake_herdr::{HerdrFaux, Op};

fn pane(nom: &str) -> PaneId {
    PaneId::from(String::from(nom))
}

#[test]
fn lordre_des_actions_est_capture_avec_leurs_cibles() {
    let faux = HerdrFaux::nouveau();
    faux.repond_creation_tab(CreatedTab {
        tab: TabId::from(String::from("t-atelier")),
        pane: PaneId::from(String::from("p-atelier")),
    });
    let mut creation = faux.create_tab(CreateTab {
        workspace: WorkspaceId::from(String::from("w-atelier")),
        cwd: String::from("/projets/atelier"),
        label: None,
    });
    let tab_cree = match pousse(&mut creation) {
        Ok(tab) => tab,
        Err(cause) => panic!("création simulée : {cause}"),
    };
    assert!(
        tab_cree.pane.as_str() == "p-atelier",
        "la règle de création est honorée"
    );
    let mut lancement = faux.start_agent(StartAgent {
        pane: tab_cree.pane.clone(),
        kind: AgentKind::from(String::from("pi")),
        name: Some(AgentName::from(String::from("atelier-un"))),
        args: vec![String::from("--faux")],
    });
    match pousse(&mut lancement) {
        Ok(StartEvidence::Started { pane }) => {
            assert!(
                pane.as_str() == "p-atelier",
                "le lancement vise le pane créé"
            );
        }
        Ok(autre) => panic!("lancement par défaut = Started, pas {autre:?}"),
        Err(cause) => panic!("lancement simulé : {cause}"),
    }
    let mut prompt = faux.prompt(TargetedPrompt {
        pane: tab_cree.pane,
        literal_text: String::from("salve de test"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-faux-1")),
    });
    match pousse(&mut prompt) {
        Ok(PromptEvidence::Confirmed { fingerprint }) => {
            assert!(
                fingerprint.as_str() == "empreinte-faux-1",
                "la preuve porte l'empreinte de la demande, pas une autre"
            );
        }
        Ok(autre) => panic!("prompt par défaut = Confirmed, pas {autre:?}"),
        Err(cause) => panic!("prompt simulé : {cause}"),
    }
    let actions = faux.actions();
    assert!(
        actions.len() == 3,
        "trois actions notées, pas {}",
        actions.len()
    );
    assert!(
        actions[0].op == Op::CreationTab
            && actions[0].cible == "w-atelier"
            && actions[0].detail == "/projets/atelier",
        "la création note workspace et dossier : {:?}",
        actions[0]
    );
    assert!(
        actions[1].op == Op::LancementAgent
            && actions[1].cible == "p-atelier"
            && actions[1].detail == "pi «atelier-un»",
        "le lancement note pane, genre et nom : {:?}",
        actions[1]
    );
    assert!(
        actions[2].op == Op::Prompt
            && actions[2].cible == "p-atelier"
            && actions[2].detail == "13 caractères",
        "le prompt note sa cible et la taille réelle du texte : {:?}",
        actions[2]
    );
    faux.vider_actions();
    assert!(
        faux.actions().is_empty(),
        "vider laisse repartir un journal vierge"
    );
}

#[test]
fn la_panne_globale_est_portee_telle_quelle_partout() {
    fn assure_panne<T>(reponse: Result<T, PortError>) {
        match reponse {
            Err(PortError::Transport { detail }) => {
                assert!(
                    detail == "prise débranchée par le test",
                    "la panne passe telle quelle"
                );
            }
            Err(autre) => panic!("autre panne : {autre:?}"),
            Ok(_) => panic!("une panne réglée ne doit pas réussir"),
        }
    }
    let faux = HerdrFaux::nouveau();
    faux.panne_globale(PortError::Transport {
        detail: String::from("prise débranchée par le test"),
    });
    let mut ping = faux.ping();
    assure_panne(pousse(&mut ping));
    let mut photo = faux.snapshot();
    assure_panne(pousse(&mut photo));
    let mut liste = faux.list_agents();
    assure_panne(pousse(&mut liste));
    let mut prompt = faux.prompt(TargetedPrompt {
        pane: pane("p-1"),
        literal_text: String::from("rien"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-panne-1")),
    });
    assure_panne(pousse(&mut prompt));
    let mut arret = faux.stop(pane("p-1"));
    assure_panne(pousse(&mut arret));
    assert!(
        faux.actions().len() == 5,
        "chaque action tentée est notée même en panne"
    );
}

#[test]
fn un_ecran_regle_est_lu_et_l_absence_reste_absente() {
    let faux = HerdrFaux::nouveau();
    faux.remplace_ecran(ScreenObservation {
        pane_id: pane("p-tourne"),
        text: Some(String::from("sortie simulée")),
        truncated: Some(true),
        source: None,
    });
    let mut lue = faux.read_screen(ScreenRead {
        pane: pane("p-tourne"),
        max_lines: 40,
    });
    match pousse(&mut lue) {
        Ok(ecran) => match &ecran.text {
            Some(texte) => assert!(
                texte == "sortie simulée",
                "l'écran réglé est rendu tel quel"
            ),
            None => panic!("l'écran réglé porte son texte"),
        },
        Err(cause) => panic!("lecture simulée : {cause}"),
    }
    let mut invisible = faux.read_screen(ScreenRead {
        pane: pane("p-sans-ecran"),
        max_lines: 5,
    });
    match pousse(&mut invisible) {
        Ok(ecran) => {
            assert!(ecran.text.is_none(), "sans règle, aucun texte inventé");
            assert!(
                ecran.truncated.is_none() && ecran.source.is_none(),
                "l'absence est portée telle quelle"
            );
            assert!(
                ecran.pane_id.as_str() == "p-sans-ecran",
                "l'écran absent porte sa pane"
            );
        }
        Err(cause) => panic!("l'absence d'écran est une valeur, pas une panne : {cause}"),
    }
}

#[test]
fn les_reglages_changent_entre_deux_appels() {
    let faux = HerdrFaux::nouveau();
    // Règle 1 : inconnu, avec son étape partielle réelle.
    faux.repond_prompt(PromptEvidence::Unknown {
        partial: vec![PartialStep::LiteralTextWritten],
        detail: String::from("entrée refusée par le faux"),
    });
    let mut prompt = faux.prompt(TargetedPrompt {
        pane: pane("p-repete"),
        literal_text: String::from("x"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-repete")),
    });
    match pousse(&mut prompt) {
        Ok(PromptEvidence::Unknown { detail, .. }) => {
            assert!(
                detail == "entrée refusée par le faux",
                "le détail réglé passe tel quel"
            );
        }
        Ok(autre) => panic!("règle 1 : inconnu attendu, pas {autre:?}"),
        Err(cause) => panic!("la règle change la preuve, pas la réussite du port : {cause}"),
    }
    // Règle 2 : double envoi supprimé — un état normal du faux.
    faux.repond_prompt(PromptEvidence::Suppressed {
        reason: String::from("doublon estimé du faux"),
    });
    let mut prompt = faux.prompt(TargetedPrompt {
        pane: pane("p-repete"),
        literal_text: String::from("x"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-repete")),
    });
    match pousse(&mut prompt) {
        Ok(PromptEvidence::Suppressed { reason }) => {
            assert!(
                reason == "doublon estimé du faux",
                "la raison réglée passe telle quelle"
            );
        }
        Ok(autre) => panic!("règle 2 : supprimé attendu, pas {autre:?}"),
        Err(cause) => panic!("la règle change la preuve, pas la réussite du port : {cause}"),
    }
    // Règle 3 : échec annoncé, cause réelle portée.
    faux.repond_prompt(PromptEvidence::Failed {
        detail: String::from("pas parti"),
    });
    let mut prompt = faux.prompt(TargetedPrompt {
        pane: pane("p-repete"),
        literal_text: String::from("x"),
        fingerprint: DeliveryFingerprint::from(String::from("empreinte-repete")),
    });
    match pousse(&mut prompt) {
        Ok(PromptEvidence::Failed { detail }) => {
            assert!(detail == "pas parti", "l'échec porte sa cause réelle");
        }
        Ok(autre) => panic!("règle 3 : échec attendu, pas {autre:?}"),
        Err(cause) => panic!("la règle change la preuve, pas la réussite du port : {cause}"),
    }
    assert!(
        faux.actions().len() == 3,
        "trois appels notés, pas {}",
        faux.actions().len()
    );
}

#[test]
fn la_panne_par_operation_ne_change_que_cette_operation() {
    // Panne réglée sur l'arrêt SEULEMENT : le snapshot reste servi, et les
    // autres opérations restent disponibles — la capture note les deux.
    let faux = HerdrFaux::nouveau();
    faux.panne_sur(Op::Arret, PortError::Timeout);
    let mut arret = faux.stop(pane("p-1"));
    match pousse(&mut arret) {
        Err(PortError::Timeout) => (),
        Ok(_) => panic!("l'arrêt doit échouer avec la panne réglée"),
        Err(autre) => panic!("la panne réglée passe telle quelle : {autre:?}"),
    }
    let mut photo = faux.snapshot();
    match pousse(&mut photo) {
        Ok(photo) => assert!(
            photo.agents.is_empty(),
            "sans règle, le snapshot reste vide"
        ),
        Err(cause) => panic!("une autre opération ne subit pas la panne : {cause}"),
    }
    assert!(
        faux.actions().len() == 2,
        "chaque action tentée est notée, même en panne : {}",
        faux.actions().len()
    );
}

#[test]
fn les_lancements_scriptes_sont_joues_dans_l_ordre_et_le_dernier_se_repete() {
    use domain::ports::StartAgent;
    // Deux refus coquille puis le succès : trois appels, trois réponses.
    let faux = HerdrFaux::nouveau();
    faux.scripte_lancements(vec![
        StartEvidence::ShellNotReady {
            detail: String::from("première coquille"),
        },
        StartEvidence::ShellNotReady {
            detail: String::from("seconde coquille"),
        },
        StartEvidence::Started {
            pane: pane("p-final"),
        },
    ]);
    let demande = StartAgent {
        pane: pane("p-1"),
        kind: AgentKind::from(String::from("pi")),
        name: None,
        args: Vec::new(),
    };
    let mut premier = faux.start_agent(demande.clone());
    let mut second = faux.start_agent(demande.clone());
    let mut troisieme = faux.start_agent(demande.clone());
    let mut quatrieme = faux.start_agent(demande);
    match pousse(&mut premier) {
        Ok(StartEvidence::ShellNotReady { detail }) => assert!(detail == "première coquille"),
        autre => panic!("la file joue dans l'ordre : {autre:?}"),
    }
    match pousse(&mut second) {
        Ok(StartEvidence::ShellNotReady { detail }) => assert!(detail == "seconde coquille"),
        autre => panic!("deuxième élément : {autre:?}"),
    }
    match pousse(&mut troisieme) {
        Ok(StartEvidence::Started { pane }) => assert!(pane.as_str() == "p-final"),
        autre => panic!("troisième élément : {autre:?}"),
    }
    match pousse(&mut quatrieme) {
        Ok(StartEvidence::Started { .. }) => (),
        autre => panic!("le dernier scripté se répète : {autre:?}"),
    }
    assert!(faux.actions().len() == 4, "quatre démarrages notés");
}

#[test]
fn les_identites_simulees_portent_le_suffixe_sim() {
    let faux = HerdrFaux::nouveau();
    let mut creation = faux.create_tab(CreateTab {
        workspace: WorkspaceId::from(String::from("w-sans-regle")),
        cwd: String::from("/projets/ou-ça-se-dire"),
        label: None,
    });
    match pousse(&mut creation) {
        Ok(CreatedTab { tab, pane }) => {
            assert!(
                tab.as_str() == "t-sim" && pane.as_str() == "p-sim",
                "les identités simulées se décelent au suffixe -sim : {tab} / {pane}"
            );
        }
        Err(cause) => panic!("création sans règle : {cause}"),
    }
}
