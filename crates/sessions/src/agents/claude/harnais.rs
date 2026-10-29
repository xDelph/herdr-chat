//! Ce que le **harnais** de Claude Code écrit en rôle `user` sans que
//! l'utilisateur l'ait tapé — traduit en messages `custom` (la forme de pi :
//! `role: "custom"`, `customType`, `details`), jamais en demandes.
//!
//! ⚠️ **Mesuré sur une session réelle (2026-10-29, lecture seule).** Quatre
//! formes, deux canaux :
//!
//! | Forme | Canal | Quand |
//! |---|---|---|
//! | `<task-notification>…` | ligne `user`, `origin.kind: "task-notification"` | l'agent était au repos : la fin d'une tâche ouvre un tour |
//! | `<task-notification>…` | `attachment` `queued_command`, `commandMode: "task-notification"` | l'agent travaillait : injectée dans le tour |
//! | `Another Claude session sent a message:\n<agent-message from="…">…` | ligne `user`, `isMeta: true`, `origin.kind: "peer"` | rapport d'un sous-agent, agent au repos |
//! | `<agent-message from="…">…` | `attachment` `queued_command`, `origin.kind: "peer"` | rapport d'un sous-agent, en plein tour |
//!
//! Sans cette lecture, le rapport d'un sous-agent s'affichait comme une
//! bulle de l'utilisateur, et devenait sa « dernière demande » dans la liste.
//!
//! Les deux sortes (`customType`) :
//! - `task-notification` — `details` : `taskId`, `toolUseId`, `status`,
//!   `summary`, `description`, `kind` (`agent`/`commande`), `usage` ;
//! - `subagent-report` — `details` : `taskId` (l'émetteur), `handback`.
//!
//! `details.midTurn: true` marque ce qui est arrivé PENDANT un tour : cela
//! n'ouvre pas de tour (le chronomètre ne repart pas).

use domain::session::LignePi;
use serde_json::{Map, Value, json};

/// La sorte d'un message de fin de tâche de fond.
pub const SORTE_NOTIFICATION: &str = "task-notification";
/// La sorte d'un rapport (ou message) d'un autre agent de la session.
pub const SORTE_RAPPORT: &str = "subagent-report";

/// Le préfixe d'un rapport de sous-agent rendu par `SubagentHandback`.
const PREFIXE_HANDBACK: &str = "[Subagent hand-back]";
/// La phrase qui ferme le cadre d'un rapport ; le rapport commence après.
const FIN_DU_CADRE: &str = "The report follows:";
/// Le résultat d'une notification qui ne dit rien de plus que le rapport.
const RESULTAT_RENVOYE: &str = "This agent's report was delivered";

/// Une fin de tâche de fond, telle que le harnais l'écrit.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Notification {
    pub task_id: String,
    pub tool_use_id: Option<String>,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub result: Option<String>,
    pub tokens: Option<u64>,
    pub tool_uses: Option<u64>,
    pub duration_ms: Option<u64>,
}

impl Notification {
    /// La description entre guillemets du résumé (`Agent "X" finished`,
    /// `Background command "X" completed (exit code 0)`) — absente sinon.
    #[must_use]
    pub fn description(&self) -> Option<String> {
        let resume = self.summary.as_deref()?;
        let debut = resume.find('"')? + 1;
        let fin = resume.rfind('"')?;
        (fin > debut).then(|| resume[debut..fin].to_string())
    }

    /// La sorte de tâche annoncée par le résumé — `None` quand il ne le dit
    /// pas (rien n'est deviné).
    #[must_use]
    pub fn genre(&self) -> Option<&'static str> {
        let resume = self.summary.as_deref()?.trim_start();
        if resume.starts_with("Agent ") {
            Some("agent")
        } else if resume.starts_with("Background command") {
            Some("commande")
        } else {
            None
        }
    }
}

/// Lit une notification de fin de tâche — `None` si le texte n'en est pas
/// une (il doit COMMENCER par la balise : une citation dans une demande ne
/// compte pas).
#[must_use]
pub fn notification_de(texte: &str) -> Option<Notification> {
    let texte = texte.trim_start();
    if !texte.starts_with("<task-notification>") {
        return None;
    }
    let task_id = balise(texte, "task-id")?.trim().to_string();
    if task_id.is_empty() {
        return None;
    }
    let nombre =
        |nom: &str| balise(texte, nom).and_then(|valeur| valeur.trim().parse::<u64>().ok());
    Some(Notification {
        task_id,
        tool_use_id: balise_non_vide(texte, "tool-use-id"),
        status: balise_non_vide(texte, "status"),
        summary: balise_non_vide(texte, "summary"),
        result: balise_non_vide(texte, "result"),
        tokens: nombre("subagent_tokens"),
        tool_uses: nombre("tool_uses"),
        duration_ms: nombre("duration_ms"),
    })
}

/// Le message d'un autre agent de la session (`<agent-message from="…">`).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RapportDAgent {
    pub de: Option<String>,
    /// `true` : le rapport final d'un sous-agent (`SubagentHandback`).
    pub handback: bool,
    /// Le corps, cadre retiré et indentation du harnais enlevée.
    pub corps: String,
}

/// Lit un message d'agent — `None` si le texte n'en porte pas.
#[must_use]
pub fn rapport_de(texte: &str) -> Option<RapportDAgent> {
    let ouverture = texte.find("<agent-message")?;
    let apres = &texte[ouverture..];
    let fin_balise = apres.find('>')?;
    let attributs = &apres[..fin_balise];
    let de = attributs
        .find("from=\"")
        .map(|debut| &attributs[debut + 6..])
        .and_then(|reste| reste.find('"').map(|fin| reste[..fin].to_string()))
        .filter(|valeur| !valeur.is_empty());
    let interieur = &apres[fin_balise + 1..];
    let interieur = match interieur.find("</agent-message>") {
        Some(fin) => &interieur[..fin],
        None => interieur,
    };
    let interieur = interieur.trim_start_matches(['\n', '\r']);
    let handback = interieur.trim_start().starts_with(PREFIXE_HANDBACK);
    let corps = if handback {
        // Le cadre tient sur une ligne qui finit par « The report follows: » ;
        // le harnais indente ensuite chaque ligne du rapport de deux espaces.
        let rapport = match interieur.find(FIN_DU_CADRE) {
            Some(position) => {
                let reste = &interieur[position + FIN_DU_CADRE.len()..];
                reste.strip_prefix('\n').unwrap_or(reste)
            }
            None => interieur.split_once('\n').map_or("", |(_, reste)| reste),
        };
        desindente(rapport)
    } else {
        interieur.to_string()
    };
    Some(RapportDAgent {
        de,
        handback,
        corps: corps.trim_end().to_string(),
    })
}

/// Retire l'indentation de deux espaces que le harnais pose sur chaque ligne.
fn desindente(texte: &str) -> String {
    texte
        .lines()
        .map(|ligne| {
            ligne
                .strip_prefix("  ")
                .unwrap_or(ligne.trim_start_matches(' '))
        })
        .collect::<Vec<&str>>()
        .join("\n")
}

fn balise<'a>(texte: &'a str, nom: &str) -> Option<&'a str> {
    let ouvrante = format!("<{nom}>");
    let fermante = format!("</{nom}>");
    let debut = texte.find(&ouvrante)? + ouvrante.len();
    let fin = texte[debut..].find(&fermante)? + debut;
    Some(&texte[debut..fin])
}

/// La valeur d'une balise, rognée, entités XML décodées — mesuré : le
/// harnais échappe `&`, `<`, `>` dans `<summary>` (`cd x &amp;&amp; …`).
fn balise_non_vide(texte: &str, nom: &str) -> Option<String> {
    balise(texte, nom)
        .map(str::trim)
        .filter(|valeur| !valeur.is_empty())
        .map(desechappe)
}

fn desechappe(texte: &str) -> String {
    texte
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// Le texte porté par une ligne `user` : la chaîne nue, ou ses blocs texte.
fn texte_de_ligne_user(objet: &Map<String, Value>) -> Option<String> {
    let contenu = objet.get("message")?.get("content")?;
    if let Some(texte) = contenu.as_str() {
        return Some(texte.to_string());
    }
    let blocs = contenu.as_array()?;
    let textes: Vec<&str> = blocs
        .iter()
        .filter(|bloc| bloc.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|bloc| bloc.get("text").and_then(Value::as_str))
        .collect();
    (!textes.is_empty()).then(|| textes.join("\n"))
}

fn origine_de(objet: &Map<String, Value>) -> Option<&str> {
    objet
        .get("origin")
        .and_then(|origine| origine.get("kind"))
        .and_then(Value::as_str)
}

/// Une ligne `user` que le harnais a écrite et qui n'est PAS une demande :
/// `isMeta: true` (rappels, légendes d'images, commandes développées…) ou une
/// origine déclarée non humaine. Elle n'est jamais rendue comme une demande.
#[must_use]
pub fn est_injection_du_harnais(ligne: &Value) -> bool {
    let Some(objet) = ligne.as_object() else {
        return false;
    };
    if objet.get("type").and_then(Value::as_str) != Some("user") {
        return false;
    }
    if objet.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    origine_de(objet).is_some_and(|origine| origine != "human")
}

/// Le message `custom` d'une ligne écrite par le harnais — `None` pour toute
/// autre ligne.
#[must_use]
pub fn message_du_harnais(ligne: &Value) -> Option<LignePi> {
    let objet = ligne.as_object()?;
    let (texte, pendant_le_tour) = match objet.get("type").and_then(Value::as_str)? {
        "user" => {
            let texte = texte_de_ligne_user(objet)?;
            let debut = texte.trim_start();
            // Une demande humaine qui CITE une balise reste une demande :
            // seul ce que le harnais écrit (isMeta, origine non humaine, ou
            // texte qui commence par la balise) est traduit.
            let du_harnais = est_injection_du_harnais(ligne)
                || debut.starts_with("<task-notification>")
                || debut.starts_with("<agent-message");
            if !du_harnais {
                return None;
            }
            (texte, false)
        }
        "attachment" => {
            let piece = objet.get("attachment")?.as_object()?;
            if piece.get("type").and_then(Value::as_str) != Some("queued_command") {
                return None;
            }
            let mode = piece.get("commandMode").and_then(Value::as_str);
            let origine = origine_de(piece);
            if mode != Some("task-notification") && origine == Some("human") {
                return None;
            }
            (piece.get("prompt")?.as_str()?.to_string(), true)
        }
        _ => return None,
    };
    let (sorte, contenu, mut details) = if let Some(fin) = notification_de(&texte) {
        let corps = fin
            .result
            .clone()
            .filter(|resultat| !resultat.starts_with(RESULTAT_RENVOYE))
            .or_else(|| fin.summary.clone())
            .unwrap_or_default();
        let mut details = json!({ "taskId": fin.task_id });
        pose(
            &mut details,
            "toolUseId",
            fin.tool_use_id.clone().map(Value::from),
        );
        pose(&mut details, "status", fin.status.clone().map(Value::from));
        pose(
            &mut details,
            "summary",
            fin.summary.clone().map(Value::from),
        );
        pose(
            &mut details,
            "description",
            fin.description().map(Value::from),
        );
        pose(&mut details, "kind", fin.genre().map(Value::from));
        let mut usage = json!({});
        pose(&mut usage, "tokens", fin.tokens.map(Value::from));
        pose(&mut usage, "toolUses", fin.tool_uses.map(Value::from));
        pose(&mut usage, "durationMs", fin.duration_ms.map(Value::from));
        if usage.as_object().is_some_and(|usage| !usage.is_empty()) {
            details["usage"] = usage;
        }
        (SORTE_NOTIFICATION, corps, details)
    } else if let Some(rapport) = rapport_de(&texte) {
        let mut details = json!({ "handback": rapport.handback });
        pose(&mut details, "taskId", rapport.de.clone().map(Value::from));
        (SORTE_RAPPORT, rapport.corps, details)
    } else {
        return None;
    };
    if pendant_le_tour {
        details["midTurn"] = json!(true);
    }
    let mut complet = json!({
        "type": "message",
        "message": {
            "role": "custom",
            "customType": sorte,
            "content": [{ "type": "text", "text": contenu }],
            "details": details,
        },
    });
    if let Some(horodatage) = objet.get("timestamp").and_then(Value::as_str) {
        complet["timestamp"] = json!(horodatage);
    }
    if let Some(uuid) = objet.get("uuid").and_then(Value::as_str) {
        complet["id"] = json!(format!("claude:{uuid}"));
    }
    serde_json::from_value(complet).ok()
}

fn pose(objet: &mut Value, clef: &str, valeur: Option<Value>) {
    if let Some(valeur) = valeur {
        objet[clef] = valeur;
    }
}

/// La sorte `custom` d'une opération de la file d'attente de Claude Code.
pub const SORTE_FILE: &str = "queue-operation";

/// Une opération de la file d'attente des demandes (`type: "queue-operation"`)
/// → un message `custom` que la PWA lit pour montrer ce qui ATTEND.
///
/// ⚠️ **Retour du 2026-10-29 : « je n'ai pas vu mon message en attente,
/// seulement quand tu l'as pris en compte ».** Claude Code écrit l'arrivée
/// d'une demande dans la file (`enqueue`, avec son texte) dès qu'elle est
/// tapée, puis sa sortie : `remove` (`absorbed_mid_turn`,
/// `delivered_to_agent`) ou `dequeue` (sans texte, la tête de file). Seule
/// l'absorption produisait jusqu'ici une ligne lisible. Mesuré : 47 + 8
/// `enqueue`, 33 + 8 + 4 `remove`, 10 `dequeue` sur une session réelle.
///
/// Les entrées du harnais (texte qui commence par une balise :
/// `<task-notification>`…) ne sont pas des demandes : écartées.
#[must_use]
pub fn operation_de_file(ligne: &Value) -> Option<LignePi> {
    let objet = ligne.as_object()?;
    if objet.get("type").and_then(Value::as_str) != Some("queue-operation") {
        return None;
    }
    let operation = objet.get("operation").and_then(Value::as_str)?;
    let texte = objet
        .get("content")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if texte.starts_with('<') {
        return None;
    }
    if operation != "dequeue" && texte.is_empty() {
        return None;
    }
    let mut details = json!({ "operation": operation });
    pose(
        &mut details,
        "reason",
        objet.get("reason").and_then(Value::as_str).map(Value::from),
    );
    let horodatage = objet.get("timestamp").and_then(Value::as_str).unwrap_or("");
    let mut complet = json!({
        "type": "message",
        "id": format!("claude-file:{horodatage}:{operation}:{:x}", empreinte_courte(texte)),
        "message": {
            "role": "custom",
            "customType": SORTE_FILE,
            "content": [{ "type": "text", "text": texte }],
            "details": details,
        },
    });
    if !horodatage.is_empty() {
        complet["timestamp"] = json!(horodatage);
    }
    serde_json::from_value(complet).ok()
}

/// Une empreinte courte et stable d'un texte (identifiant d'entrée).
fn empreinte_courte(texte: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hacheur = std::collections::hash_map::DefaultHasher::new();
    texte.hash(&mut hacheur);
    hacheur.finish()
}
