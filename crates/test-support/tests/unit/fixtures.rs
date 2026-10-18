//! Les fixtures : classement par dossiers, reproductibilité par graine,
//! disposition mesurée, faux processus réel.

use domain::observation::ReadSource;
use std::path::Path;
use std::process::Command;
use test_support::fixtures::{
    Classement, GRAINE_DU_CORPUS, Graine, ProcessusFaux, Stockage, charges_pi, charges_snapshot,
    ecran_de_base, snapshot_de_base,
};
use test_support::temp_stores::RacineJetable;

#[test]
fn le_classement_place_la_charge_au_bon_endroit() {
    let jsonl = Classement {
        stockage: Stockage::Jsonl,
        famille: String::from("pi"),
        agent: String::from("agent-faux"),
        version: 2,
    };
    assert!(
        jsonl.relatif() == "jsonl/pi/agent-faux/version-2",
        "les quatre axes lisibles : {}",
        jsonl.relatif()
    );
    let classe_sqlite = Classement {
        stockage: Stockage::Sqlite,
        famille: String::from("devin"),
        agent: String::from("agent-faux"),
        version: 9,
    };
    assert!(
        classe_sqlite.relatif() == "sqlite/devin/agent-faux/version-9",
        "l'axe stockage change le préfixe"
    );
    let racine = match RacineJetable::nouveau("soutien-verif-classe") {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let attendu = racine.chemin().join("jsonl/pi/agent-faux/version-2");
    assert!(
        jsonl.chemin_sous(racine.chemin()) == attendu,
        "le chemin absolu s'ancre à la racine, pas au monde"
    );
}

#[test]
fn les_charges_pi_sont_reproductibles_a_graine_egale() {
    let mut graine_a = Graine::de(GRAINE_DU_CORPUS);
    let mut graine_b = Graine::de(GRAINE_DU_CORPUS);
    let mut graine_c = Graine::de(7);
    let charges_a = charges_pi(&mut graine_a, 50);
    let charges_b = charges_pi(&mut graine_b, 50);
    let charges_c = charges_pi(&mut graine_c, 50);
    assert!(
        charges_a == charges_b,
        "même graine, mêmes octets — la reproductibilité se teste"
    );
    assert!(
        charges_a != charges_c,
        "une autre graine doit produire une autre charge"
    );
    for ligne in &charges_a {
        match serde_json::from_str::<serde_json::Value>(ligne) {
            Ok(valeur) => assert!(
                valeur.is_object(),
                "chaque charge est un objet JSON, pas {valeur}"
            ),
            Err(cause) => panic!("charge illisible : {cause} — {ligne}"),
        }
    }
}

#[test]
fn le_snapshot_de_base_porte_la_disposition_mesuree() {
    let snap = snapshot_de_base();
    let foyer = match snap.focused_pane {
        Some(pane) => pane.as_str() == "p1",
        None => false,
    };
    assert!(foyer, "le focus canonique est p1");
    assert!(snap.workspaces.len() == 1, "un workspace au canonique");
    let tab_unique = matches!(&snap.tabs, Some(tabs) if tabs.len() == 1);
    assert!(tab_unique, "un tab au canonique");
    let provenance = match &snap.provenance {
        Some(provenance) => provenance,
        None => panic!("le canonique porte sa provenance"),
    };
    assert!(
        provenance.protocol == 22 && provenance.version == "0.9.3",
        "protocole et version mesurés"
    );
    match &snap.layouts {
        Some(layouts) => match layouts.first() {
            Some(premiere) => {
                assert!(
                    premiere.panes.len() == 5,
                    "cinq panes mesurés, pas {}",
                    premiere.panes.len()
                );
                for pane in &premiere.panes {
                    let rect = &pane.rect;
                    match pane.pane_id.as_str() {
                        "p1" => assert!(
                            rect.x == 0
                                && rect.y == 0
                                && rect.width == 95
                                && rect.height == 26
                                && pane.focused,
                            "p1 : haut gauche, focus porté"
                        ),
                        "p2" => assert!(
                            rect.x == 95 && rect.y == 0 && !pane.focused,
                            "p2 : haut droite"
                        ),
                        "p3" => assert!(
                            rect.x == 95 && rect.y == 26,
                            "p3 : milieu droite — l'ordre visuel n'est pas l'ordre des identifiants"
                        ),
                        "p4" => assert!(
                            rect.x == 0 && rect.y == 26,
                            "p4 : milieu gauche, classé AVANT p3"
                        ),
                        "p5" => assert!(
                            rect.x == 0 && rect.y == 54 && rect.width == 190,
                            "p5 : bas pleine largeur"
                        ),
                        autre => panic!("pane inattendue au canonique : {autre}"),
                    }
                }
            }
            None => panic!("le canonique porte une disposition à contenu"),
        },
        None => panic!("le canonique porte une disposition"),
    }
}

#[test]
fn la_charge_en_agents_tient_dans_la_disposition() {
    let snap = charges_snapshot(10);
    assert!(
        snap.agents.len() == 10,
        "dix agents demandés, pas {}",
        snap.agents.len()
    );
    match &snap.layouts {
        Some(layouts) => match layouts.first() {
            Some(premiere) => assert!(
                premiere.panes.len() == 10,
                "chaque agent a sa pane ordonnée"
            ),
            None => panic!("la disposition du canonique reste rangée"),
        },
        None => panic!("la disposition du canonique reste portée"),
    }
    let sixieme = match snap.agents.get(5) {
        Some(sixieme) => sixieme,
        None => panic!("le sixième agent existe"),
    };
    assert!(
        sixieme.pane_id.as_str() == "p6",
        "après p4/p5 libres, la chaîne continue à p6"
    );
    match &sixieme.name {
        Some(nom) => assert!(nom.as_str() == "spawn-6", "le nommage s'aligne sur la pane"),
        None => panic!("un agent surnuméraire porte toujours un nom"),
    }
    let quatrieme = match snap.agents.get(3) {
        Some(quatrieme) => quatrieme,
        None => panic!("le quatrième agent occupe p4"),
    };
    assert!(
        quatrieme.pane_id.as_str() == "p4" && quatrieme.session.is_none(),
        "une pane sur deux : session absente"
    );
    let coupe = charges_snapshot(2);
    assert!(coupe.agents.len() == 2, "tronquer la queue : deux agents");
    match &coupe.layouts {
        Some(layouts) => match layouts.first() {
            Some(premiere) => assert!(
                premiere.panes.len() == 5,
                "tronquer les agents ne réécrit pas la géométrie"
            ),
            None => panic!("la géométrie reste portée"),
        },
        None => panic!("la géométrie reste portée"),
    }
}

#[test]
fn l_ecran_de_base_est_visible_et_borne() {
    let ecran = ecran_de_base();
    match &ecran.source {
        Some(source) => assert!(
            matches!(source, ReadSource::Visible),
            "source visible, pas {source:?}"
        ),
        None => panic!("l'écran canonique porte sa source"),
    }
    assert!(
        ecran.truncated == Some(false),
        "pas de troncation simulée en silence"
    );
    assert!(
        ecran.pane_id.as_str() == "p1",
        "l'écran canonique est celui de p1"
    );
}

#[test]
fn le_processus_faux_note_ses_arguments_et_rend_sa_sortie() {
    let racine = match RacineJetable::nouveau("soutien-verif-processus") {
        Ok(racine) => racine,
        Err(cause) => panic!("racine refusée : {cause}"),
    };
    let racine = racine.partage();
    let processus = match ProcessusFaux::nouveau(&racine, "{\"faux\":true}", 3) {
        Ok(processus) => processus,
        Err(cause) => panic!("script refusé : {cause}"),
    };
    assert!(
        processus.chemin_script.starts_with(racine.chemin())
            && processus.chemin_journal.starts_with(racine.chemin()),
        "script et journal vivent sous la racine, jamais ailleurs"
    );
    if let Some(home) = std::env::var_os("HOME") {
        assert!(
            !processus.chemin_script.starts_with(&home),
            "aucun chemin du HOME n'est touché"
        );
    }
    match processus.arguments() {
        Ok(arguments) => assert!(
            arguments.is_empty(),
            "aucune invocation = aucune ligne, pas d'erreur"
        ),
        Err(cause) => panic!("la lecture à vide doit réussir : {cause}"),
    }
    let resultat = match Command::new("/bin/sh")
        .arg(&processus.chemin_script)
        .args(["--famille", "pi", "--dossier", "/sessions-fausses"])
        .output()
    {
        Ok(resultat) => resultat,
        Err(cause) => panic!("/bin/sh doit être invoquable : {cause}"),
    };
    assert!(
        resultat.status.code() == Some(3),
        "le code programmé sort tel quel"
    );
    assert!(
        resultat.stdout == b"{\"faux\":true}\n",
        "la sortie est rendue telle quelle, saut de ligne du heredoc compris, pas {:?}",
        resultat.stdout
    );
    match processus.arguments() {
        Ok(arguments) => assert!(
            arguments == vec!["--famille", "pi", "--dossier", "/sessions-fausses"],
            "les arguments sont notés un à un, dans l'ordre, pas {arguments:?}"
        ),
        Err(cause) => panic!("lecture du journal refusée : {cause}"),
    }
    assert!(
        Path::new(&processus.chemin_journal).exists(),
        "le journal existe après la première invocation"
    );
}
