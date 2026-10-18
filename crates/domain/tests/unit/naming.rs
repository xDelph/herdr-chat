//! Nommage, rangs, situation : la politique D04, mesurée, pas rediscutée.

use domain::ids::{PaneId, TabId, WorkspaceId};
use domain::naming::{
    NamingContext, PaneInLayout, PaneLabels, PaneSituation, RankRect, already_said,
    checkout_path_of, est_numerique, launch_name, pane_label, ranks_of_panes, useful_label,
};
use domain::observation::{
    LayoutPane, PaneLayoutObservation, RectCell, SituatedPane, TabObservation,
    WorkspaceObservation, WorkspaceWorktree,
};
use std::collections::BTreeSet;

fn rang_des(panes: &[(PaneId, Option<(i64, i64)>)]) -> Vec<(PaneId, u64)> {
    let placements: Vec<PaneInLayout> = panes
        .iter()
        .map(|(id, rect)| PaneInLayout {
            pane_id: id.clone(),
            rect: rect.map(|(x, y)| RankRect { x, y }),
        })
        .collect();
    let mut paires: Vec<(PaneId, u64)> = ranks_of_panes(&placements).into_iter().collect();
    paires.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    paires
}

#[test]
fn l_ordre_de_lecture_est_y_puis_x_puis_id() {
    // Mesuré : un tab réel à cinq panes, créés p1..p5, disposés
    // `p1 p2 / p4 p3 / p5` ; p4 devant p3, et pas l'ordre des ids.
    let mesuré: Vec<(PaneId, Option<(i64, i64)>)> = vec![
        (PaneId::from("p1".to_string()), Some((0, 0))),
        (PaneId::from("p2".to_string()), Some((1, 0))),
        (PaneId::from("p4".to_string()), Some((0, 1))),
        (PaneId::from("p3".to_string()), Some((1, 1))),
        (PaneId::from("p5".to_string()), Some((0, 2))),
    ];
    let rangs = rang_des(&mesuré);
    let attendu: [(&str, u64); 5] = [("p1", 1), ("p2", 2), ("p4", 3), ("p3", 4), ("p5", 5)];
    for ((attendu_id, attendu_rang), (vu, rang)) in attendu.into_iter().zip(rangs.iter()) {
        assert_eq!(
            (attendu_id, attendu_rang),
            (vu.as_str(), *rang),
            "rang de {attendu_id} divergent"
        );
    }
}

#[test]
fn un_pane_sans_rectangle_n_est_pas_rangé() {
    let panes: Vec<(PaneId, Option<(i64, i64)>)> = vec![
        (PaneId::from("p2".to_string()), Some((1, 0))),
        (PaneId::from("p1".to_string()), None),
        (PaneId::from("p4".to_string()), Some((1, 1))),
    ];
    let rangs = rang_des(&panes);
    assert_eq!(
        rangs,
        vec![
            (PaneId::from("p2".to_string()), 1),
            (PaneId::from("p4".to_string()), 2)
        ]
    );
}

#[test]
fn a_y_egal_x_tranche_puis_le_departage_de_id() {
    let panes: Vec<(PaneId, Option<(i64, i64)>)> = vec![
        (PaneId::from("p2".to_string()), Some((3, 0))),
        (PaneId::from("p10".to_string()), Some((1, 0))),
    ];
    let rangs = rang_des(&panes);
    // x=1 avant x=3 : p10 rang 1, p2 rang 2 — le départage par id aurait
    // rangé p2 devant ; la géométrie décide d'abord.
    assert_eq!(
        rangs,
        vec![
            (PaneId::from("p10".to_string()), 1),
            (PaneId::from("p2".to_string()), 2)
        ]
    );
}

#[test]
fn l_agent_seul_n_affiche_aucune_etiquette() {
    let etiquette = pane_label(&PaneLabels {
        name: Some("pixel"),
        pane_rank: Some(1),
        tab_pane_count: 1,
        tab_label: Some("pixel"),
        workspace_label: Some("pixel"),
    });
    match etiquette {
        None => (),
        Some(vu) => panic!("étiquette bruiteuse en tab solitaire : {vu}"),
    }
}

#[test]
fn le_nom_choisi_gagne_quand_il_dit_quelque_chose() {
    let etiquette = pane_label(&PaneLabels {
        name: Some("spawn-créatif"),
        pane_rank: Some(2),
        tab_pane_count: 2,
        tab_label: Some("1"),
        workspace_label: Some("pixel-studio"),
    });
    assert_eq!(etiquette, Some("spawn-créatif".to_string()));
}

#[test]
fn un_nom_qui_repete_le_projet_retrouve_sa_place() {
    let etiquette = pane_label(&PaneLabels {
        name: Some("pixel-studio"),
        pane_rank: Some(2),
        tab_pane_count: 2,
        tab_label: Some("1"),
        workspace_label: Some("pixel-studio build"),
    });
    // Le nom se retrouve littéralement dans le libellé du projet
    // (insensible à la casse, contains du fil actuel) : la place dans la
    // disposition parle mieux.
    assert_eq!(etiquette, Some("pane 2".to_string()));
}

#[test]
fn nom_repetiteur_sans_rang_ne_s_invente_rien() {
    let etiquette = pane_label(&PaneLabels {
        name: Some("atcrea"),
        pane_rank: None,
        tab_pane_count: 3,
        tab_label: Some("atcrea"),
        workspace_label: Some("atcrea"),
    });
    // Rang inconnu (snapshot partiel) + nom inutile : rien, jamais un id.
    match etiquette {
        None => (),
        Some(vu) => panic!("rien ne disait ça : {vu} n'aurait dû exister"),
    }
}

#[test]
fn une_etiquette_purement_numerique_est_ecartee_une_fois_pour_tout() {
    assert!(est_numerique("12"));
    assert!(est_numerique(" 7 "));
    assert!(!est_numerique("2x"));
    assert!(!est_numerique(""));
    match useful_label(Some("12")) {
        None => (),
        Some(vu) => panic!("libellé numérique retenu : {vu}"),
    }
    assert_eq!(useful_label(Some("atcrea")), Some("atcrea"));
    assert_eq!(useful_label(Some("   ")), None);
    assert_eq!(useful_label(None), None);
}

#[test]
fn l_inclusion_est_insensible_a_la_casse() {
    assert!(already_said("Pixel Studio — build", "pixel studio"));
    assert!(!already_said("Pixel Studio — build", "atcrea"));
}

#[test]
fn le_nom_de_lancement_numerote_des_le_premier() {
    // Pris : "pixel-1" seulement ; le premier suffixe libre est pixel-2.
    let pris = prise("pixel", 1);
    match launch_name("pixel", &pris) {
        Some(nom) => assert_eq!(nom.as_str(), "pixel-2"),
        None => panic!("nom de lancement refusé sans raison"),
    }
}

fn prise(base: &str, n: u32) -> BTreeSet<String> {
    (1..=n)
        .map(|suffixe| format!("{base}-{suffixe}"))
        .collect::<BTreeSet<String>>()
}

#[test]
fn sans_pris_le_premier_suffixe_est_pixel_1() {
    // Le nom lancé porte TOUJOURS un suffixe : jamais "pixel" seul — ce nom
    // répète le libellé du projet et l'étiquette retomberait sur "pane N"
    // pendant que les voisins affichent "pixel-2", "pixel-3" (mesuré).
    match launch_name("pixel", &BTreeSet::new()) {
        Some(nom) => assert_eq!(nom.as_str(), "pixel-1"),
        None => panic!("suffixe refusé sans prise"),
    }
}

#[test]
fn quatrevingtdixneuf_suffixes_epuises_ne_rendent_rien_de_pris() {
    // Correction C07/A07 consignée : le fil actuel rendait `base-1` —
    // potentiellement déjà pris. La version Rust échoue honnêtement (None) ;
    // le repli appartient à la machine de lancement (T030/T037).
    let pris = prise("pixel", 99);
    if let Some(nom) = launch_name("pixel", &pris) {
        panic!("a rendu un nom après épuisement : {nom}");
    }
    // correct : le repli appartient à la machine de lancement (T030/T037).
}

fn workspace_avec(worktree: Option<WorkspaceWorktree>) -> WorkspaceObservation {
    WorkspaceObservation {
        workspace_id: WorkspaceId::from("wA".to_string()),
        label: Some("atcrea".to_string()),
        agent_status: None,
        focused: Some(true),
        number: Some(1),
        pane_count: Some(2),
        tab_count: Some(1),
        active_tab_id: Some(TabId::from("tA".to_string())),
        worktree,
    }
}

#[test]
fn le_worktree_lie_gagne_toujours() {
    let avec = workspace_avec(Some(WorkspaceWorktree {
        checkout_path: "/work/atcrea-linked".to_string(),
        is_linked_worktree: true,
        repo_key: "atcrea".to_string(),
        repo_name: "atcrea".to_string(),
        repo_root: "/work/atcrea".to_string(),
    }));
    let situes: Vec<SituatedPane> = vec![SituatedPane {
        pane_id: PaneId::from("wA:p2".to_string()),
        workspace_id: Some(WorkspaceId::from("wA".to_string())),
        cwd: Some("/work/atcrea-main".to_string()),
    }];
    assert_eq!(
        checkout_path_of(&avec, &situes),
        Some("/work/atcrea-linked".to_string())
    );
}

#[test]
fn sans_worktree_le_premier_cwd_du_projet_parle() {
    let sans = workspace_avec(None);
    let situes: Vec<SituatedPane> = vec![
        SituatedPane {
            pane_id: PaneId::from("wB:p1".to_string()),
            workspace_id: Some(WorkspaceId::from("wB".to_string())),
            cwd: Some("/work/autre".to_string()),
        },
        SituatedPane {
            pane_id: PaneId::from("wA:p2".to_string()),
            workspace_id: Some(WorkspaceId::from("wA".to_string())),
            cwd: Some("/work/atcrea".to_string()),
        },
    ];
    assert_eq!(
        checkout_path_of(&sans, &situes),
        Some("/work/atcrea".to_string())
    );
}

#[test]
fn sans_indice_du_tout_rien_n_est_invente() {
    let sans = workspace_avec(None);
    let vides: Vec<SituatedPane> = Vec::new();
    match checkout_path_of(&sans, &vides) {
        None => (),
        Some(vu) => panic!("chemin inventé : {vu}"),
    }
}

fn disposition(places: Vec<(&str, i64, i64)>) -> PaneLayoutObservation {
    PaneLayoutObservation {
        tab_id: TabId::from("t1".to_string()),
        workspace_id: WorkspaceId::from("w1".to_string()),
        focused_pane_id: PaneId::from("p1".to_string()),
        panes: places
            .into_iter()
            .map(|(id, x, y)| LayoutPane {
                pane_id: PaneId::from(id.to_string()),
                focused: id == "p1",
                rect: RectCell {
                    x,
                    y,
                    width: 10,
                    height: 5,
                },
            })
            .collect(),
    }
}

#[test]
fn le_contexte_situe_et_compte() {
    // p1 p2 / p4 p3 / p5 — la disposition mesurée.
    let layout = disposition(vec![
        ("p1", 0, 0),
        ("p2", 1, 0),
        ("p3", 1, 1),
        ("p4", 0, 1),
        ("p5", 0, 2),
    ]);
    let contexte = NamingContext::from_pieces(&[], &[], &[layout]);
    let p3 = PaneId::from("p3".to_string());
    match contexte.panes.get(&p3) {
        Some(PaneSituation {
            rank,
            tab_pane_count,
        }) => {
            assert_eq!((*rank, *tab_pane_count), (Some(4), 5));
        }
        None => panic!("p3 absent du contexte"),
    }
    let p1 = PaneId::from("p1".to_string());
    match contexte.panes.get(&p1) {
        Some(PaneSituation {
            rank,
            tab_pane_count,
        }) => {
            assert_eq!((*rank, *tab_pane_count), (Some(1), 5));
        }
        None => panic!("p1 absent du contexte"),
    }
}

#[test]
fn le_contexte_vide_nomme_par_le_nom_choisi_uniquement() {
    let vide = NamingContext::empty();
    match vide.panes.get(&PaneId::from("pX".to_string())) {
        None => (),
        Some(vu) => panic!("rang inventé pour un contexte vide : {vu:?}"),
    }
    let etiquette = pane_label(&PaneLabels {
        name: Some("spawn-1"),
        pane_rank: None,
        tab_pane_count: 2,
        tab_label: None,
        workspace_label: None,
    });
    assert_eq!(etiquette, Some("spawn-1".to_string()));
}

#[test]
fn un_tab_sans_libelle_garde_son_numero_herdr() {
    // TabInfo : label absent (Herdr sans libellé) mais number toujours là
    // (D012.5 : le numéro est exact).
    let id = TabId::from("t9".to_string());
    let numero = 9_u64;
    let contexte = NamingContext::from_pieces(
        &[],
        &[TabObservation {
            tab_id: id.clone(),
            workspace_id: WorkspaceId::from("w9".to_string()),
            label: None,
            number: numero,
            agent_status: None,
            pane_count: None,
        }],
        &[],
    );
    match contexte.tabs.get(&id) {
        Some(vu) => assert_eq!((vu.label.clone().is_none(), vu.number), (true, numero)),
        None => panic!("tab retenu nulle part"),
    }
}
