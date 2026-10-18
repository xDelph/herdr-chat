//! La liste des conversations (T039, D18–D20) : **une ligne par pane
//! visible**, assemblée depuis UNE génération d'observation (T038).
//!
//! ⚠️ **Le graphe interdit `application → sessions`** : la lecture du
//! contenu de session est INJECTÉE (`LitSessions`) — `application` assemble
//! les résumés (le titre, l'aperçu, le modèle en vigueur, l'horodatage),
//! `sessions` lit et normalise (T026–T027), `herdrchat` compose (T056).
//!
//! ⚠️ **L'isolation par ligne (C23/D20)** : une session illisible donne une
//! ligne `error` avec sa cause — les autres lignes restent entières ; la
//! panne du snapshot reste une panne agrégée (le 503 de la route).
//!
//! ⚠️ **Le permis de lecture** : au plus `MAX_SESSION_READS` sessions en
//! lecture en même temps (4, la valeur du contrat) — un plafond, pas une
//! approximation par nombre de lignes.
//!
//! ⚠️ **L'invite est mesurée à l'écran, jamais dans la session** : une
//! question n'existe que sur le terminal (D20). On lit l'écran d'un agent
//! qui n'a rien à montrer (ni aperçu, ni dernière demande) ou qui est
//! `blocked` — jamais un agent `working`. La confiance est détectée et
//! EXPOSÉE, jamais répondue (interactions::confiance).

use crate::overview::{ResoutSessions, SourceDeSession};
use crate::permis::SasDeLecture;
use crate::state::ObservationBorne;
use crate::visibilite::est_visible;
use domain::ids::{AgentKind, AgentName, PaneId, TabId, WorkspaceId};
use domain::naming::{NamingContext, useful_label};
use domain::observation::{AgentObservation, ScreenObservation};
use domain::ports::{ControlPort, ScreenRead};
use domain::status::{AgentStatus, SessionState};
use interactions::confiance::est_invite_confiance;
use interactions::ecran::question_de_l_ecran;
/// Réexporté pour l'assembleur HTTP : `http-api` ne peut pas importer
/// `interactions` (graphe), et la ligne transporte le type.
pub use interactions::ecran::{Choix, Question};

/// Le plafond du contrat : 4 lectures de session en même temps.
pub const MAX_SESSION_READS: usize = 4;
/// La lecture d'écran d'enrichissement : 200 lignes, source visible (le fil
/// lit de même — un agent bloqué est en écran alternatif ou l'historique
/// est illisible, seule la vue courante l'est).
const MAX_LIGNES_ECRAN: u32 = 200;
/// Les dernières lignes d'une attente, montrées brut.
const LIGNES_ATTENTE: usize = 12;

/// Une entrée de session **normalisée** par le lecteur (l'adapter de
/// famille, côté `sessions`) — la matière des résumés, plus rien d'autre.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EntreeLu {
    pub role: RoleDeSession,
    pub genre: GenreDeLigne,
    /// Le texte d'une entrée de message, s'il y en a un.
    pub texte: Option<String>,
    /// L'appel d'outil d'une entrée d'assistant (le repli d'aperçu).
    pub outil: Option<OutilAppele>,
    /// Modèle/fournisseur/niveau de pensée DÉCLARÉS par cette entrée.
    pub modele: Option<String>,
    pub fournisseur: Option<String>,
    pub niveau_pensee: Option<String>,
    /// Horodatage en millisecondes UTC — jamais déduit, jamais remplacé.
    pub horodatage: Option<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoleDeSession {
    User,
    Assistant,
    System,
    Outil,
    Autre,
}

/// Le genre d'une ligne : un message, un changement de réglage, autre.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GenreDeLigne {
    Message,
    ChangementModele,
    ChangementPensee,
    Autre,
}

/// Un appel d'outil, résumé en une ligne — jamais du JSON déversé.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OutilAppele {
    pub nom: String,
    /// L'indice lisible dans les args (`title`, `cmd`, `path`, …), 80 max.
    pub indice: Option<String>,
}

/// La panne d'une lecture de session — classée, jamais devinée : une
/// absence reste une absence (la session existe, elle est vide), seules les
/// causes réelles deviennent des erreurs.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ErreurDeLecture {
    /// `true` : la session existe mais n'a rien à dire — pas une panne.
    pub benin: bool,
    pub cause: String,
}

/// Une décision de confiance exposée — jamais répondue par le serveur.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ConfianceRequise {
    /// Le dossier à approuver : le cwd du pane, sinon son titre.
    pub dossier: String,
    /// Le type d'agent, ou `agent` quand Herdr ne le dit pas.
    pub type_agent: String,
    /// Le message factuel du contrat — rien d'inventé.
    pub message: String,
    pub pane: PaneId,
}

/// Une ligne de la liste — toutes les décisions d'affichage d'UNE source.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LigneConversation {
    pub pane_id: PaneId,
    pub tab_id: TabId,
    pub workspace_id: WorkspaceId,
    /// Le type d'agent, tel que Herdr le nomme.
    pub agent: Option<AgentKind>,
    pub name: Option<AgentName>,
    /// Le titre : titre Herdr, sinon libellé d'onglet (utile), sinon
    /// libellé de projet, sinon le `pane_id` (exact, jamais inventé).
    pub title: String,
    pub status: AgentStatus,
    pub pane_rank: Option<u64>,
    pub tab_pane_count: u64,
    pub session_state: SessionState,
    /// La cause d'une lecture en échec — jamais une panne générique.
    pub cause: Option<String>,
    pub branche: Option<String>,
    pub dernier_texte: Option<String>,
    pub apercu: Option<String>,
    pub modele: Option<String>,
    pub fournisseur: Option<String>,
    pub pensee: Option<String>,
    pub horodatage: Option<u64>,
    pub question: Option<interactions::ecran::Question>,
    pub confiance: Option<ConfianceRequise>,
    pub attente: Option<String>,
    /// Le cwd du pane — le dossier de travail réel de l'agent (source de la
    /// branche ET du dossier à approuver) ; porté par la ligne, jamais
    /// deviné ailleurs.
    pub dossier_pane: Option<String>,
}

/// La branche git du dossier d'un pane — INJECTÉE (T040 installe le vrai
/// cache borné ; ici le service n'en connaît que la frontière).
pub trait BrancheDeProjet: Send + Sync {
    fn branche(&self, cwd: &str) -> Option<String>;
}

/// La lecture de session INJECTÉE (le graphe interdit `application →
/// sessions`).
pub trait LitSessions: ResoutSessions {
    /// Lit une fenêtre bornée de la source, normalisée — l'appelant borne
    /// la concurrence (le permis ci-dessous), l'implémentation borne la
    /// taille de ce qu'elle lit.
    fn fenetre(
        &self,
        pane: &PaneId,
        source: &SourceDeSession,
    ) -> Result<Vec<EntreeLu>, ErreurDeLecture>;
}

/// Le service de liste — sans état propre : assemble lignes par génération.
pub struct ServiceConversations {
    lit: Box<dyn LitSessions>,
    branche: Box<dyn BrancheDeProjet>,
}

impl ServiceConversations {
    #[must_use]
    pub fn nouveau(lit: Box<dyn LitSessions>, branche: Box<dyn BrancheDeProjet>) -> Self {
        Self { lit, branche }
    }

    /// Toutes les lignes d'une génération : pré-filtre de visibilité,
    /// lecture des sessions bornée au permis, puis enrichissement à l'écran
    /// des lignes qui n'ont rien à montrer.
    pub fn lignes(
        &self,
        port: &dyn ControlPort,
        borne: &ObservationBorne,
    ) -> Vec<LigneConversation> {
        let nommage = NamingContext::from_snapshot(&borne.snapshot);
        // 1) Les panes VISIBLES, avec leur source résolue et leur cwd.
        let prevu: Vec<PanePrevu> = borne
            .snapshot
            .agents
            .iter()
            .map(|agent| {
                let source = self.lit.source_de(agent);
                let situation = nommage.panes.get(&agent.pane_id).copied().unwrap_or(
                    domain::naming::PaneSituation {
                        rank: None,
                        tab_pane_count: 1,
                    },
                );
                // Le verdict de visibilité AVANT la lecture : jamais de
                // fenêtre ouverte pour un agent masqué.
                let visible = est_visible(
                    agent.agent.as_ref(),
                    source.as_ref().and_then(|source| source.base.as_deref()),
                    agent.status,
                    situation.tab_pane_count,
                );
                PanePrevu {
                    agent,
                    source,
                    situation,
                    visible,
                }
            })
            .filter(|prevu| prevu.visible)
            .collect();
        // 2) Les lignes de base — lecture bornée au permis (4).
        let lignes_brutes = self.lit_avec_permis(&prevu, &nommage);
        // 3) L'enrichissement à l'écran — séquentiel, borné (jamais un
        // `Promise.all` sans plafond : chaque lecture cible déjà exactement
        // les lignes qui n'ont rien à montrer).
        lignes_brutes
            .into_iter()
            .map(|ligne| Self::enrichit_ecran(port, ligne))
            .collect()
    }

    /// Les lignes de base en parallèle borné : `std::thread::scope` avec au
    /// plus `MAX_SESSION_READS` workers — le véhicule du permis en monde
    /// synchrone (le plafond du contrat, pas une approximation). Chaque
    /// worker prend l'INDEX SUIVANT disponible : la concurrence reste
    /// bornée au nombre de workers, comme le `withConcurrency` du fil.
    fn lit_avec_permis(
        &self,
        prevu: &[PanePrevu<'_>],
        nommage: &NamingContext,
    ) -> Vec<LigneConversation> {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Mutex, PoisonError};

        let sas = SasDeLecture::nouveau(MAX_SESSION_READS);
        let suivant = AtomicUsize::new(0);
        let resultats: Mutex<Vec<Option<LigneConversation>>> = Mutex::new(vec![None; prevu.len()]);
        std::thread::scope(|portee| {
            let workers = prevu.len().clamp(1, MAX_SESSION_READS);
            for _ in 0..workers {
                let sas = &sas;
                let suivant = &suivant;
                let resultats = &resultats;
                portee.spawn(move || {
                    loop {
                        let index = suivant.fetch_add(1, Ordering::SeqCst);
                        if index >= prevu.len() {
                            break;
                        }
                        let pan = &prevu[index];
                        let ligne = self.ligne_une(pan, nommage, sas);
                        resultats.lock().unwrap_or_else(PoisonError::into_inner)[index] =
                            Some(ligne);
                    }
                });
            }
        });
        resultats
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner)
            .into_iter()
            .map(|ligne| match ligne {
                Some(ligne) => ligne,
                None => panic!("chaque worker remplit son index"),
            })
            .collect()
    }

    /// Une ligne : la branche, puis la session (absente / vide / en erreur
    /// nommée / riche) — chaque état DISTINCT, rien n'est maquillé.
    fn ligne_une(
        &self,
        preuv: &PanePrevu<'_>,
        nommage: &NamingContext,
        sas: &SasDeLecture,
    ) -> LigneConversation {
        let source = preuv.source.clone();
        let base = LigneConversation {
            pane_id: preuv.agent.pane_id.clone(),
            tab_id: preuv.agent.tab_id.clone(),
            workspace_id: preuv.agent.workspace_id.clone(),
            agent: preuv.agent.agent.clone(),
            name: preuv.agent.name.clone(),
            title: Self::titre(preuv.agent, nommage),
            status: preuv.agent.status,
            pane_rank: preuv.situation.rank,
            tab_pane_count: preuv.situation.tab_pane_count,
            session_state: SessionState::Absent,
            cause: None,
            branche: preuv
                .agent
                .cwd
                .as_deref()
                .and_then(|cwd| self.branche.branche(cwd)),
            dossier_pane: preuv.agent.cwd.clone(),
            dernier_texte: None,
            apercu: None,
            modele: None,
            fournisseur: None,
            pensee: None,
            horodatage: None,
            question: None,
            confiance: None,
            attente: None,
        };
        let Some(source) = source else {
            // Pas de source du tout : ni aperçu, ni horodatage, pas de
            // chemin inventé — `absent`, pas une erreur.
            return base;
        };
        sas.acquiere();
        let lu = self.lit.fenetre(&base.pane_id, &source);
        sas.relache();
        match lu {
            Err(panne) if !panne.benin => LigneConversation {
                session_state: SessionState::Error,
                cause: Some(panne.cause),
                ..base
            },
            Err(_) => LigneConversation {
                // Une panne bénigne : la session existe mais n'a rien à
                // dire — disponible et VIDE, pas une erreur.
                session_state: SessionState::Available,
                ..base
            },
            Ok(entrees) if entrees.is_empty() => LigneConversation {
                // Le fichier existe mais ne contient rien : `absent` reste
                // réservé au fichier inexistant.
                session_state: SessionState::Available,
                ..base
            },
            Ok(entrees) => {
                let details = Self::details_de(&entrees);
                LigneConversation {
                    session_state: SessionState::Available,
                    dernier_texte: details.dernier_texte,
                    apercu: details.apercu,
                    modele: details.modele,
                    fournisseur: details.fournisseur,
                    pensee: details.pensee,
                    horodatage: details.horodatage,
                    ..base
                }
            }
        }
    }

    /// Le titre : premier non vide parmi titre Herdr, libellé d'onglet
    /// (utile), libellé de projet, `pane_id` — jamais un titre inventé.
    fn titre(agent: &AgentObservation, nommage: &NamingContext) -> String {
        if let Some(titre) = agent.terminal_title.as_deref().map(str::trim)
            && !titre.is_empty()
        {
            return titre.to_string();
        }
        if let Some(onglet) = nommage
            .tabs
            .get(&agent.tab_id)
            .and_then(|tab| useful_label(tab.label.as_deref()))
            .map(str::trim)
            && !onglet.is_empty()
        {
            return onglet.to_string();
        }
        if let Some(projet) = nommage
            .workspaces
            .get(&agent.workspace_id)
            .and_then(Clone::clone)
            .map(|libelle| libelle.trim().to_string())
            && !projet.is_empty()
        {
            return projet;
        }
        agent.pane_id.as_str().to_string()
    }

    /// Les détails de la ligne : aperçu (dernier texte d'assistant, sinon
    /// dernier outil), dernière demande, modèle/fournisseur/pensée en
    /// vigueur, horodatage — rien n'est fabriqué (D22).
    fn details_de(entrees: &[EntreeLu]) -> DetailsLigne {
        let dernier_texte = dernier_texte_de_role(entrees, RoleDeSession::User);
        let apercu = dernier_texte_assistant(entrees)
            .or_else(|| dernier_outil_assistant(entrees).map(apercu_d_outil));
        let reglages = reglages_en_vigueur(entrees);
        let horodatage = entrees.iter().rev().find_map(|entree| entree.horodatage);
        DetailsLigne {
            dernier_texte,
            apercu,
            modele: reglages.modele,
            fournisseur: reglages.fournisseur,
            pensee: reglages.pensee,
            horodatage,
        }
    }

    /// L'enrichissement à l'écran : une ligne qui n'a rien à montrer (ni
    /// aperçu, ni dernière demande) ou qui est `blocked` — jamais une
    /// `working` (elle ne peut pas attendre une réponse) — se fait lire.
    fn enrichit_ecran(port: &dyn ControlPort, mut ligne: LigneConversation) -> LigneConversation {
        if !faut_lire_l_ecran(&ligne) {
            return ligne;
        }
        let ecran = lire_ecran(port, &ligne.pane_id);
        if ecran.is_empty() {
            return ligne;
        }
        if let Some(question) = question_de_l_ecran(&ecran) {
            ligne.question = Some(question);
            return ligne;
        }
        if est_invite_confiance(&ecran) {
            let dossier = ligne
                .dossier_pane
                .clone()
                .unwrap_or_else(|| ligne.title.clone());
            let type_agent = ligne
                .agent
                .as_ref()
                .map(|kind| kind.as_str().to_string())
                .unwrap_or_else(|| String::from("agent"));
            ligne.confiance = Some(ConfianceRequise {
                message: format!(
                    "{type_agent} is asking to trust “{dossier}”. It will be able to read, write \
                     and run code there — including without asking again. This answer is \
                     recorded permanently."
                ),
                pane: ligne.pane_id.clone(),
                dossier,
                type_agent,
            });
            return ligne;
        }
        // Un agent bloqué sans question lisible n'est pas un agent sans
        // attente : l'écran est un FAIT, montré brut.
        if ligne.status == AgentStatus::Blocked
            && let Some(attente) = attente_de_l_ecran(&ecran)
        {
            ligne.attente = Some(attente);
        }
        ligne
    }
}

/// Faut-il lire l'écran de cette conversation ? La règle mesurée du fil :
/// `idle` peut attendre une décision (« Hooks need review » sur un agent
/// déclaré `idle`) — l'agent qui n'a rien à montrer est lu, jamais l'agent
/// `working`.
fn faut_lire_l_ecran(ligne: &LigneConversation) -> bool {
    ligne.status != AgentStatus::Working
        && (ligne.status == AgentStatus::Blocked
            || (ligne.apercu.is_none() && ligne.dernier_texte.is_none()))
}

/// Les dernières lignes non vides d'un écran, montrées telles quelles —
/// bornées, jamais reformulées.
fn attente_de_l_ecran(ecran: &str) -> Option<String> {
    let retenues: Vec<&str> = ecran
        .lines()
        .map(str::trim_end)
        .filter(|ligne| !ligne.trim().is_empty())
        .rev()
        .take(LIGNES_ATTENTE)
        .collect();
    if retenues.is_empty() {
        return None;
    }
    Some(retenues.into_iter().rev().collect::<Vec<_>>().join("\n"))
}

/// La lecture d'écran d'enrichissement — une panne rend un écran vide
/// (sans texte, pas d'invite) ; la cause réelle n'est pas masquée : elle
/// n'est simplement pas une DECISION d'affichage.
fn lire_ecran(port: &dyn ControlPort, pane: &PaneId) -> String {
    let mut lecture = port.read_screen(ScreenRead {
        pane: pane.clone(),
        max_lines: MAX_LIGNES_ECRAN,
    });
    match crate::commands::pousse(&mut lecture) {
        Ok(ScreenObservation {
            text: Some(texte), ..
        }) => texte.trim().to_string(),
        _ => String::new(),
    }
}

/// Un pane prévu pour la ligne : l'agent, sa source, sa place — et le
/// verdict de visibilité calculé AVANT la lecture (jamais de session lue
/// pour un agent masqué).
struct PanePrevu<'a> {
    agent: &'a AgentObservation,
    source: Option<SourceDeSession>,
    situation: domain::naming::PaneSituation,
    visible: bool,
}

/// Les détails assemblés d'une fenêtre de session.
#[derive(Default)]
struct DetailsLigne {
    dernier_texte: Option<String>,
    apercu: Option<String>,
    modele: Option<String>,
    fournisseur: Option<String>,
    pensee: Option<String>,
    horodatage: Option<u64>,
}

/// Le dernier texte d'un rôle, en remontant le fil.
fn dernier_texte_de_role(entrees: &[EntreeLu], role: RoleDeSession) -> Option<String> {
    entrees.iter().rev().find_map(|entree| {
        (entree.role == role)
            .then(|| entree.texte.clone())
            .flatten()
    })
}

/// Le dernier texte d'assistant — ou rien ; on ne résume jamais (D017.1).
fn dernier_texte_assistant(entrees: &[EntreeLu]) -> Option<String> {
    dernier_texte_de_role(entrees, RoleDeSession::Assistant)
}

/// Le dernier appel d'outil d'assistant, en remontant le fil.
fn dernier_outil_assistant(entrees: &[EntreeLu]) -> Option<&OutilAppele> {
    entrees.iter().rev().find_map(|entree| {
        (entree.role == RoleDeSession::Assistant)
            .then_some(entree.outil.as_ref())
            .flatten()
    })
}

/// L'aperçu d'un outil : le nom, et son indice quand il y en a un.
fn apercu_d_outil(outil: &OutilAppele) -> String {
    match &outil.indice {
        Some(indice) => format!("{} · {}", outil.nom, indice),
        None => outil.nom.clone(),
    }
}

/// Le modèle, le fournisseur et le niveau de pensée en VIGUEUR : on remonte
/// le fil, et on ne déduit rien — le fournisseur ne vient que de la même
/// entrée que le modèle (une paire, jamais deux sources mêlées, D22).
fn reglages_en_vigueur(entrees: &[EntreeLu]) -> DetailsLigne {
    let mut reglages = DetailsLigne::default();
    for entree in entrees.iter().rev() {
        if reglages.modele.is_none() {
            match entree.genre {
                GenreDeLigne::ChangementModele | GenreDeLigne::Message => {
                    if let Some(modele) = &entree.modele {
                        reglages.modele = Some(modele.clone());
                        reglages.fournisseur = entree.fournisseur.clone();
                    }
                }
                _ => (),
            }
        }
        if reglages.pensee.is_none()
            && let Some(pensee) = &entree.niveau_pensee
        {
            reglages.pensee = Some(pensee.clone());
        }
        if reglages.modele.is_some() && reglages.pensee.is_some() {
            break;
        }
    }
    reglages
}
