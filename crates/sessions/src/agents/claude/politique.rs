//! La politique Claude (T020/D14) : le codec Anthropic porte les décisions
//! de forme (T016) ; le profil les pose sur le pipeline, avec le fallback
//! **raw** pour les lignes de conversation refusées (le piège propre à
//! claude — une ligne refusée ne doit PAS rester lisible).

use super::collages::texte_sans_collages;
use crate::families::anthropic::messages;
use crate::pipeline::{Capacites, Codec, Profil};
use domain::session::LignePi;
use serde_json::{Value, json};

/// Le profil **Claude** : lisible, catalogue, lancement, interactions
/// (mesuré : la surface TS traite les quatre — le modèle porte sur chaque
/// réponse, la confiance sur dossier).
#[derive(Clone, Copy, Debug)]
pub struct ProfilClaude;

impl ProfilClaude {
    #[must_use]
    pub fn genre() -> &'static str {
        "claude"
    }

    #[must_use]
    pub fn capacites() -> Capacites {
        Capacites {
            lisible: true,
            catalogue: true,
            lancement: true,
            interactions: true,
        }
    }

    #[must_use]
    pub fn profil() -> Profil {
        Profil {
            genre: Self::genre(),
            capacites: Self::capacites(),
            codec: Codec {
                ligne_vers_pi: ligne_claude_vers_pi,
                reglage_vers_pi: None,
            },
        }
    }
}

/// Le traitement d'une ligne claude par le lecteur — **la politique D14** :
/// une ligne de conversation refusée est conservée **sans son message** (les
/// autres champs survivent, plus rien ne la relit comme un message) ; les
/// autres lignes passent telles quelles.
#[must_use]
pub fn ligne_traitee(ligne: &Value) -> Value {
    if messages::est_ligne_de_conversation(ligne) {
        if ligne_claude_vers_pi(ligne).is_some() {
            return ligne.clone();
        }
        // Refusée ET de forme pi : privée de son message — sinon l'aperçu
        // relit ce qu'on vient d'écarter (mesuré : [Request interrupted…]
        // annoncé comme « dernière demande »).
        return messages::sans_message(ligne);
    }
    ligne.clone()
}

/// Une ligne Claude Code → forme commune : d'abord ce que le **harnais**
/// injecte (rapports de sous-agents, fins de tâches de fond), puis le codec
/// Anthropic, puis les demandes envoyées **pendant** un tour.
///
/// ⚠️ **L'ordre compte.** Le harnais écrit ses messages en rôle `user` : sans
/// ce premier filtre, le codec les rendait comme des demandes de
/// l'utilisateur (mesuré le 2026-10-29 : « Another Claude session sent a
/// message: <agent-message …> » affiché comme une bulle de l'utilisateur).
#[must_use]
pub fn ligne_claude_vers_pi(ligne: &Value) -> Option<LignePi> {
    if let Some(resume) = super::harnais::resume_de_compactage(ligne) {
        return Some(resume);
    }
    if let Some(harnais) = super::harnais::message_du_harnais(ligne) {
        return Some(harnais);
    }
    if let Some(file) = super::harnais::operation_de_file(ligne) {
        return Some(file);
    }
    if super::harnais::est_injection_du_harnais(ligne) {
        return None;
    }
    if let Some(shell) = execution_shell(ligne) {
        return Some(shell);
    }
    messages::ligne_vers_pi(ligne)
        .map(rapport_final_en_texte)
        .map(demande_sans_collages)
        .or_else(|| demande_en_cours_de_tour(ligne))
}

/// Une demande de l'utilisateur, **sans** l'emballage des collages
/// ([`super::collages`]) : le fil, la liste et la bulle d'envoi lisent le
/// texte envoyé, jamais `<pasted_content id=…>`.
fn demande_sans_collages(mut ligne: LignePi) -> LignePi {
    if ligne.message.role.as_deref() != Some("user") {
        return ligne;
    }
    match &mut ligne.message.content {
        Value::String(texte) => *texte = texte_sans_collages(texte),
        Value::Array(blocs) => {
            for bloc in blocs.iter_mut() {
                if bloc.get("type").and_then(Value::as_str) != Some("text") {
                    continue;
                }
                if let Some(Value::String(texte)) = bloc.get_mut("text") {
                    *texte = texte_sans_collages(texte);
                }
            }
        }
        _ => {}
    }
    ligne
}

/// Le rapport final d'un sous-agent est un APPEL d'outil (`SubagentHandback`,
/// argument `message`) : rangé avec les actions, la transcription d'une tâche
/// de fond finissait sur « 32 actions » sans sa conclusion (mesuré). C'est la
/// réponse de l'agent : elle devient du texte, à sa place.
fn rapport_final_en_texte(mut ligne: LignePi) -> LignePi {
    if ligne.message.role.as_deref() != Some("assistant") {
        return ligne;
    }
    if let Some(blocs) = ligne.message.content.as_array_mut() {
        for bloc in blocs.iter_mut() {
            let rapport = (bloc.get("type").and_then(Value::as_str) == Some("toolCall")
                && bloc.get("name").and_then(Value::as_str) == Some("SubagentHandback"))
            .then(|| {
                bloc.get("arguments")
                    .and_then(|arguments| arguments.get("message"))
            })
            .flatten()
            .and_then(Value::as_str)
            .filter(|texte| !texte.trim().is_empty())
            .map(str::to_string);
            if let Some(rapport) = rapport {
                *bloc = json!({ "type": "text", "text": rapport });
            }
        }
    }
    ligne
}

/// Une demande envoyée pendant que l'agent travaille.
///
/// ⚠️ **Mesuré sur une session réelle (2026-10-29).** Claude Code n'écrit pas
/// un message reçu en cours de tour comme une ligne `user` : il l'écrit en
/// `attachment` de type `queued_command` (`prompt`, `commandMode: "prompt"`,
/// `origin.kind: "human"`) au moment où il l'injecte dans le tour. Sans cette
/// lecture, la demande n'apparaissait jamais dans le chat. Aucune ligne `user`
/// ne la répète (vérifié) : pas de doublon.
///
/// Les notifications internes du harnais (`commandMode: "task-notification"`,
/// origine non humaine) passent par le même canal : elles ne sont PAS des
/// demandes — [`super::harnais`] les rend comme messages `custom`.
#[must_use]
pub fn demande_en_cours_de_tour(ligne: &Value) -> Option<LignePi> {
    let objet = ligne.as_object()?;
    if objet.get("type").and_then(Value::as_str) != Some("attachment") {
        return None;
    }
    let piece = objet.get("attachment")?.as_object()?;
    if piece.get("type").and_then(Value::as_str) != Some("queued_command")
        || piece.get("commandMode").and_then(Value::as_str) != Some("prompt")
        || piece
            .get("origin")
            .and_then(|origine| origine.get("kind"))
            .and_then(Value::as_str)
            != Some("human")
    {
        return None;
    }
    let texte = texte_sans_collages(piece.get("prompt").and_then(Value::as_str)?);
    let texte = texte.trim();
    if texte.is_empty() {
        return None;
    }
    // `details.midTurn` : la demande est arrivée PENDANT le travail — elle
    // reste une demande de l'utilisateur, mais n'ouvre pas un nouveau tour
    // (le chronomètre ne repart pas d'elle).
    let mut complet = json!({
        "type": "message",
        "message": {
            "role": "user",
            "content": [{ "type": "text", "text": texte }],
            "details": { "midTurn": true },
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

/// Une commande du mode shell de Claude Code (`!commande`) → une exécution
/// shell de la forme commune (`bashExecution`), jamais une demande.
///
/// ⚠️ **Mesuré sur des sessions réelles (2026-10-29, Claude Code 2.1.310,
/// 5 occurrences).** Le mode `!` écrit DEUX lignes `user` consécutives, de
/// contenu chaîne :
///
/// 1. `<bash-input> commande</bash-input>` ;
/// 2. `<bash-stdout>sortie</bash-stdout><bash-stderr>erreurs</bash-stderr>`
///    (`parentUuid` = la ligne 1).
///
/// Sans cette lecture, les deux comptaient comme des demandes de
/// l'utilisateur : bulles de balises brutes, et `lastPrompt` d'une session
/// devenait une commande shell. Le codec est sans état (une ligne à la
/// fois) : la ligne 1 rend la commande sans sortie, la ligne 2 la sortie sans
/// commande — la PWA réunit la paire en un seul bloc shell. Le code de sortie
/// n'est écrit nulle part : il reste inconnu (`null`), jamais deviné.
#[must_use]
pub fn execution_shell(ligne: &Value) -> Option<LignePi> {
    let objet = ligne.as_object()?;
    if objet.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let contenu = objet.get("message")?.get("content")?.as_str()?.trim();
    let (commande, sortie) = if let Some(commande) = entre_balises(contenu, "bash-input") {
        (commande.trim().to_string(), String::new())
    } else if contenu.starts_with("<bash-stdout>") || contenu.starts_with("<bash-stderr>") {
        let sortie = entre_balises(contenu, "bash-stdout").unwrap_or_default();
        let erreurs = entre_balises(contenu, "bash-stderr").unwrap_or_default();
        let sortie = match (sortie.trim_end().is_empty(), erreurs.trim_end().is_empty()) {
            (_, true) => sortie.to_string(),
            (true, false) => erreurs.to_string(),
            (false, false) => format!("{}\n{erreurs}", sortie.trim_end()),
        };
        (String::new(), sortie)
    } else {
        return None;
    };
    let mut complet = json!({
        "type": "message",
        "message": {
            "role": "bashExecution",
            "command": commande,
            "output": sortie,
            "exitCode": null,
            "cancelled": false,
            "truncated": false,
            "content": [],
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

/// Le texte entre `<balise>` et `</balise>`, quand les deux y sont.
fn entre_balises<'a>(texte: &'a str, balise: &str) -> Option<&'a str> {
    let ouvrante = format!("<{balise}>");
    let fermante = format!("</{balise}>");
    let debut = texte.find(&ouvrante)? + ouvrante.len();
    let fin = debut + texte[debut..].find(&fermante)?;
    Some(&texte[debut..fin])
}
