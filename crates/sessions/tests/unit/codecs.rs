//! Les codecs de famille (T016) : fixtures positives/négatives
//! **indépendantes des agents**, arguments invalides conservés bruts, et
//! Chat qui ne décode pas une enveloppe Responses par hasard.

use serde_json::{Value, json};
use sessions::families::anthropic::messages as anthropique;
use sessions::families::codecs::pi;
use sessions::families::openai::{arguments, chat, responses, text};

#[test]
fn les_arguments_invalides_restent_bruts() {
    // function_call : du JSON DANS une chaîne — valide → objet.
    let payload = json!({ "arguments": "{\"chemin\": \"/p\"}" });
    match arguments::arguments_de(&payload) {
        arguments::Arguments::Objet(objet) => {
            assert!(
                objet.get("chemin").and_then(Value::as_str) == Some("/p"),
                "le JSON se décode"
            );
        }
        autre => panic!("arguments valides attendus : {autre:?}"),
    }
    // UN SCRIPT qui n'est pas du JSON : conservé BRUT — inventer serait pire.
    let payload = json!({ "arguments": "git commit --tout" });
    match arguments::arguments_de(&payload) {
        arguments::Arguments::Brut(texte) => {
            assert!(
                texte == "git commit --tout",
                "le script reste tel quel : {texte}"
            );
        }
        autre => panic!("arguments invalides attendus bruts : {autre:?}"),
    }
    // custom_tool_call : le script vit dans `input` (chaîne brute).
    let payload = json!({ "input": "select 1;" });
    match arguments::arguments_de(&payload) {
        arguments::Arguments::Brut(texte) => assert!(texte == "select 1;"),
        autre => panic!("input brut attendu : {autre:?}"),
    }
    // Rien d'utilisable.
    assert!(arguments::arguments_de(&json!({})) == arguments::Arguments::Absents);
}

#[test]
fn le_texte_de_sortie_porte_ses_deux_formes() {
    // Mesuré : une LISTE de blocs pour function_call_output, une chaîne
    // ailleurs — les deux dans le même fichier.
    let liste = json!([
        { "type": "input_text", "text": "première" },
        { "type": "input_text", "text": "seconde" },
    ]);
    assert!(text::texte_de_sortie(&liste) == "premièreseconde");
    assert!(text::texte_de_sortie(&json!("chaîne nue")) == "chaîne nue");
    assert!(text::texte_de_sortie(&json!(42)).is_empty());
    // Le modèle entre chevrons n'est pas un modèle.
    assert!(
        text::modele_utilisable(&json!("claude-sonnet-4-6"))
            == Some(String::from("claude-sonnet-4-6"))
    );
    assert!(
        text::modele_utilisable(&json!("<synthetic>")).is_none(),
        "un substitut n'est pas un modèle"
    );
}

#[test]
fn le_codec_responses_traduit_les_quatre_formes_utiles() {
    // Un message assistant response_item.
    let ligne = responses::ligne_vers_pi(&json!({
        "timestamp": "2026-10-13T10:00:00Z", "ordinal": 11, "type": "response_item",
        "payload": { "type": "message", "role": "assistant",
                     "content": [{ "type": "output_text", "text": "Hello!" }] },
    }));
    match ligne {
        Some(ligne) => {
            assert!(
                ligne.kind == "message" && ligne.id.as_deref() == Some("codex:11:item"),
                "l'id codex:ordinal : {}",
                ligne.id.unwrap_or_default()
            );
            assert!(ligne.timestamp.as_deref() == Some("2026-10-13T10:00:00Z"));
        }
        None => panic!("un message assistant doit passer"),
    }
    // Un prompt utilisateur vit dans event_msg (mesuré : l'ignorer vide le
    // chat).
    let ligne = responses::ligne_vers_pi(&json!({
        "type": "event_msg",
        "payload": { "type": "item_completed", "item": { "type": "UserMessage", "id": "u1", "content": "liste les fichiers" } },
    }));
    match ligne {
        Some(ligne) => {
            assert!(
                ligne.id.as_deref() == Some("codex:u1:UserMessage")
                    || ligne.id.as_deref() == Some("codex:entry:u1"),
                "l'id de l'item : {:?}",
                ligne.id
            );
        }
        None => panic!("un prompt event_msg doit passer"),
    }
    // Une commande : la DERNIÈRE de la liste, code/cancelled portés.
    let ligne = responses::ligne_vers_pi(&json!({
        "type": "event_msg",
        "payload": { "type": "item_completed", "item": {
            "type": "CommandExecution", "id": "c1", "command": ["git", "status"],
            "exit_code": 0, "aggregated_output": "rien", "status": "completed" } },
    }));
    match ligne {
        Some(ligne) => {
            assert!(
                ligne.message.role.as_deref() == Some("bashExecution"),
                "le rôle bashExecution"
            );
            assert!(
                ligne.message.command.as_deref() == Some("status"),
                "la DERNIÈRE commande : {:?}",
                ligne.message.command
            );
        }
        None => panic!("une commande doit passer"),
    }
    // La réflexion CHIFFRÉE : dite masquée, jamais inventée.
    let ligne = responses::ligne_vers_pi(&json!({
        "type": "response_item",
        "payload": { "type": "reasoning" },
    }));
    match ligne {
        Some(ligne) => {
            let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
            assert!(contenu.contains("redacted"), "masquée, portée : {contenu}");
        }
        None => panic!("la réflexion masquée passe (comme masquée)"),
    }
}

#[test]
fn les_refus_du_codec_responses_sont_ceux_du_fichier() {
    // Le rôle developer = prompt système : écarté.
    assert!(responses::ligne_vers_pi(&json!({
        "type": "response_item",
        "payload": { "type": "message", "role": "developer", "content": [{ "type": "input_text", "text": "sois utile" }] },
    })).is_none(), "developer = consigne système, écartée");
    // Le contexte injecté (AGENTS.md avec <INSTRUCTIONS> + en-tête) : écarté.
    assert!(responses::ligne_vers_pi(&json!({
        "type": "response_item",
        "payload": { "type": "message", "role": "user",
                     "content": [{ "type": "input_text", "text": "# AGENTS.md instructions for X\n<INSTRUCTIONS>sois bref</INSTRUCTIONS>" }] },
    })).is_none(), "le contexte injecté n'est pas un message");
    // Un utilisateur qui PARLE de son AGENTS.md (sans <INSTRUCTIONS>) : gardé.
    match responses::ligne_vers_pi(&json!({
        "type": "response_item",
        "payload": { "type": "message", "role": "user",
                     "content": [{ "type": "input_text", "text": "# AGENTS.md instructions for X — relis-le" }] },
    })) {
        Some(_) => (),
        None => panic!("un utilisateur qui parle d'AGENTS.md n'est pas du contexte"),
    }
    // Une enveloppe inconnue : rien.
    assert!(responses::ligne_vers_pi(&json!({ "type": "autre_chose" })).is_none());
}

#[test]
fn le_reglage_codex_devient_un_changement_pi() {
    let reglage = responses::reglage_vers_pi(&json!({
        "type": "turn_context",
        "payload": { "model": "gpt-5", "effort": "high" },
    }));
    match reglage {
        Some(reglage) => {
            assert!(reglage.kind == domain::session::ReglageKind::ModelChange);
            assert!(reglage.model_id.as_deref() == Some("gpt-5"));
            assert!(reglage.thinking_level.as_deref() == Some("high"));
            assert!(
                reglage.provider.is_none(),
                "pas de fournisseur ici : on ne le devine pas"
            );
        }
        None => panic!("un turn_context avec modèle doit passer"),
    }
    // thread_settings_applied porte AUSSI le fournisseur.
    let reglage = responses::reglage_vers_pi(&json!({
        "type": "event_msg",
        "payload": { "type": "thread_settings_applied",
                     "thread_settings": { "model": "gpt-5", "model_provider_id": "openai", "reasoning_effort": "low" } },
    }));
    match reglage {
        Some(reglage) => {
            assert!(reglage.provider.as_deref() == Some("openai"));
            assert!(reglage.thinking_level.as_deref() == Some("low"));
        }
        None => panic!("thread_settings_applied doit passer"),
    }
    // Sans modèle : rien (un changement sans modèle n'existe pas).
    assert!(
        responses::reglage_vers_pi(&json!({
            "type": "turn_context", "payload": { "model": "<synthetic>" },
        }))
        .is_none(),
        "un substitut n'annonce pas un modèle"
    );
}

#[test]
fn le_codec_chat_ne_decode_pas_une_enveloppe_responses_par_hasard() {
    // Les enveloppes Responses : refusées ICI — les deux codecs ne
    // partagent rien.
    for enveloppe in [
        json!({ "type": "response_item", "payload": { "type": "message", "role": "assistant", "content": [] } }),
        json!({ "type": "event_msg", "payload": { "type": "item_completed" } }),
        json!({ "type": "turn_context", "payload": { "model": "gpt-5" } }),
    ].iter() {
        assert!(chat::ligne_vers_pi(enveloppe).is_none(), "une enveloppe Responses ne passe pas par Chat : {enveloppe}");
    }
    // Une ligne Chat : passe.
    match chat::ligne_vers_pi(&json!({ "role": "user", "content": "bonjour" })) {
        Some(ligne) => assert!(ligne.message.role.as_deref() == Some("user")),
        None => panic!("une ligne chat simple doit passer"),
    }
    // Les rôles hors conversation : refusés.
    assert!(chat::ligne_vers_pi(&json!({ "role": "system", "content": "x" })).is_none());
    // Une bulle vide : pas un message.
    assert!(chat::ligne_vers_pi(&json!({ "role": "user", "content": "  " })).is_none());
}

#[test]
fn le_codec_anthropic_trie_sur_le_type_jamais_sur_le_role() {
    // Le piège mesuré : api-request-blob porte un message.role user qui est
    // le prompt système — le TYPE doit le refuser.
    assert!(
        anthropique::ligne_vers_pi(&json!({
            "type": "api-request-blob",
            "message": { "role": "user", "content": "<system-reminder>sois utile</system-reminder>" },
        })).is_none(),
        "le tri se fait sur le TYPE, jamais sur le rôle"
    );
    // Une demande : chaîne nue.
    match anthropique::ligne_vers_pi(&json!({
        "type": "user", "uuid": "9054562f-7ce", "timestamp": "2026-10-16T12:00:00Z",
        "message": { "role": "user", "content": "hello" },
    })) {
        Some(ligne) => {
            assert!(
                ligne.id.as_deref() == Some("claude:9054562f-7ce"),
                "l'id claude:uuid : {:?}",
                ligne.id
            );
            assert!(ligne.timestamp.is_some());
        }
        None => panic!("une demande nue doit passer"),
    }
    // Une interruption : PAS une demande (15 % des lignes user mesurées).
    assert!(anthropique::ligne_vers_pi(&json!({
        "type": "user", "message": { "role": "user", "content": "[Request interrupted by user]" },
    })).is_none());
    // Un résultat d'outil : une ligne À PART (role user, forme API).
    match anthropique::ligne_vers_pi(&json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "call_1", "content": "sortie", "is_error": true }] },
    })) {
        Some(ligne) => {
            assert!(
                ligne.message.role.as_deref() == Some("toolResult"),
                "toolResult, pas user : {:?}",
                ligne.message.role
            );
            assert!(
                ligne.message.is_error == Some(true),
                "l'échec d'outil porte isError"
            );
        }
        None => panic!("un tool_result doit passer en toolResult"),
    }
    // Un assistant : texte + tool_use, le modèle porté.
    match anthropique::ligne_vers_pi(&json!({
        "type": "assistant",
        "message": { "role": "assistant", "model": "claude-sonnet-4-6",
                     "content": [ { "type": "text", "text": "je regarde" },
                                  { "type": "tool_use", "id": "call_1", "name": "Bash", "input": { "cmd": "ls" } } ] },
    })) {
        Some(ligne) => {
            assert!(
                ligne.message.model.as_deref() == Some("claude-sonnet-4-6"),
                "le modèle sur le message"
            );
            let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
            assert!(
                contenu.contains("toolCall") && contenu.contains("Bash"),
                "l'appel porté : {contenu}"
            );
        }
        None => panic!("un assistant avec texte + outil doit passer"),
    }
    // La commande à barre oblique : rendue NUTILE (nom + arguments), pas refusée.
    match anthropique::ligne_vers_pi(&json!({
        "type": "user",
        "message": { "role": "user", "content": "<command-name>/rapport</command-name><command-args>--bref</command-args>" },
    })) {
        Some(ligne) => {
            let contenu = serde_json::to_string(&ligne.message.content).unwrap_or_default();
            assert!(
                contenu.contains("/rapport --bref"),
                "la commande et ses arguments : {contenu}"
            );
        }
        None => panic!("une commande slash est une action utilisateur, pas un bruit"),
    }
    // Une ligne refusée se garde SANS message (le piège de la relecture).
    let ligne = json!({ "type": "user", "timestamp": "t", "message": { "role": "user", "content": "[Request interrupted by user]" } });
    assert!(
        anthropique::est_ligne_de_conversation(&ligne),
        "elle PRÉTEND porter la conversation"
    );
    let amputee = anthropique::sans_message(&ligne);
    assert!(amputee.get("message").is_none(), "le message est retiré");
    assert!(amputee.get("timestamp").is_some(), "le reste survit");
}

#[test]
fn le_codec_pi_est_une_identite_verifiee() {
    let ligne = json!({
        "type": "message", "id": "msg-0-u", "timestamp": "2024-03-05T08:00:00.000Z",
        "message": { "role": "user", "content": [{ "type": "text", "text": "coucou" }] },
    });
    assert!(
        pi::ligne_vers_pi(&ligne).is_some(),
        "une ligne pi passe telle quelle"
    );
    // Sans message : rien.
    assert!(pi::ligne_vers_pi(&json!({ "type": "message" })).is_none());
    // Sans type : rien.
    assert!(pi::ligne_vers_pi(&json!({ "message": { "content": [] } })).is_none());
}
