//! La règle de visibilité (D05) — UNE décision pour l'accueil ET la liste
//! (TECH §4 : « It owns derived title/visibility policy once for both list
//! and overview ») : le fil l'a réécrite deux fois, et à chaque fois la
//! mesure a imposé un recul — ici elle n'a qu'un seul corps.
//!
//! ⚠️ **« Pas de session » n'est pas « rien à dire »** : un agent dont on
//! sait lire la session (le type est vérifié) mais dont Herdr n'a pas publié
//! la session resterait sinon masqué alors qu'il vient de travailler
//! (mesure 2026-10-17, agent codex réellement actif disparu de la liste
//! parce que `pane.report_agent_session` échouait côté Herdr).

use domain::ids::AgentKind;
use domain::observation::AgentView;
use domain::status::AgentStatus;

/// Les types dont la session se lit — vérifiés par mesure (Lisibilite.ts) :
/// un type hors liste n'est pas déclaré inexistant, il est simplement non
/// vérifié, et l'honnêteté consiste à ne rien promettre à sa place.
const TYPES_A_SESSION_LISIBLE: [&str; 5] = ["pi", "codex", "opencode", "devin", "claude"];

/// L'état demande-t-il l'attention — que la session soit lue ou non ?
/// `blocked` et `working` exigent l'œil, quoi qu'il y ait sur le disque.
#[must_use]
pub fn attire_le_regard(status: AgentStatus) -> bool {
    matches!(status, AgentStatus::Blocked | AgentStatus::Working)
}

/// Un type dont nous savons LIRE la session (le lecteur existe et a été
/// vérifié sur disque) — différent de « le type est installé ». C'est le
/// plus faible des quatre critères, assumé comme tel : il garde l'agent
/// visible, sans jamais promettre de contenu.
#[must_use]
pub fn type_lisible(kind: Option<&AgentKind>) -> bool {
    kind.is_some_and(|kind| TYPES_A_SESSION_LISIBLE.contains(&kind.as_str()))
}

/// Un agent est-il visible ? Quatre raisons, chacune suffisante :
/// la session se lit (une source existe), l'état demande quelque chose,
/// le tab compte plusieurs panes, ou le type a une lecture vérifiée.
///
/// ⚠️ `session_path` est la **source résolue** (fichier ou base), pas un
/// chemin deviné — c'est la question « y a-t-il une source ? », et une
/// chaîne vide ne compte pas.
#[must_use]
pub fn est_visible(
    kind: Option<&AgentKind>,
    session_path: Option<&str>,
    status: AgentStatus,
    tab_pane_count: u64,
) -> bool {
    session_path.is_some_and(|chemin| !chemin.is_empty())
        || attire_le_regard(status)
        || tab_pane_count > 1
        || type_lisible(kind)
}

/// Répartit les vues d'agents : celles qu'on montre, et le compte de celles
/// qu'on masque — UN seul endroit applique la règle, accueil et liste
/// (le fil l'a dédoublé une fois, et le chemin rapide exposait encore les
/// agents muets : « deux endroits pour la même règle » finit toujours par
/// produire deux règles).
#[must_use]
pub fn repartir_agents(tous: &[AgentView]) -> (Vec<AgentView>, usize) {
    let mut visibles = Vec::with_capacity(tous.len());
    let mut masquees = 0usize;
    for agent in tous {
        if est_visible(
            agent.agent.as_ref(),
            agent.session_path.as_deref(),
            agent.status,
            agent.tab_pane_count,
        ) {
            visibles.push(agent.clone());
        } else {
            masquees += 1;
        }
    }
    (visibles, masquees)
}
