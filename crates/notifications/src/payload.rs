//! Les profils de payload métier (T045, E07) : qui, quoi, où — les trois
//! étiquettes distinctes (waiting/done/gone), le lien profond encodé, le
//! nom composé hors de l'écran.
//!
//! ⚠️ **`blocked` n'est pas `done`.** Les deux arrivent ici — l'événement
//! est « l'agent a arrêté de travailler » — mais l'un attend un humain et
//! l'autre non. Annoncer la même chose pour les deux rend la notification
//! inutile précisément quand elle compte le plus.
//!
//! ⚠️ **Un agent qui n'est plus là n'a pas « fini ».** Son processus s'est
//! terminé — mesuré : un vrai agent a rendu la main sans un mot, sans
//! rapport de plantage, et Claude Code avait supprimé son propre fichier
//! d'état, donc une sortie **propre**. Annoncer « has finished working »
//! ferait croire à une réussite, et c'est faux. La cause n'est pas
//! inventée : Herdr rend `pane.exited` sans code ni raison — on dit qu'il
//! n'est plus là, jamais pourquoi.
//!
//! ⚠️ **`url` mène à l'agent, pas à l'accueil**, et le fragment est
//! **encodé** : un `paneId` contient `:` (`wB:p16`), une adresse non
//! encodée serait relue de travers au retour.

use domain::naming::{PaneLabels, already_said, est_numerique, pane_label};
use domain::observation::AgentView;

/// Ce qu'il faut savoir d'un agent pour le **nommer** hors de l'écran —
/// sous-ensemble structurel d'`AgentView` : on ne demande que ce qui sert.
#[derive(Clone, Debug)]
pub struct IdentiteNotification {
    pub agent: Option<String>,
    pub name: Option<String>,
    pub pane_rank: Option<u64>,
    pub tab_label: Option<String>,
    pub tab_number: Option<u64>,
    pub tab_pane_count: u64,
    pub title: Option<String>,
    pub workspace_label: Option<String>,
}

impl IdentiteNotification {
    /// La vue d'un agent, réduite à ce que la notification demande.
    #[must_use]
    pub fn depuis_vue(vue: &AgentView) -> Self {
        Self {
            agent: vue.agent.as_ref().map(ToString::to_string),
            name: vue.name.as_ref().map(ToString::to_string),
            pane_rank: vue.pane_rank,
            tab_label: vue.tab_label.clone(),
            tab_number: vue.tab_number,
            tab_pane_count: vue.tab_pane_count,
            title: vue.title.clone(),
            workspace_label: vue.workspace_label.clone(),
        }
    }
}

/// Le statut de fin d'un agent — la cause du déclenchement (E06), réduite
/// aux trois profils de payload.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StatutDeFin {
    /// `blocked` : l'agent attend une réponse — le plus urgent.
    EnAttente,
    /// `gone` : l'agent n'est plus là — pas « fini ».
    Disparu,
    /// Tout le reste : l'agent a fini de travailler.
    Fini,
}

/// Le payload d'une notification — le JSON exact envoyé au service push.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct PayloadNotification {
    pub body: String,
    pub tag: String,
    pub title: String,
    pub url: String,
}

/// Le contenu d'une notification : trois étiquettes distinctes — une
/// question en attente ne doit pas être remplacée en silence par un
/// « finished » plus tardif pour le même pane, et une sortie ne doit pas
/// effacer une question restée sans réponse.
#[must_use]
pub fn payload_de_notification(
    titre: &str,
    pane_id: Option<&str>,
    statut: StatutDeFin,
) -> PayloadNotification {
    let connu = !titre.is_empty();
    let corps = |phrase: &str, generique: &str| {
        if connu {
            format!("{titre} {phrase}")
        } else {
            String::from(generique)
        }
    };
    let body = match statut {
        StatutDeFin::EnAttente => corps(
            "is waiting for your answer.",
            "An agent is waiting for your answer.",
        ),
        StatutDeFin::Disparu => corps("is no longer running.", "An agent is no longer running."),
        StatutDeFin::Fini => corps("has finished working.", "Your agent has finished working."),
    };
    let tag = match pane_id {
        None => String::from("herdr-agent"),
        Some(pane) => format!(
            "{}-{pane}",
            match statut {
                StatutDeFin::EnAttente => "waiting",
                StatutDeFin::Disparu => "gone",
                StatutDeFin::Fini => "done",
            }
        ),
    };
    let title = match statut {
        StatutDeFin::EnAttente => "Agent needs you",
        StatutDeFin::Disparu => "Agent stopped",
        StatutDeFin::Fini => "Agent finished",
    };
    let url = match pane_id {
        None => String::from("/"),
        Some(pane) => format!("/#/agent/{}", encode_uri_component(pane)),
    };
    PayloadNotification {
        body,
        tag,
        title: String::from(title),
        url,
    }
}

/// Comment nommer un agent dans une **notification**.
///
/// ⚠️ **Une notification doit dire QUI, et elle n'a aucun contexte.**
/// L'écran, lui, a le projet autour ; une notification arrive sur l'écran
/// verrouillé, parfois des heures plus tard, et un libellé qui suffit à
/// l'écran n'y suffit pas. Le nom se compose de ce qui existe, dans cet
/// ordre : le projet, l'onglet, le pane, le type d'agent. Ce qui manque est
/// omis, rien n'est inventé — et si tout manque, la chaîne est vide et le
/// payload reprend sa phrase générique.
#[must_use]
pub fn nom_de_notification(agent: Option<&IdentiteNotification>) -> String {
    let agent = match agent {
        Some(agent) => agent,
        None => return String::new(),
    };
    let projet =
        non_vide(agent.title.as_deref()).or_else(|| non_vide(agent.workspace_label.as_deref()));
    let mut parties = Vec::new();
    if let Some(projet) = projet {
        parties.push(projet.to_string());
    }
    if let Some(onglet) = nom_d_onglet(agent, projet) {
        parties.push(onglet);
    }
    // La place du pane vient de la MÊME fonction que l'écran (naming du
    // domaine) : la notification ne peut pas dire autre chose que la ligne
    // de la liste.
    if let Some(pane) = pane_label(&PaneLabels {
        name: agent.name.as_deref(),
        pane_rank: agent.pane_rank,
        tab_pane_count: agent.tab_pane_count,
        tab_label: agent.tab_label.as_deref(),
        workspace_label: agent.workspace_label.as_deref(),
    }) {
        parties.push(pane);
    }
    if let Some(kind) = non_vide(agent.agent.as_deref()) {
        parties.push(kind.to_string());
    }
    parties.join(" · ")
}

/// Le nom de l'onglet : son libellé quand il dit quelque chose, son numéro
/// sinon — mesuré : `tabLabel` est `null` sur 3 des 7 agents, `tabNumber`
/// renseigné sur les 7. Le libellé est écarté quand il répète le projet.
fn nom_d_onglet(agent: &IdentiteNotification, projet: Option<&str>) -> Option<String> {
    let label = non_vide(agent.tab_label.as_deref());
    if let Some(label) = label {
        let dit_par_le_projet = match projet {
            Some(projet) => already_said(projet, label),
            None => false,
        };
        if !est_numerique(label) && !dit_par_le_projet {
            return Some(label.to_string());
        }
    }
    if let Some(numero) = agent.tab_number {
        return Some(format!("tab {numero}"));
    }
    // Dernier recours : un libellé numérique reste plus exact que rien.
    label.map(str::to_string)
}

/// Non vide après nettoyage, ou rien.
fn non_vide(valeur: Option<&str>) -> Option<&str> {
    let propre = valeur?.trim();
    if propre.is_empty() {
        None
    } else {
        Some(propre)
    }
}

/// `encodeURIComponent` — la forme exacte du fil : tout sauf
/// `A-Za-z0-9-_.!~*'()` est encodé en `%XX`.
fn encode_uri_component(texte: &str) -> String {
    let mut sortie = String::new();
    for octet in texte.bytes() {
        match octet {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => sortie.push(octet as char),
            _ => sortie.push_str(&format!("%{octet:02X}")),
        }
    }
    sortie
}
