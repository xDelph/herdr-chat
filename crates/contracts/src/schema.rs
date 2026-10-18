//! La surface d'export des schémas (T009) : le bundle JSON Schema 2020-12,
//! la table des cibles du corpus, et la synthèse OpenAPI depuis le registre.
//!
//! ⚠️ **Une seule source** : les définitions viennent des DTO mêmes
//! (`schemars`), les routes du [`crate::registry`] — aucun tableau parallèle
//! réécrit à la main. Les sous-schémas sont **inline** : chaque document est
//! autonome (pas de `$defs` numérotés), donc déterministe octet pour octet.
//!
//! ⚠️ Les présences exactes survivent à l'export : `Field<T>` exporte le
//! schéma de `T` **sans null** (l'absence est une clé omise), `Nullable<T>`
//! exporte `anyOf [T, null]` — le validateur JS tranchera comme serde.

use crate::registry::{Forme, Methode, ROUTES, Route};
use schemars::generate::{SchemaGenerator, SchemaSettings};
use serde_json::{Map, Value, json};

/// La version du contrat exporté — change quand les DTO changent, jamais
/// entre deux exports identiques.
pub const VERSION: &str = "1.0.0";

pub const TITRE: &str = "herdr-remote API";

fn generateur() -> SchemaGenerator {
    let mut reglages = SchemaSettings::draft2020_12();
    reglages.inline_subschemas = true;
    SchemaGenerator::new(reglages)
}

fn schema_de<T: schemars::JsonSchema>() -> Value {
    let schema = generateur().into_root_schema_for::<T>();
    serde_json::to_value(&schema).unwrap_or_else(|cause| panic!("schéma invalide : {cause}"))
}

/// Toutes les définitions nommées — les DTO **et** les unions fermées qu'ils
/// portent. L'ordre est celui de la déclaration (déterministe) ; le test de
/// complétude compare cette liste aux noms que le registre et les cibles
/// utilisent.
pub fn definitions() -> Vec<(&'static str, Value)> {
    use crate::{AgentStatus, PushPayload, ReadSource, SessionRefKind, SessionState};
    vec![
        // http::health
        (
            "HealthResponse",
            schema_de::<crate::http::health::HealthResponse>(),
        ),
        (
            "HerdrHealth",
            schema_de::<crate::http::health::HerdrHealth>(),
        ),
        // http::overview
        ("AgentView", schema_de::<crate::http::overview::AgentView>()),
        (
            "WorkspaceView",
            schema_de::<crate::http::overview::WorkspaceView>(),
        ),
        (
            "OverviewResponse",
            schema_de::<crate::http::overview::OverviewResponse>(),
        ),
        // http::sessions
        (
            "SessionEntry",
            schema_de::<crate::http::sessions::SessionEntry>(),
        ),
        (
            "SessionResponse",
            schema_de::<crate::http::sessions::SessionResponse>(),
        ),
        // http::commands
        (
            "PromptRequest",
            schema_de::<crate::http::commands::PromptRequest>(),
        ),
        (
            "PromptSentResponse",
            schema_de::<crate::http::commands::PromptSentResponse>(),
        ),
        (
            "PromptSuppressedResponse",
            schema_de::<crate::http::commands::PromptSuppressedResponse>(),
        ),
        (
            "PromptFailedResponse",
            schema_de::<crate::http::commands::PromptFailedResponse>(),
        ),
        (
            "StopAgentResponse",
            schema_de::<crate::http::commands::StopAgentResponse>(),
        ),
        (
            "AgentFocusedResponse",
            schema_de::<crate::http::commands::AgentFocusedResponse>(),
        ),
        ("SendState", schema_de::<crate::http::commands::SendState>()),
        (
            "StopStatus",
            schema_de::<crate::http::commands::StopStatus>(),
        ),
        (
            "FocusStatus",
            schema_de::<crate::http::commands::FocusStatus>(),
        ),
        // http::launch
        (
            "LaunchAgentRequest",
            schema_de::<crate::http::launch::LaunchAgentRequest>(),
        ),
        (
            "LaunchAgentResponse",
            schema_de::<crate::http::launch::LaunchAgentResponse>(),
        ),
        (
            "LaunchFailed",
            schema_de::<crate::http::launch::LaunchFailed>(),
        ),
        (
            "LaunchPhase",
            schema_de::<crate::http::launch::LaunchPhase>(),
        ),
        // http::catalog
        (
            "InstalledKind",
            schema_de::<crate::http::catalog::InstalledKind>(),
        ),
        (
            "InstalledKindsResponse",
            schema_de::<crate::http::catalog::InstalledKindsResponse>(),
        ),
        (
            "AgentModel",
            schema_de::<crate::http::catalog::AgentModel>(),
        ),
        (
            "ModelCatalogResponse",
            schema_de::<crate::http::catalog::ModelCatalogResponse>(),
        ),
        // http::files
        (
            "RecentImage",
            schema_de::<crate::http::files::RecentImage>(),
        ),
        (
            "RecentImagesResponse",
            schema_de::<crate::http::files::RecentImagesResponse>(),
        ),
        // http::interactive
        (
            "TrustRequest",
            schema_de::<crate::http::interactive::TrustRequest>(),
        ),
        (
            "AnswerRequest",
            schema_de::<crate::http::interactive::AnswerRequest>(),
        ),
        (
            "TrustRequiredResponse",
            schema_de::<crate::http::interactive::TrustRequiredResponse>(),
        ),
        (
            "TrustResolvedResponse",
            schema_de::<crate::http::interactive::TrustResolvedResponse>(),
        ),
        (
            "QuestionAnsweredResponse",
            schema_de::<crate::http::interactive::QuestionAnsweredResponse>(),
        ),
        ("Choice", schema_de::<crate::http::interactive::Choice>()),
        (
            "Question",
            schema_de::<crate::http::interactive::Question>(),
        ),
        (
            "TrustState",
            schema_de::<crate::http::interactive::TrustState>(),
        ),
        (
            "AnswerState",
            schema_de::<crate::http::interactive::AnswerState>(),
        ),
        // http::conversations
        (
            "ConversationSummary",
            schema_de::<crate::http::conversations::ConversationSummary>(),
        ),
        (
            "ConversationsResponse",
            schema_de::<crate::http::conversations::ConversationsResponse>(),
        ),
        // http::errors
        (
            "ApiErrorResponse",
            schema_de::<crate::http::errors::ApiErrorResponse>(),
        ),
        ("ReadCause", schema_de::<crate::http::errors::ReadCause>()),
        // http::diagnostics
        (
            "ClientLogRequest",
            schema_de::<crate::http::diagnostics::ClientLogRequest>(),
        ),
        (
            "ClientLogResponse",
            schema_de::<crate::http::diagnostics::ClientLogResponse>(),
        ),
        // http::push
        (
            "SubscribeRequest",
            schema_de::<crate::http::push::SubscribeRequest>(),
        ),
        (
            "UnsubscribeRequest",
            schema_de::<crate::http::push::UnsubscribeRequest>(),
        ),
        ("PushBody", schema_de::<crate::http::push::PushBody>()),
        (
            "SubscriptionKeys",
            schema_de::<crate::http::push::SubscriptionKeys>(),
        ),
        // events
        ("EvenementSse", schema_de::<crate::events::EvenementSse>()),
        ("Ready", schema_de::<crate::events::Ready>()),
        ("Resync", schema_de::<crate::events::Resync>()),
        (
            "PromptDelivered",
            schema_de::<crate::events::PromptDelivered>(),
        ),
        (
            "PromptSuppressed",
            schema_de::<crate::events::PromptSuppressed>(),
        ),
        ("AgentLaunched", schema_de::<crate::events::AgentLaunched>()),
        (
            "AgentStatusChanged",
            schema_de::<crate::events::AgentStatusChanged>(),
        ),
        ("PromptStatus", schema_de::<crate::events::PromptStatus>()),
        ("Confirmation", schema_de::<crate::events::Confirmation>()),
        ("ChangeKind", schema_de::<crate::events::ChangeKind>()),
        // domain (réexports C01)
        ("AgentStatus", schema_de::<AgentStatus>()),
        ("SessionState", schema_de::<SessionState>()),
        ("ReadSource", schema_de::<ReadSource>()),
        ("PushPayload", schema_de::<PushPayload>()),
        ("SessionRefKind", schema_de::<SessionRefKind>()),
    ]
}

/// La table cible de corpus → nom de définition — **la même liste** que le
/// coureur de corpus de T007 (41 cibles) ; le test de T007 en vérifie
/// l'accord avec sa propre table de décodage.
pub fn cibles() -> Vec<(&'static str, &'static str)> {
    vec![
        ("AgentFocused", "AgentFocusedResponse"),
        ("AgentModel", "AgentModel"),
        ("AgentView", "AgentView"),
        ("AnswerBody", "AnswerRequest"),
        ("ApiError", "ApiErrorResponse"),
        ("Choix", "Choice"),
        ("ClientLogBody", "ClientLogRequest"),
        ("ConversationSummary", "ConversationSummary"),
        ("Conversations", "ConversationsResponse"),
        ("InstalledKind", "InstalledKind"),
        ("InstalledKinds", "InstalledKindsResponse"),
        ("LaunchAgent", "LaunchAgentResponse"),
        ("LaunchAgentRequest", "LaunchAgentRequest"),
        ("ModelCatalog", "ModelCatalogResponse"),
        ("Overview", "OverviewResponse"),
        ("PromptBody", "PromptRequest"),
        ("PromptFailed", "PromptFailedResponse"),
        ("PromptSent", "PromptSentResponse"),
        ("PromptSuppressed", "PromptSuppressedResponse"),
        ("PushPayload", "PushPayload"),
        ("Question", "Question"),
        ("QuestionAnswered", "QuestionAnsweredResponse"),
        ("ReadSource", "ReadSource"),
        ("RecentImage", "RecentImage"),
        ("RecentImages", "RecentImagesResponse"),
        ("SSE.agent-launched", "EvenementSse"),
        ("SSE.agent_status", "EvenementSse"),
        ("SSE.prompt", "EvenementSse"),
        ("SSE.prompt-suppressed", "EvenementSse"),
        ("SSE.ready", "EvenementSse"),
        ("SSE.resync", "EvenementSse"),
        ("SessionEntry", "SessionEntry"),
        ("SessionResponse", "SessionResponse"),
        ("SessionState", "SessionState"),
        ("StopAgent", "StopAgentResponse"),
        ("SubscribeBody", "SubscribeRequest"),
        ("TrustBody", "TrustRequest"),
        ("TrustRequired", "TrustRequiredResponse"),
        ("TrustResolved", "TrustResolvedResponse"),
        ("UnsubscribeBody", "UnsubscribeRequest"),
        ("WorkspaceView", "WorkspaceView"),
    ]
}

/// Le bundle JSON Schema 2020-12 — `{"$schema", "$defs": {nom: schéma}}`.
/// Un nom apparaissant deux fois avec des contenus différents est un échec
/// (jamais une fusion silencieuse).
pub fn bundle() -> Value {
    let mut defs = Map::new();
    for (nom, schema) in definitions() {
        let deja = defs.insert(nom.to_string(), schema);
        if deja.is_some() {
            panic!("définition en double : {nom}");
        }
    }
    for (cible, nom) in cibles() {
        assert!(
            defs.contains_key(nom),
            "la cible {cible} pointe vers la définition absente {nom}"
        );
    }
    for route in ROUTES.iter() {
        for variante in route.variantes.iter() {
            if let Forme::Json { schema } = variante.forme {
                assert!(
                    defs.contains_key(schema),
                    "la route {:?} nomme le schéma absent {schema}",
                    route.id
                );
            }
        }
        if let Some(crate::registry::Corps::Json { schema, .. }) = route.entree.corps {
            assert!(
                defs.contains_key(schema),
                "la route {:?} nomme le corps absent {schema}",
                route.id
            );
        }
    }
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$defs": defs,
    })
}

/// La description humaine d'une variante, pour le champ `description` des
/// réponses OpenAPI — factuelle, jamais un verdict inventé.
fn description_de_statut(route: &Route, statut: u16) -> String {
    if let Some(variante) = route.variantes.iter().find(|v| v.statut == statut) {
        match variante.forme {
            Forme::Json { schema } => {
                format!("Réponse {statut} — {schema}")
            }
            Forme::TexteBrut => format!("Réponse {statut} — texte brut"),
            Forme::CorpsFichier => format!("Réponse {statut} — corps de fichier typé"),
            Forme::Vide => format!("Réponse {statut} — sans corps"),
            Forme::FluxSse => format!("Réponse {statut} — flux text/event-stream"),
        }
    } else {
        format!("Réponse {statut} — garde partagée des POST (CURRENT.md §2)")
    }
}

/// Le type de contenu d'une forme.
fn content_type(forme: &Forme) -> Option<&'static str> {
    match forme {
        Forme::Json { .. } => Some("application/json"),
        Forme::TexteBrut => Some("text/plain; charset=utf-8"),
        Forme::CorpsFichier => None, // type mesuré par fichier — voir les handlers
        Forme::Vide => None,
        Forme::FluxSse => Some("text/event-stream"),
    }
}

/// La synthèse OpenAPI 3.1 **depuis le registre** — aucune table parallèle :
/// chaque route du manifeste devient un chemin, chaque variante une réponse.
pub fn openapi() -> Value {
    let mut chemins = Map::new();
    for route in ROUTES.iter() {
        let methode = match route.methode {
            Methode::Get => "get",
            Methode::Post => "post",
        };
        let mut parametres: Vec<Value> = Vec::new();
        for nom in route.entree.chemin.iter() {
            parametres.push(json!({
                "name": nom,
                "in": "path",
                "required": true,
                "schema": { "type": "string" },
            }));
        }
        for parametre in route.entree.requete.iter() {
            parametres.push(json!({
                "name": parametre.nom,
                "in": "query",
                "required": parametre.requis,
                "schema": { "type": "string" },
            }));
        }
        for nom in route.entree.entete.iter() {
            parametres.push(json!({
                "name": nom,
                "in": "header",
                "required": false,
                "schema": { "type": "string" },
            }));
        }
        let mut operation = Map::new();
        operation.insert(
            String::from("operationId"),
            Value::String(operation_id(route)),
        );
        if !parametres.is_empty() {
            operation.insert(String::from("parameters"), Value::Array(parametres));
        }
        if let Some(crate::registry::Corps::Json { schema, octets_max }) = route.entree.corps {
            let mut desc = format!("Corps JSON — {schema}");
            if let Some(max) = octets_max {
                desc.push_str(&format!(" (limite {max} octets)"));
            }
            operation.insert(
                String::from("requestBody"),
                json!({
                    "required": true,
                    "content": {
                        "application/json": {
                            "schema": { "$ref": format!("#/components/schemas/{schema}") },
                            "x-octets-max": octets_max.map(|m| Value::from(m as u64)).unwrap_or(Value::Null),
                            "description": desc,
                        }
                    },
                }),
            );
        } else {
            // Corps::Ignore : Content-Type JSON exigé, corps non décodé.
            operation.insert(
                String::from("requestBody"),
                json!({
                    "required": false,
                    "content": {
                        "application/json": { "schema": {}, "description": "corps ignoré après garde" }
                    },
                }),
            );
        }
        let mut reponses = Map::new();
        for variante in variantes_union(route) {
            let description = description_de_statut(route, variante.statut);
            let mut entree_reponse = Map::new();
            entree_reponse.insert(String::from("description"), Value::String(description));
            if let Some(type_contenu) = content_type(&variante.forme) {
                let contenu = match variante.forme {
                    Forme::Json { schema } => json!({
                        "schema": { "$ref": format!("#/components/schemas/{schema}") }
                    }),
                    Forme::TexteBrut => json!({ "schema": { "type": "string" } }),
                    Forme::FluxSse => json!({ "schema": { "type": "string" } }),
                    _ => Value::Null,
                };
                entree_reponse.insert(String::from("content"), json!({ type_contenu: contenu }));
            }
            reponses.insert(variante.statut.to_string(), Value::Object(entree_reponse));
        }
        operation.insert(String::from("responses"), Value::Object(reponses));
        let chemin = route.chemin;
        let entry = chemins
            .entry(chemin.to_string())
            .or_insert_with(|| json!({}));
        match entry.as_object_mut() {
            Some(objet) => {
                objet.insert(methode.to_string(), Value::Object(operation));
            }
            None => panic!("chemin {chemin} : objet attendu"),
        }
    }
    let definitions_bundle = definitions();
    let mut schemas = Map::new();
    for (nom, mut schema) in definitions_bundle {
        replacer_refs(&mut schema, "#/$defs/", "#/components/schemas/");
        schemas.insert(nom.to_string(), schema);
    }
    json!({
        "openapi": "3.1.0",
        "info": { "title": TITRE, "version": VERSION },
        "paths": Value::Object(chemins),
        "components": { "schemas": Value::Object(schemas) },
    })
}

fn operation_id(route: &Route) -> String {
    // Identifiant stable et unique : H-numéro + nom kebab du variant.
    let rang = ROUTES
        .iter()
        .position(|r| r.id == route.id)
        .unwrap_or_default()
        + 1;
    format!("h{rang:02}-{}", kebab_du_variant(route.id))
}

fn kebab_du_variant(id: crate::registry::RouteId) -> String {
    let brut = format!("{id:?}");
    let mut kebab = String::new();
    for (index, caractere) in brut.char_indices() {
        if caractere.is_uppercase() && index > 0 {
            kebab.push('-');
            kebab.extend(caractere.to_lowercase());
        } else {
            kebab.extend(caractere.to_lowercase());
        }
    }
    kebab
}

/// Les variantes **union** : explicites + gardes partagées des POST (même
/// composition que `variantes_totales`, sans dépendre d'ici au registre).
fn variantes_union(route: &Route) -> Vec<crate::registry::Variante> {
    let mut union = route.variantes.to_vec();
    if route.politique == crate::registry::Politique::Mutation {
        union.extend_from_slice(&crate::registry::GARDES_POST);
    }
    union
}

/// Réécrit les `$ref` internes d'un schéma vers une autre racine.
fn replacer_refs(valeur: &mut Value, depuis: &str, vers: &str) {
    match valeur {
        Value::Object(objet) => {
            if let Some(Value::String(reference)) = objet.get_mut("$ref")
                && reference.starts_with(depuis)
            {
                let suite = reference[depuis.len()..].to_string();
                *reference = format!("{vers}{suite}");
            }
            for (_cle, enfant) in objet.iter_mut() {
                replacer_refs(enfant, depuis, vers);
            }
        }
        Value::Array(tableau) => {
            for enfant in tableau.iter_mut() {
                replacer_refs(enfant, depuis, vers);
            }
        }
        _ => (),
    }
}
