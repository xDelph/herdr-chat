//! Les capacités historiques du fil (T013) — ce qui est **utilisé** vs
//! **seulement déclaré** : les méthodes déclarées-non-utilisées ne sont pas
//! activées (A03 / E3 : `events.wait` n'implémente pas `pane_output_changed`).

/// Le vocabulaire **complet** du fil (protocol.ts Method, 14 entrées).
pub const METHODES_DECLAREES: [&str; 14] = [
    "agent.get",
    "agent.list",
    "agent.prompt",
    "agent.read",
    "agent.send_keys",
    "pane.send_text",
    "agent.focus",
    "agent.start",
    "events.subscribe",
    "events.wait",
    "ping",
    "session.snapshot",
    "tab.create",
    "tab.close",
];

/// Les méthodes **réellement appelées** par le client — les douze sites de
/// demande mesurés dans HerdrClient (`of`). `events.wait` est déclaré mais
/// **non implémenté par l'amont** (E3) : il reste hors du client.
pub const METHODES_UTILISEES: [&str; 12] = [
    "agent.get",
    "agent.list",
    "agent.prompt",
    "agent.read",
    "agent.send_keys",
    "pane.send_text",
    "agent.focus",
    "agent.start",
    "ping",
    "session.snapshot",
    "tab.create",
    "tab.close",
];

/// Les méthodes déclarées **sans activation** — le client les expose comme
/// absentes de ses capacités, jamais comme des no-op.
pub const METHODES_DECLAREES_NON_UTILISEES: [&str; 2] = ["events.subscribe", "events.wait"];

/// Une capacité est-elle activée ? — utilisée : oui ; déclarée seulement :
/// non ; inconnue : refusée (le fil n'en parle pas).
#[must_use]
pub fn est_activee(methode: &str) -> bool {
    METHODES_UTILISEES.contains(&methode)
}

/// La garde de cohérence du vocabulaire : utilisé ⊆ déclaré, et la
/// différence est exactement la liste des non-utilisées.
#[must_use]
pub fn vocabulaire_coherent() -> bool {
    METHODES_UTILISEES
        .iter()
        .all(|methode| METHODES_DECLAREES.contains(methode))
        && METHODES_DECLAREES.len()
            == METHODES_UTILISEES.len() + METHODES_DECLAREES_NON_UTILISEES.len()
}
