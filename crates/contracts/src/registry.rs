//! Le registre typé des **18 routes** — le manifeste unique (TECH §5).
//!
//! ⚠️ **Ni table à la main dans le routeur, ni table à la main dans
//! l'export.** Le routeur (T050+) s'enregistre depuis ici, l'export OpenAPI
//! (T009) lit ici ; toute variante de statut documentée dans CURRENT.md §2
//! est une entrée, toute entrée est documentée. Une route ou une réponse
//! absente du manifeste est un échec de test, pas un comportement tacite.
//!
//! ⚠️ Les corps ne sont **pas décodés** par le registre : chaque entrée
//! nomme le contrat qui décode (le type existe dans `http/`), et les tests
//! prouvent que chaque nom correspond à un type réel et décodable.

use crate::limits;
use serde::Serialize;

/// Les méthodes du fil actuel — GET et POST, rien de plus (H01–H18 mesurés).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Methode {
    Get,
    Post,
}

/// La politique mutante : POST = mutation (garde d'origine partagée), GET =
/// lecture. Mesurée, pas déduite de la méthode au fil du routeur.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Politique {
    Lecture,
    Mutation,
}

/// Les 19 routes, nommées — l'ordre du manifeste suit H01…H19.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RouteId {
    /// H01 — `GET /api/health`.
    Sante,
    /// H02 — `GET /api/overview`.
    Overview,
    /// H03 — `GET /api/conversations`.
    Conversations,
    /// H04 — `GET /api/agents/{paneId}/session`.
    SessionAgent,
    /// H05 — `POST /api/agents/{paneId}/prompt`.
    Prompt,
    /// H06 — `POST /api/agents/{paneId}/stop`.
    Arret,
    /// H07 — `POST /api/workspaces/{workspaceId}/agents`.
    Lancement,
    /// H08 — `GET /api/agents/kinds`.
    TypesInstalles,
    /// H09 — `GET /api/agents/{kind}/models`.
    CatalogueModeles,
    /// H10 — `POST /api/agents/{paneId}/answer`.
    ReponseQuestion,
    /// H11 — `POST /api/agents/{paneId}/focus`.
    Focus,
    /// H12 — `POST /api/agents/{paneId}/trust`.
    Confiance,
    /// H13 — `POST /api/log`.
    JournalClient,
    /// H14 — `GET /api/events` (SSE).
    FluxSse,
    /// H15 — `GET /api/notifications/vapid-key`.
    CleVapid,
    /// H16 — `POST /api/notifications/subscriptions`.
    Abonnements,
    /// H17 — `GET /api/file`.
    Fichier,
    /// H18 — `GET /api/images`.
    Images,
    /// H19 — `GET /api/agents/{paneId}/stream` (SSE de session, STREAMING.md).
    FluxSession,
}

/// La forme d'une réponse — le Content-Type est un fait du manifeste, pas
/// une décision du sérialiseur.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
pub enum Forme {
    /// JSON typé — le nom du contrat (le type vit dans `http/`).
    Json { schema: &'static str },
    /// Texte brut (H15 : la clef VAPID en `text/plain`).
    TexteBrut,
    /// Corps de fichier binaire/texte, type mesuré inclus (H17).
    CorpsFichier,
    /// 204 sans corps (H16).
    Vide,
    /// Flux SSE (`text/event-stream`, H14).
    FluxSse,
}

/// Une variante de réponse documentée.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
pub struct Variante {
    pub statut: u16,
    pub forme: Forme,
}

/// Un paramètre de requête (query) — requis ou optionnel (H17 : `path`
/// requis ; H04 : `tail`/`cursor`/`before` optionnels).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
pub struct ParametreRequete {
    pub nom: &'static str,
    pub requis: bool,
}

/// Ce que la route reçoit — corps, paramètres de chemin, query, entête.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
pub struct Entree {
    /// Les paramètres de chemin, dans l'ordre du gabarit.
    pub chemin: &'static [&'static str],
    /// Les paramètres query.
    pub requete: &'static [ParametreRequete],
    /// Les entêtes lues (H14 : `Last-Event-ID`).
    pub entete: &'static [&'static str],
    /// Le corps : JSON typé (avec sa limite propre, s'il y en a une),
    /// ignoré après garde (H06/H11 — Content-Type JSON exigé, corps non lu),
    /// ou aucun (GET).
    pub corps: Option<Corps>,
}

/// Le corps d'une requête.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
pub enum Corps {
    /// JSON typé — le contrat nommé décode ; la limite d'octets propre
    /// (`Some` = H05, 32 KiB UTF-8) s'ajoute à la garde globale.
    Json {
        schema: &'static str,
        octets_max: Option<usize>,
    },
    /// Content-Type JSON exigé, corps **non décodé** (mesuré H06/H11).
    Ignore,
}

/// Une entrée du manifeste.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
pub struct Route {
    pub id: RouteId,
    pub methode: Methode,
    /// Le gabarit exact du fil (`{paneId}` etc. — orthographe api.ts).
    pub chemin: &'static str,
    pub politique: Politique,
    pub entree: Entree,
    /// Les variantes **explicites** documentées (hors gardes partagées POST).
    pub variantes: &'static [Variante],
}

/// Les gardes **partagées** par toutes les routes POST (CURRENT.md §2) :
/// origine manquante/étrangère 403, Content-Type non JSON 415, Content-Length
/// déclaré au-delà de 64 KiB 413, mauvaise méthode 405 — toutes en
/// `ApiErrorResponse` (le corps du 405 aussi, mesuré).
pub const GARDES_POST: [Variante; 4] = [
    Variante {
        statut: 403,
        forme: Forme::Json {
            schema: "ApiErrorResponse",
        },
    },
    Variante {
        statut: 415,
        forme: Forme::Json {
            schema: "ApiErrorResponse",
        },
    },
    Variante {
        statut: 413,
        forme: Forme::Json {
            schema: "ApiErrorResponse",
        },
    },
    Variante {
        statut: 405,
        forme: Forme::Json {
            schema: "ApiErrorResponse",
        },
    },
];

/// Raccourci interne : une variante JSON nommée.
const fn json(statut: u16, schema: &'static str) -> Variante {
    Variante {
        statut,
        forme: Forme::Json { schema },
    }
}

/// Le manifeste complet — 18 entrées, dans l'ordre H01…H18, formes et
/// statuts exacts de CURRENT.md §2.
pub const ROUTES: [Route; 19] = [
    Route {
        id: RouteId::Sante,
        methode: Methode::Get,
        chemin: "/api/health",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: None,
        },
        variantes: &[
            json(200, "HealthResponse"),
            json(503, "HealthResponse"),
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Overview,
        methode: Methode::Get,
        chemin: "/api/overview",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: None,
        },
        variantes: &[json(200, "OverviewResponse"), json(500, "ApiErrorResponse")],
    },
    Route {
        id: RouteId::Conversations,
        methode: Methode::Get,
        chemin: "/api/conversations",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: None,
        },
        variantes: &[
            json(200, "ConversationsResponse"),
            json(503, "ConversationsResponse"),
            json(502, "ConversationsResponse"),
        ],
    },
    Route {
        id: RouteId::SessionAgent,
        methode: Methode::Get,
        chemin: "/api/agents/{paneId}/session",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[
                ParametreRequete {
                    nom: "tail",
                    requis: false,
                },
                ParametreRequete {
                    nom: "cursor",
                    requis: false,
                },
                ParametreRequete {
                    nom: "before",
                    requis: false,
                },
                // T025 : observe=0/1 (défaut 1) — la lecture qui ne
                // renouvelle pas le lease d'observation.
                ParametreRequete {
                    nom: "observe",
                    requis: false,
                },
            ],
            entete: &[],
            corps: None,
        },
        variantes: &[
            json(200, "SessionResponse"),
            json(400, "ApiErrorResponse"),
            json(403, "ApiErrorResponse"),
            json(404, "ApiErrorResponse"),
            json(409, "ApiErrorResponse"),
            json(422, "ApiErrorResponse"),
            json(502, "ApiErrorResponse"),
            json(503, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Prompt,
        methode: Methode::Post,
        chemin: "/api/agents/{paneId}/prompt",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Json {
                schema: "PromptRequest",
                octets_max: Some(limits::MAX_PROMPT_BYTES),
            }),
        },
        variantes: &[
            json(200, "PromptSentResponse"),
            json(200, "PromptSuppressedResponse"),
            json(400, "ApiErrorResponse"),
            json(413, "ApiErrorResponse"),
            json(502, "PromptFailedResponse"),
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Arret,
        methode: Methode::Post,
        chemin: "/api/agents/{paneId}/stop",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Ignore),
        },
        variantes: &[
            json(200, "StopAgentResponse"),
            json(404, "ApiErrorResponse"),
            json(502, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Lancement,
        methode: Methode::Post,
        chemin: "/api/workspaces/{workspaceId}/agents",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &["workspaceId"],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Json {
                schema: "LaunchAgentRequest",
                octets_max: None,
            }),
        },
        variantes: &[
            json(201, "LaunchAgentResponse"),
            json(409, "TrustRequiredResponse"),
            json(400, "ApiErrorResponse"),
            json(503, "ApiErrorResponse"),
            json(502, "ApiErrorResponse"),
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::TypesInstalles,
        methode: Methode::Get,
        chemin: "/api/agents/kinds",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: None,
        },
        variantes: &[
            json(200, "InstalledKindsResponse"),
            json(502, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::CatalogueModeles,
        methode: Methode::Get,
        chemin: "/api/agents/{kind}/models",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &["kind"],
            requete: &[],
            entete: &[],
            corps: None,
        },
        // Mesuré : AUCUNE branche non-200 de catalogue indisponible — le
        // non-soutien et l'indisponibilité sont des VALEURS du 200.
        variantes: &[json(200, "ModelCatalogResponse")],
    },
    Route {
        id: RouteId::ReponseQuestion,
        methode: Methode::Post,
        chemin: "/api/agents/{paneId}/answer",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Json {
                schema: "AnswerRequest",
                octets_max: None,
            }),
        },
        variantes: &[
            json(200, "QuestionAnsweredResponse"),
            json(400, "ApiErrorResponse"),
            json(502, "ApiErrorResponse"),
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Focus,
        methode: Methode::Post,
        chemin: "/api/agents/{paneId}/focus",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Ignore),
        },
        variantes: &[json(200, "AgentFocusedResponse")],
    },
    Route {
        id: RouteId::Confiance,
        methode: Methode::Post,
        chemin: "/api/agents/{paneId}/trust",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Json {
                schema: "TrustRequest",
                octets_max: None,
            }),
        },
        variantes: &[
            json(200, "TrustResolvedResponse"),
            json(400, "ApiErrorResponse"),
            json(502, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::JournalClient,
        methode: Methode::Post,
        chemin: "/api/log",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Json {
                schema: "ClientLogRequest",
                octets_max: None,
            }),
        },
        variantes: &[
            json(200, "ClientLogResponse"),
            // Le 400 est un {ok:false} — le MÊME schéma, pas une ApiError.
            json(400, "ClientLogResponse"),
        ],
    },
    Route {
        id: RouteId::FluxSse,
        methode: Methode::Get,
        chemin: "/api/events",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &["Last-Event-ID"],
            corps: None,
        },
        variantes: &[
            Variante {
                statut: 200,
                forme: Forme::FluxSse,
            },
            json(503, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::CleVapid,
        methode: Methode::Get,
        chemin: "/api/notifications/vapid-key",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: None,
        },
        variantes: &[
            Variante {
                statut: 200,
                forme: Forme::TexteBrut,
            },
            Variante {
                statut: 503,
                forme: Forme::TexteBrut,
            },
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Abonnements,
        methode: Methode::Post,
        chemin: "/api/notifications/subscriptions",
        politique: Politique::Mutation,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: Some(Corps::Json {
                schema: "PushBody",
                octets_max: None,
            }),
        },
        variantes: &[
            Variante {
                statut: 204,
                forme: Forme::Vide,
            },
            json(400, "ApiErrorResponse"),
            json(503, "ApiErrorResponse"),
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Fichier,
        methode: Methode::Get,
        chemin: "/api/file",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[ParametreRequete {
                nom: "path",
                requis: true,
            }],
            entete: &[],
            corps: None,
        },
        variantes: &[
            Variante {
                statut: 200,
                forme: Forme::CorpsFichier,
            },
            json(403, "ApiErrorResponse"),
            json(500, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::Images,
        methode: Methode::Get,
        chemin: "/api/images",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &[],
            requete: &[],
            entete: &[],
            corps: None,
        },
        variantes: &[
            json(200, "RecentImagesResponse"),
            json(502, "ApiErrorResponse"),
        ],
    },
    Route {
        id: RouteId::FluxSession,
        methode: Methode::Get,
        chemin: "/api/agents/{paneId}/stream",
        politique: Politique::Lecture,
        entree: Entree {
            chemin: &["paneId"],
            requete: &[ParametreRequete {
                nom: "cursor",
                requis: false,
            }],
            entete: &["Last-Event-ID"],
            corps: None,
        },
        variantes: &[
            Variante {
                statut: 200,
                forme: Forme::FluxSse,
            },
            json(404, "ApiErrorResponse"),
            json(503, "ApiErrorResponse"),
        ],
    },
];

/// L'entrée d'une route par son identifiant — toujours présente (le manifeste
/// est complet, testé).
#[must_use]
pub fn entree_de(id: RouteId) -> &'static Route {
    ROUTES
        .iter()
        .find(|route| route.id == id)
        .unwrap_or_else(|| panic!("route {id:?} absente du manifeste"))
}

/// La route pour une méthode et un chemin **gabarit** exacts — `None` pour
/// une route absente ou une méthode absente d'une route existante (le 405
/// du routeur se sert de ce fait-là).
#[must_use]
pub fn cherche(methode: Methode, chemin: &str) -> Option<&'static Route> {
    ROUTES
        .iter()
        .find(|route| route.methode == methode && route.chemin == chemin)
}

/// Les variantes **totales** d'une route : les explicites du manifeste, plus
/// les gardes partagées si la route est une mutation.
#[must_use]
pub fn variantes_totales(route: &Route) -> Vec<Variante> {
    let mut totales = route.variantes.to_vec();
    if route.politique == Politique::Mutation {
        totales.extend_from_slice(&GARDES_POST);
    }
    totales
}
