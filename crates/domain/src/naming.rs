//! Nommage, rangs et situation — **une seule décision**, les mêmes règles pour
//! la liste, l'en-tête et le corps d'une notification (D04).
//!
//! ⚠️ **Ce que Herdr donne, et ce qu'il ne donne pas** (mesuré le 2026-10-16
//! sur 0.9.3, protocole 22) :
//!
//! - un agent lancé par `agent.start` porte un **`name`**, unique entre
//!   agents — le seul libellé *choisi*, donc le seul qui veuille dire
//!   quelque chose ;
//! - un agent lancé **à la main** n'en porte aucun (mesuré : aucun des 13) ;
//! - Herdr **numérote les tabs et les workspaces, jamais les panes** ; le
//!   seul discriminant d'un pane est sa **place dans la disposition** de son
//!   tab, lue dans `snapshot.layouts`.
//!
//! Pur et sans I/O : ni horloge, ni réseau, ni processus.

use crate::ids::{AgentName, PaneId, TabId, WorkspaceId};
use crate::observation::{
    PaneLayoutObservation, SituatedPane, Snapshot, TabObservation, WorkspaceObservation,
};
use std::collections::{BTreeMap, HashMap};

/// Le premier texte contient-il le second ? Insensible à la casse.
///
/// ⚠️ Sert à écarter un libellé qui ne dit rien de plus : Herdr donne
/// `atcrea` comme libellé d'onglet **dans** le projet `atcrea`, et `pixel`
/// comme nom d'agent dans le projet `pixel`. Sans cette règle, la
/// notification annonçait « π - atcrea · atcrea · pi ».
#[must_use]
pub fn already_said(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

/// Non vide après nettoyage, sinon rien.
fn non_empty(value: Option<&str>) -> Option<&str> {
    let clean = value?.trim();
    if clean.is_empty() { None } else { Some(clean) }
}

/// Ce qu'il faut savoir d'un pane pour l'étiqueter.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PaneLabels<'a> {
    /// Nom donné par Herdr (`agent.start`), absent pour un agent lancé à la main.
    pub name: Option<&'a str>,
    /// Rang du pane dans son tab, en ordre de lecture (1 = premier). Absent si inconnu.
    pub pane_rank: Option<u64>,
    /// Combien de panes compte le tab. `1` = l'agent est seul.
    pub tab_pane_count: u64,
    pub tab_label: Option<&'a str>,
    pub workspace_label: Option<&'a str>,
}

/// Le libellé qui distingue un pane de ses voisins de **même tab**, ou rien
/// quand il n'y a rien à distinguer.
///
/// ⚠️ **Ordre des sources, et il est délibéré :**
///
/// 1. le **nom** choisi (Herdr l'exige unique) — le seul libellé qui *veuille
///    dire quelque chose* ;
/// 2. sauf s'il **répète** le projet ou l'onglet : `agent.start` reçoit par
///    défaut le libellé du projet, l'afficher redirait la ligne du dessus ;
/// 3. sinon la **place dans la disposition** — exacte, toujours disponible,
///    et celle qu'on voit sur le Mac : « pane 2 » est le deuxième rectangle.
///
/// Rien n'est tiré de `pane_id` (`wA:p7`) : ce numéro est celui du pane
/// **dans le workspace**, pas dans le tab — deux voisins de tab pouvaient
/// afficher `pane 5` et `pane 7` sans rien expliquer. La place dans la
/// disposition suit ce que l'utilisateur voit.
#[must_use]
pub fn pane_label(pane: &PaneLabels<'_>) -> Option<String> {
    if pane.tab_pane_count < 2 {
        return None;
    }
    let name = non_empty(pane.name);
    if let Some(nom) = name {
        let tab_repete = pane.tab_label.is_some_and(|connu| already_said(connu, nom));
        let projet_repete = pane
            .workspace_label
            .is_some_and(|connu| already_said(connu, nom));
        if !tab_repete && !projet_repete {
            return Some(nom.to_owned());
        }
    }
    if let Some(rank) = pane.pane_rank {
        return Some(format!("pane {rank}"));
    }
    None
}

/// Un libellé est-il **purement numérique** — « 2 », « 17 » ?
///
/// ⚠️ **Une seule règle pour tout le dépôt.** Herdr nomme ses onglets par
/// défaut « 1 », « 2 »… : un tel libellé n'apprend rien à l'utilisateur. La
/// liste des conversations et les notifications en disent la même chose —
/// c'est bien la même question, pas deux qui se ressemblent.
#[must_use]
pub fn est_numerique(label: &str) -> bool {
    let clean = label.trim();
    !clean.is_empty() && clean.chars().all(|c| c.is_ascii_digit())
}

/// Libellé **utile** d'un libellé Herdr, ou rien.
///
/// ⚠️ Une valeur numérique pure répète ce que Herdr numérote déjà : elle est
/// écartée ici, pas au moment de l'afficher — une décision, trois
/// consommateurs.
#[must_use]
pub fn useful_label(label: Option<&str>) -> Option<&str> {
    let clean = non_empty(label)?;
    if est_numerique(clean) {
        return None;
    }
    Some(clean)
}

/// Suffixe **1..=99** suivi de la numérotation dès le premier : `pixel-1`,
/// `pixel-2`… Uniforme, unique, et jamais confondu avec le nom du projet.
///
/// ⚠️ **Correction C07 consignée.** Le fil actuel, ses quatre-vingt-dix neuf
/// suffixes épuisés, rendait `base-1` — potentiellement
/// **déjà pris** (défaut A07). La version Rust rend **rien** plutôt qu'une
/// prise : épuiser les suffixes signifie que le lancement échoue honnêtement,
/// avec sa cause — le repli et la réservation de noms sont du ressort de la
/// machine de lancement (T030/T037), pas du nommage.
#[must_use]
pub fn launch_name(base: &str, taken: &std::collections::BTreeSet<String>) -> Option<AgentName> {
    for suffix in 1..100_u32 {
        let candidate = format!("{}-{}", base, suffix);
        if !taken.contains(&candidate) {
            return Some(AgentName::from(candidate));
        }
    }
    None
}

/// Dossier de travail d'un projet — **source unique**.
///
/// ⚠️ `worktree.checkout_path` est **souvent `null`** ; le `cwd` du premier
/// pane du projet, lui, existe toujours. Deux chemins de calcul pour la même
/// donnée avaient divergé : l'aperçu trouvait le dossier, le lancement non —
/// d'où « aucun dossier de travail connu » sur un projet valide. Ordre :
/// worktree lié **gagne**, sinon le premier pane du projet qui porte un cwd
/// (ordre du snapshot), sinon rien.
#[must_use]
pub fn checkout_path_of(
    workspace: &WorkspaceObservation,
    panes: &[SituatedPane],
) -> Option<String> {
    if let Some(worktree) = &workspace.worktree {
        return Some(worktree.checkout_path.clone());
    }
    panes
        .iter()
        .find(|pane| {
            pane.workspace_id.as_ref() == Some(&workspace.workspace_id) && pane.cwd.is_some()
        })
        .and_then(|pane| pane.cwd.clone())
}

/// Un pane du contexte de nommage : son rang et la taille de son tab.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PaneSituation {
    /// Rang dans son tab en ordre de lecture ; absent sans disposition.
    pub rank: Option<u64>,
    /// Combien de panes compte son tab.
    pub tab_pane_count: u64,
}

/// Ce qu'il faut savoir d'un tab pour nommer.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TabNaming {
    pub label: Option<String>,
    pub number: u64,
}

/// Contexte de nommage : évite d'afficher des identifiants de pane à l'écran.
///
/// ⚠️ **Il porte aussi les dispositions**, et ce n'est pas un abus de
/// langage : la question à laquelle il répond est « comment nommer et
/// **situer** ce pane ? ». Le rang dans le tab vient de la disposition, et
/// c'est le seul discriminant possible — Herdr ne numérote pas les panes.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct NamingContext {
    /// Libellé par workspace (`None` = libellé par défaut de Herdr).
    pub workspaces: BTreeMap<WorkspaceId, Option<String>>,
    pub tabs: BTreeMap<TabId, TabNaming>,
    /// Par pane : son rang dans son tab, et le nombre de panes du tab.
    pub panes: BTreeMap<PaneId, PaneSituation>,
}

impl NamingContext {
    /// Le contexte **vide** : aucun libellé, aucun rang. Les agents venus
    /// d'un snapshot partiel continuent se nommer correctement (le nom
    /// choisi ne dépend de rien).
    #[must_use]
    pub fn empty() -> Self {
        Self::default()
    }

    /// Construit le contexte : le nommage d'un agent lancé par Herdr
    /// (`name`) continue de fonctionner sans dispositions — un snapshot
    /// sans layouts reste exploitable, les agents ont alors simplement
    /// pas de rang.
    #[must_use]
    pub fn from_pieces(
        workspaces: &[WorkspaceObservation],
        tabs: &[TabObservation],
        layouts: &[PaneLayoutObservation],
    ) -> Self {
        let mut panes = BTreeMap::new();
        for layout in layouts {
            let placements: Vec<PaneInLayout> = layout
                .panes
                .iter()
                .map(|pane| PaneInLayout {
                    pane_id: pane.pane_id.clone(),
                    rect: Some(RankRect {
                        x: pane.rect.x,
                        y: pane.rect.y,
                    }),
                })
                .collect();
            let ranks = ranks_of_panes(&placements);
            for pane in &layout.panes {
                panes.insert(
                    pane.pane_id.clone(),
                    PaneSituation {
                        rank: ranks.get(&pane.pane_id).copied(),
                        tab_pane_count: layout.panes.len() as u64,
                    },
                );
            }
        }
        Self {
            workspaces: workspaces
                .iter()
                .map(|workspace| (workspace.workspace_id.clone(), workspace.label.clone()))
                .collect(),
            tabs: tabs
                .iter()
                .map(|tab| {
                    (
                        tab.tab_id.clone(),
                        TabNaming {
                            label: tab.label.clone(),
                            number: tab.number,
                        },
                    )
                })
                .collect(),
            panes,
        }
    }

    /// Le contexte d'un snapshot complet — `tabs`/`layouts` absents
    /// sont traités comme vides (l'information « absent ce coup-ci » reste
    /// visible sur l'observation, pas sur ce contexte sans effet).
    #[must_use]
    pub fn from_snapshot(snapshot: &Snapshot) -> Self {
        Self::from_pieces(
            &snapshot.workspaces,
            snapshot.tabs.as_deref().unwrap_or(&[]),
            snapshot.layouts.as_deref().unwrap_or(&[]),
        )
    }
}

/// Un pane placé pour le classement, avec ou sans rectangle.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PaneInLayout {
    pub pane_id: PaneId,
    pub rect: Option<RankRect>,
}

/// La position minimale d'un pane, en cellules de terminal.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RankRect {
    pub x: i64,
    pub y: i64,
}

/// Le rang de chaque pane dans son tab, **en ordre de lecture** : de haut en
/// bas, puis de gauche à droite.
///
/// ⚠️ **L'ordre est celui de la disposition, pas celui de la création.**
/// Mesuré sur un tab réel à cinq panes : créés `p1 p2 p3 p4 p5`, disposés
/// `p1 p2 / p4 p3 / p5` → l'ordre de lecture est `p1 p2 p4 p3 p5`. Trier par
/// identifiant aurait donné un numéro qui ne correspond à aucun rectangle.
///
/// ⚠️ Un pane sans rectangle (snapshot partiel) ne peut pas être ordonné : il
/// est laissé de côté plutôt que rangé au hasard, et n'aura donc pas de rang.
///
/// ⚠️ **Départage par identifiant.** Le fil actuel départage à
/// `localeCompare` (sensible aux préférences de la machine) ; la version Rust
/// départage à l'ordre des octets — déterministe partout. Sur des
/// identifiants Herdr de forme `wA:p7`, les deux ordres coïncident ; si un
/// jour un identifiant portait des lettres accentuées, la divergence serait
/// mesurée et consignée ici.
#[must_use]
pub fn ranks_of_panes(panes: &[PaneInLayout]) -> HashMap<PaneId, u64> {
    let mut with_rect: Vec<&PaneInLayout> =
        panes.iter().filter(|pane| pane.rect.is_some()).collect();
    with_rect.sort_by(|a, b| {
        let ra = a.rect.unwrap_or(RankRect { x: 0, y: 0 });
        let rb = b.rect.unwrap_or(RankRect { x: 0, y: 0 });
        ra.y.cmp(&rb.y)
            .then(ra.x.cmp(&rb.x))
            .then(a.pane_id.cmp(&b.pane_id))
    });
    with_rect
        .iter()
        .enumerate()
        .map(|(index, pane)| (pane.pane_id.clone(), (index + 1) as u64))
        .collect()
}

/// Les rangs d'une disposition — un raccourci direct vers [`ranks_of_panes`]
/// pour les panes d'une disposition mesurée (rectangles toujours présents).
#[must_use]
pub fn layout_ranks(layout: &PaneLayoutObservation) -> HashMap<PaneId, u64> {
    ranks_of_panes(
        &layout
            .panes
            .iter()
            .map(|pane| PaneInLayout {
                pane_id: pane.pane_id.clone(),
                rect: Some(RankRect {
                    x: pane.rect.x,
                    y: pane.rect.y,
                }),
            })
            .collect::<Vec<_>>(),
    )
}
