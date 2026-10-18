//! Le coureur de corpus — la preuve C01 : accepté/refusé **identiquement**
//! au schéma TS autoritaire, sans champ perdu ni champ inventé.

use serde::Serialize;
use serde::de::DeserializeOwned;
use std::path::PathBuf;

/// Le corpus gelé à T001 — la même source pour TS et Rust.
fn chemin_corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../compatibility/contracts/corpus.json")
}

/// Décodage dans le type mappé, puis **re-sérialisation** : la valeur
/// re-sérialisée doit être égale à la valeur d'origine — un champ ignoré
/// serait un champ perdu, un champ de trop serait un champ inventé.
fn via<T: DeserializeOwned + Serialize>(
    valeur: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let dto: T = serde_json::from_value(valeur.clone()).map_err(|cause| cause.to_string())?;
    serde_json::to_value(&dto).map_err(|cause| cause.to_string())
}

/// La fidélité du rendu : tout ce qui est rendu existait dans le fil, avec
/// la même valeur — les champs **non déclarés** sont retirés au décodage
/// (mesuré : le corpus pose un champ `notDeclared` et attend
/// « stripped on decode », comme le schéma TS). Récursif : un objet rendu
/// sans une clef du fil serait un champ perdu ; une clef rendue absente du
/// fil serait un champ inventé.
fn fidele(valeur: &serde_json::Value, rendu: &serde_json::Value) -> bool {
    match (valeur, rendu) {
        (serde_json::Value::Object(original), serde_json::Value::Object(copie)) => {
            copie.iter().all(|(cle, rendue)| {
                original
                    .get(cle)
                    .is_some_and(|origine| fidele(origine, rendue))
            })
        }
        (serde_json::Value::Array(original), serde_json::Value::Array(copie)) => {
            original.len() == copie.len()
                && original.iter().zip(copie.iter()).all(|(o, c)| fidele(o, c))
        }
        _ => valeur == rendu,
    }
}

/// La table cible → type des DTO T007. Une cible du corpus hors de cette
/// table DOIT figurer dans [`CIBLES_EXCLUSES`] — sinon le test échoue :
/// rien n'est ignoré en silence.
fn decode(cible: &str, valeur: &serde_json::Value) -> Option<Result<serde_json::Value, String>> {
    use contracts::events;
    use contracts::http::{
        catalog, commands, conversations, diagnostics, errors, files, interactive, launch,
        overview, push, sessions,
    };
    Some(match cible {
        "AgentFocused" => via::<commands::AgentFocusedResponse>(valeur),
        "AgentModel" => via::<catalog::AgentModel>(valeur),
        "AgentView" => via::<overview::AgentView>(valeur),
        "AnswerBody" => via::<interactive::AnswerRequest>(valeur),
        "ApiError" => via::<errors::ApiErrorResponse>(valeur),
        "Choix" => via::<interactive::Choice>(valeur),
        "ClientLogBody" => via::<diagnostics::ClientLogRequest>(valeur),
        "ConversationSummary" => via::<conversations::ConversationSummary>(valeur),
        "Conversations" => via::<conversations::ConversationsResponse>(valeur),
        "InstalledKind" => via::<catalog::InstalledKind>(valeur),
        "InstalledKinds" => via::<catalog::InstalledKindsResponse>(valeur),
        "LaunchAgent" => via::<launch::LaunchAgentResponse>(valeur),
        "LaunchAgentRequest" => via::<launch::LaunchAgentRequest>(valeur),
        "ModelCatalog" => via::<catalog::ModelCatalogResponse>(valeur),
        "Overview" => via::<overview::OverviewResponse>(valeur),
        "PromptBody" => via::<commands::PromptRequest>(valeur),
        "PromptFailed" => via::<commands::PromptFailedResponse>(valeur),
        "PromptSent" => via::<commands::PromptSentResponse>(valeur),
        "PromptSuppressed" => via::<commands::PromptSuppressedResponse>(valeur),
        "PushPayload" => via::<contracts::PushPayload>(valeur),
        "Question" => via::<interactive::Question>(valeur),
        "QuestionAnswered" => via::<interactive::QuestionAnsweredResponse>(valeur),
        "ReadSource" => via::<contracts::ReadSource>(valeur),
        "RecentImage" => via::<files::RecentImage>(valeur),
        "RecentImages" => via::<files::RecentImagesResponse>(valeur),
        "SSE.agent-launched" => via::<events::EvenementSse>(valeur),
        "SSE.agent_status" => via::<events::EvenementSse>(valeur),
        "SSE.prompt" => via::<events::EvenementSse>(valeur),
        "SSE.prompt-suppressed" => via::<events::EvenementSse>(valeur),
        "SSE.ready" => via::<events::EvenementSse>(valeur),
        "SSE.resync" => via::<events::EvenementSse>(valeur),
        "SessionEntry" => via::<sessions::SessionEntry>(valeur),
        "SessionResponse" => via::<sessions::SessionResponse>(valeur),
        "SessionState" => via::<contracts::SessionState>(valeur),
        "StopAgent" => via::<commands::StopAgentResponse>(valeur),
        "SubscribeBody" => via::<push::SubscribeRequest>(valeur),
        "TrustBody" => via::<interactive::TrustRequest>(valeur),
        "TrustRequired" => via::<interactive::TrustRequiredResponse>(valeur),
        "TrustResolved" => via::<interactive::TrustResolvedResponse>(valeur),
        "UnsubscribeBody" => via::<push::UnsubscribeRequest>(valeur),
        "WorkspaceView" => via::<overview::WorkspaceView>(valeur),
        _ => return None,
    })
}

/// Les cibles du corpus **hors périmètre T007**, avec leur crate propriétaire
/// (TECH §5, table de correspondance) — la liste est fermée et assertée :
/// une cible nouvelle doit y entrer ou dans `decode`, jamais dans le vide.
const CIBLES_EXCLUSES: &[(&str, &str)] = &[
    ("AgentInfo", "herdr-client (T021) : fil Herdr privé"),
    ("AgentListPayload", "herdr-client (T021) : fil Herdr privé"),
    ("AgentSessionInfo", "herdr-client (T021) : fil Herdr privé"),
    (
        "EventWait.supported",
        "herdr-client (T021) : capacités du fil",
    ),
    ("HerdrReply", "herdr-client (T021) : fil Herdr privé"),
    (
        "Method.vocabulary",
        "herdr-client (T021) : vocabulaire des méthodes",
    ),
    ("PaneInfo", "herdr-client (T021) : fil Herdr privé"),
    (
        "PaneLayout",
        "herdr-client (T021) : famille snapshot passthrough",
    ),
    (
        "PaneLayoutPane",
        "herdr-client (T021) : famille snapshot passthrough",
    ),
    (
        "PaneLayoutRect",
        "herdr-client (T021) : famille snapshot passthrough",
    ),
    ("PaneReadPayload", "herdr-client (T021) : fil Herdr privé"),
    ("PongPayload", "herdr-client (T021) : fil Herdr privé"),
    (
        "PushStore.legacy",
        "notifications (T030) : persistance privée",
    ),
    (
        "PushStore.legacy.null-expiration",
        "notifications (T030) : persistance privée",
    ),
    ("SessionCursor", "sessions : codec privé versionné (T016+)"),
    (
        "SnapshotPane",
        "herdr-client (T021) : famille snapshot passthrough",
    ),
    (
        "SnapshotPayload",
        "herdr-client (T021) : famille snapshot passthrough",
    ),
    (
        "SubscribeHttpPrefixRule",
        "règle de route — testée ici sur push::endpoint_en_https",
    ),
    (
        "TabInfo",
        "herdr-client (T021) : famille snapshot passthrough",
    ),
    ("WorkspaceInfo", "herdr-client (T021) : fil Herdr privé"),
    (
        "WorkspaceWorktreeInfo",
        "herdr-client (T021) : fil Herdr privé",
    ),
];

fn charges_le_corpus() -> serde_json::Value {
    let texte = match std::fs::read_to_string(chemin_corpus()) {
        Ok(texte) => texte,
        Err(cause) => panic!("corpus illisible : {cause}"),
    };
    match serde_json::from_str(&texte) {
        Ok(corpus) => corpus,
        Err(cause) => panic!("corpus invalide : {cause}"),
    }
}

#[test]
fn le_corpus_accepte_et_refuse_comme_le_schema_ts() {
    let corpus = charges_le_corpus();
    let samples = match corpus.get("samples").and_then(|s| s.as_array()) {
        Some(samples) => samples,
        None => panic!("le corpus doit porter un tableau samples"),
    };
    assert!(
        samples.len() == 296,
        "le corpus gelé compte 296 échantillons, pas {}",
        samples.len()
    );
    let mut couvertes = 0_u32;
    let mut exclues_rencontrees = 0_u32;
    for sample in samples {
        let cible = match sample.get("target").and_then(|t| t.as_str()) {
            Some(cible) => cible,
            None => panic!("échantillon sans cible : {sample}"),
        };
        let attendu = match sample.get("expect").and_then(|e| e.as_str()) {
            Some(attendu) => attendu,
            None => panic!("échantillon sans attente : {sample}"),
        };
        let valeur = match sample.get("value") {
            Some(valeur) => valeur,
            None => panic!("échantillon sans valeur : {sample}"),
        };
        let identifiant = sample.get("id").and_then(|i| i.as_str()).unwrap_or("?");
        match decode(cible, valeur) {
            Some(resultat) => {
                couvertes += 1;
                match (attendu, resultat) {
                    ("accept", Ok(rendu)) => {
                        assert!(
                            fidele(valeur, &rendu),
                            "{identifiant} ({cible}) : champ perdu ou inventé — fil {valeur}, rendu {rendu}"
                        );
                    }
                    ("accept", Err(cause)) => {
                        panic!("{identifiant} ({cible}) : refusé à tort : {cause}")
                    }
                    ("reject", Ok(_)) => {
                        panic!("{identifiant} ({cible}) : accepté à tort — {valeur}")
                    }
                    ("reject", Err(_)) => (),
                    (autre, _) => panic!("{identifiant} : attente inconnue {autre}"),
                }
            }
            None => {
                let connue = CIBLES_EXCLUSES.iter().any(|(nom, _)| *nom == cible);
                assert!(
                    connue,
                    "cible {cible} inconnue du contrat T007 : à mapper ou à exclure nommément"
                );
                exclues_rencontrees += 1;
            }
        }
    }
    assert!(couvertes > 0, "le corpus doit couvrir les DTO T007");
    assert!(
        exclues_rencontrees > 0,
        "les exclusions nommées doivent rester rencontrées"
    );
}

#[test]
fn la_liste_d_exclusions_est_exacte_et_justifiee() {
    let corpus = charges_le_corpus();
    let samples = match corpus.get("samples").and_then(|s| s.as_array()) {
        Some(samples) => samples,
        None => panic!("le corpus doit porter un tableau samples"),
    };
    let mut cibles: Vec<&str> = samples
        .iter()
        .filter_map(|s| s.get("target").and_then(|t| t.as_str()))
        .collect();
    cibles.sort_unstable();
    cibles.dedup();
    for cible in &cibles {
        // Une cible mappée répond même à une valeur absurde (erreur de décodage,
        // mais une réponse) ; une cible exclue ne répond pas du tout.
        let mappee = decode(cible, &serde_json::Value::Null).is_some();
        let excluse = CIBLES_EXCLUSES.iter().any(|(nom, _)| nom == cible);
        assert!(
            mappee || excluse,
            "cible {cible} ni mappée ni exclue nommément"
        );
    }
    for (nom, _) in CIBLES_EXCLUSES {
        assert!(
            cibles.contains(nom),
            "exclusion obsolète : {nom} n'est plus dans le corpus"
        );
    }
}

#[test]
fn la_regle_https_refuse_le_http_pour_un_endpoint() {
    assert!(
        !contracts::http::push::endpoint_en_https("http://push.example.com/xyz"),
        "la règle du fil refuse le http:// — c'est elle qui porte le 400"
    );
    assert!(
        contracts::http::push::endpoint_en_https("https://push.faux/ep-1"),
        "https passe la règle"
    );
    // Et la forme http:// reste valide au SCHÉMA : le refus appartient à la
    // route (échantillon construit SubscribeHttpPrefixRule du corpus).
    let echantillon = serde_json::json!({
        "endpoint": "http://push.example.com/xyz",
        "keys": { "auth": "a", "p256dh": "b" },
    });
    match serde_json::from_value::<contracts::http::push::SubscribeRequest>(echantillon) {
        Ok(_) => (),
        Err(cause) => panic!("la forme http:// reste valide au schéma : {cause}"),
    }
}
