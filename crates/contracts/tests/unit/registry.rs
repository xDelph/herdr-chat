//! Le manifeste des 18 routes — Correspondance exacte avec H01–H18 (CURRENT.md §2),
//! variantes incluses, et le négatif : une route ou une réponse absente
//! se **voit**, jamais tolérée.
//! Prouve : C01.

use contracts::registry::{
    Corps, Forme, Methode, Politique, ROUTES, RouteId, cherche, entree_de, variantes_totales,
};
use contracts::{limits, registry};

#[test]
fn le_manifeste_compte_22_routes_distinctes() {
    assert!(
        ROUTES.len() == 22,
        "22 routes documentées, pas {}",
        ROUTES.len()
    );
    for (rang, route) in ROUTES.iter().enumerate() {
        let attendu = match rang {
            0 => RouteId::Sante,
            1 => RouteId::Overview,
            2 => RouteId::Conversations,
            3 => RouteId::SessionAgent,
            4 => RouteId::Prompt,
            5 => RouteId::Arret,
            6 => RouteId::Lancement,
            7 => RouteId::TypesInstalles,
            8 => RouteId::CatalogueModeles,
            9 => RouteId::ReponseQuestion,
            10 => RouteId::Focus,
            11 => RouteId::Confiance,
            12 => RouteId::JournalClient,
            13 => RouteId::FluxSse,
            14 => RouteId::CleVapid,
            15 => RouteId::Abonnements,
            16 => RouteId::Fichier,
            17 => RouteId::Images,
            18 => RouteId::FluxSession,
            19 => RouteId::TachesDeFond,
            20 => RouteId::SessionDeTache,
            _ => RouteId::Lecture,
        };
        assert!(
            route.id == attendu,
            "la route {rang} doit être {attendu:?}, pas {:?}",
            route.id
        );
    }
    for (rang, route) in ROUTES.iter().enumerate() {
        for autre in ROUTES.iter().skip(rang + 1) {
            assert!(
                route.id != autre.id,
                "chaque identifiant apparaît une seule fois : {:?}",
                route.id
            );
        }
    }
}

#[test]
fn les_chemins_et_methodes_sont_ceux_du_fil() {
    let attendues: [(Methode, &str); 18] = [
        (Methode::Get, "/api/health"),
        (Methode::Get, "/api/overview"),
        (Methode::Get, "/api/conversations"),
        (Methode::Get, "/api/agents/{paneId}/session"),
        (Methode::Post, "/api/agents/{paneId}/prompt"),
        (Methode::Post, "/api/agents/{paneId}/stop"),
        (Methode::Post, "/api/workspaces/{workspaceId}/agents"),
        (Methode::Get, "/api/agents/kinds"),
        (Methode::Get, "/api/agents/{kind}/models"),
        (Methode::Post, "/api/agents/{paneId}/answer"),
        (Methode::Post, "/api/agents/{paneId}/focus"),
        (Methode::Post, "/api/agents/{paneId}/trust"),
        (Methode::Post, "/api/log"),
        (Methode::Get, "/api/events"),
        (Methode::Get, "/api/notifications/vapid-key"),
        (Methode::Post, "/api/notifications/subscriptions"),
        (Methode::Get, "/api/file"),
        (Methode::Get, "/api/images"),
    ];
    for (route, (methode, chemin)) in ROUTES.iter().zip(attendues.iter()) {
        assert!(
            route.methode == *methode && route.chemin == *chemin,
            "{:?} : attendu {methode:?} {chemin}, trouvé {:?} {}",
            route.id,
            route.methode,
            route.chemin
        );
    }
}

#[test]
fn la_politique_mutante_est_mesuree() {
    for route in ROUTES.iter() {
        let attendue = match route.methode {
            Methode::Post => Politique::Mutation,
            Methode::Get => Politique::Lecture,
        };
        assert!(
            route.politique == attendue,
            "{:?} : la politique suit la méthode mesurée",
            route.id
        );
    }
}

#[test]
fn les_variantes_explicites_sont_toutes_documentees() {
    // Statuts explicites par route — transcription de CURRENT.md §2, une
    // ligne par route, dans l'ordre H01…H18.
    let attendues: [&[u16]; 22] = [
        &[200, 503, 500],                          // H01 santé
        &[200, 500],                               // H02 overview
        &[200, 503, 502],                          // H03 conversations
        &[200, 400, 403, 404, 409, 422, 502, 503], // H04 session
        &[200, 200, 400, 413, 502, 500],           // H05 prompt (DEUX 200 : envoyé ou supprimé)
        &[200, 404, 502],                          // H06 arrêt
        &[201, 409, 400, 503, 502, 500],           // H07 lancement
        &[200, 502],                               // H08 kinds
        &[200],                // H09 modèles — aucune branche non-200 documentée
        &[200, 400, 502, 500], // H10 answer
        &[200],                // H11 focus — garde partagée seulement
        &[200, 400, 502],      // H12 trust
        &[200, 400],           // H13 log — le 400 est un {ok:false}
        &[200, 503],           // H14 events
        &[200, 503, 500],      // H15 vapid
        &[204, 400, 503, 500], // H16 subscriptions
        &[200, 403, 500],      // H17 file
        &[200, 502],           // H18 images
        &[200, 404, 503],      // H19 flux de session
        &[200, 404, 502, 503], // H20 tâches de fond
        &[200, 400, 403, 404, 409, 422, 502, 503], // H21 transcription d'une tâche
        &[200, 400],           // H22 lecture partagée
    ];
    for (route, attendu) in ROUTES.iter().zip(attendues.iter()) {
        let trouves: Vec<u16> = route.variantes.iter().map(|v| v.statut).collect();
        assert!(
            trouves == attendu.to_vec(),
            "{:?} : statuts {trouves:?}, documentés {attendu:?}",
            route.id
        );
    }
}

#[test]
fn les_formes_non_json_ont_leur_place_nommee() {
    // H14 : flux SSE ; H15 : texte brut (200 ET 503) ; H16 : 204 vide ;
    // H17 : corps de fichier.
    let sse = entree_de(RouteId::FluxSse);
    assert!(
        sse.variantes
            .iter()
            .any(|v| v.statut == 200 && v.forme == Forme::FluxSse),
        "le flux SSE est une forme nommée"
    );
    let vapid = entree_de(RouteId::CleVapid);
    assert!(
        vapid
            .variantes
            .iter()
            .any(|v| v.statut == 200 && v.forme == Forme::TexteBrut)
            && vapid
                .variantes
                .iter()
                .any(|v| v.statut == 503 && v.forme == Forme::TexteBrut),
        "la clef VAPID est du texte brut, même en 503"
    );
    let abonnements = entree_de(RouteId::Abonnements);
    assert!(
        abonnements
            .variantes
            .iter()
            .any(|v| v.statut == 204 && v.forme == Forme::Vide),
        "l'acquittement push est un 204 sans corps"
    );
    let fichier = entree_de(RouteId::Fichier);
    assert!(
        fichier
            .variantes
            .iter()
            .any(|v| v.statut == 200 && v.forme == Forme::CorpsFichier),
        "le corps de fichier est une forme nommée"
    );
}

#[test]
fn les_corps_nommes_pointent_vers_des_contrats_reels() {
    // Chaque corps nommé doit désigner un schéma que le coureur de corpus
    // connaît — la liste des noms est tenue avec les DTO (C01).
    for route in ROUTES.iter() {
        if let Some(Corps::Json { schema, .. }) = route.entree.corps {
            let connus = [
                "PromptRequest",
                "LaunchAgentRequest",
                "AnswerRequest",
                "TrustRequest",
                "ClientLogRequest",
                "PushBody",
                "MarkReadRequest",
            ];
            assert!(
                connus.contains(&schema),
                "{:?} : corps {schema} hors des contrats nommés",
                route.id
            );
        }
    }
    // Les deux routes à corps ignoré après garde (mesuré H06/H11).
    for (id, autre) in [(RouteId::Arret, "stop"), (RouteId::Focus, "focus")] {
        let route = entree_de(id);
        assert!(
            route.entree.corps == Some(Corps::Ignore),
            "{autre} : corps ignoré après garde"
        );
    }
    // Le prompt porte sa limite propre ; elle vient de limits.
    let prompt = entree_de(RouteId::Prompt);
    match prompt.entree.corps {
        Some(Corps::Json { octets_max, .. }) => {
            assert!(
                octets_max == Some(limits::MAX_PROMPT_BYTES),
                "le prompt est borné à 32 KiB"
            );
        }
        autre => panic!("le prompt doit porter un corps JSON borné, pas {autre:?}"),
    }
    // H17 : la query `path` est requise ; H04 : toutes les query optionnelles.
    let fichier = entree_de(RouteId::Fichier);
    let path = fichier
        .entree
        .requete
        .iter()
        .find(|parametre| parametre.nom == "path")
        .unwrap_or_else(|| panic!("la query path doit exister"));
    assert!(path.requis, "la query path est requise (403 sinon)");
    for parametre in entree_de(RouteId::SessionAgent).entree.requete.iter() {
        assert!(!parametre.requis, "{} reste optionnelle", parametre.nom);
    }
}

#[test]
fn les_gardes_post_partagees_composent_avec_les_explicites() {
    for route in ROUTES.iter() {
        let totales = variantes_totales(route);
        if route.politique == Politique::Mutation {
            for garde in [403, 415, 413, 405] {
                assert!(
                    totales.iter().any(|v| v.statut == garde),
                    "{:?} : la garde partagée {garde} doit composer",
                    route.id
                );
            }
        } else {
            // Statuts réservés aux gardes POST : une lecture ne les porte
            // jamais. (Le 403, lui, existe aussi en explicite documenté sur
            // des lectures — H04 chemin rejeté, H17 fichier refusé.)
            for garde in [415, 413, 405] {
                assert!(
                    !route.variantes.iter().any(|v| v.statut == garde),
                    "{:?} : une lecture ne porte pas la garde POST {garde}",
                    route.id
                );
            }
        }
    }
    // H05 porte déjà un 413 propre (limite de texte) : pas de doublon.
    let prompt = variantes_totales(entree_de(RouteId::Prompt));
    let quatre_treize = prompt.iter().filter(|v| v.statut == 413).count();
    assert!(quatre_treize >= 1, "au moins un 413 au prompt");
}

#[test]
fn une_route_absente_se_voit_nommee() {
    // Chemin inconnu.
    assert!(
        cherche(Methode::Get, "/api/inconnu").is_none(),
        "aucune route /api/inconnu"
    );
    // Méthode absente d'une route existante : le 405 du routeur s'appuie ici.
    assert!(
        cherche(Methode::Post, "/api/health").is_none(),
        "la santé n'accepte pas POST"
    );
    assert!(
        cherche(Methode::Get, "/api/log").is_none(),
        "le journal n'accepte pas GET"
    );
    // Le chemin d'un autre gabarit ne fait pas passer une route pour une autre.
    assert!(
        cherche(Methode::Get, "/api/agents/{kind}/session").is_none(),
        "le nom du paramètre fait partie du gabarit"
    );
    // La route trouvée est la bonne.
    let trouvee = cherche(Methode::Post, "/api/agents/{paneId}/prompt")
        .unwrap_or_else(|| panic!("la route prompt doit exister"));
    assert!(
        trouvee.id == RouteId::Prompt,
        "le prompt est retrouvé par méthode + gabarit"
    );
}

#[test]
fn une_reponse_absente_se_voit_nommee() {
    // H09 : aucune branche non-200 documentée — le manifeste ne doit pas en inventer.
    let modeles = variantes_totales(entree_de(RouteId::CatalogueModeles));
    for variante in modeles.iter() {
        assert!(
            variante.statut == 200,
            "H09 ne documente aucune branche non-200 : {} trouvé",
            variante.statut
        );
    }
    // H11 : garde partagée seulement — pas de 404/502 propres.
    let focus = entree_de(RouteId::Focus);
    for variante in focus.variantes.iter() {
        assert!(
            variante.statut == 200,
            "H11 ne porte que son 200 explicite : {} trouvé",
            variante.statut
        );
    }
    // Et le négatif générique : aucun statut hors des listes documentées.
    for route in ROUTES.iter() {
        for variante in variantes_totales(route).iter() {
            let documentee = matches!(
                variante.statut,
                200 | 201 | 204 | 400 | 403 | 404 | 405 | 409 | 413 | 415 | 422 | 500 | 502 | 503
            );
            assert!(
                documentee,
                "{:?} : statut {} hors du vocabulaire documenté",
                route.id, variante.statut
            );
        }
    }
}

#[test]
fn la_recherche_par_identifiant_est_totale() {
    for id in [
        RouteId::Sante,
        RouteId::Overview,
        RouteId::Conversations,
        RouteId::SessionAgent,
        RouteId::Prompt,
        RouteId::Arret,
        RouteId::Lancement,
        RouteId::TypesInstalles,
        RouteId::CatalogueModeles,
        RouteId::ReponseQuestion,
        RouteId::Focus,
        RouteId::Confiance,
        RouteId::JournalClient,
        RouteId::FluxSse,
        RouteId::CleVapid,
        RouteId::Abonnements,
        RouteId::Fichier,
        RouteId::Images,
        RouteId::TachesDeFond,
        RouteId::SessionDeTache,
        RouteId::Lecture,
    ] {
        let route = entree_de(id);
        assert!(route.id == id, "entree_de({id:?}) rend {id:?}");
        assert!(
            !variantes_totales(route).is_empty(),
            "chaque route porte des variantes"
        );
    }
    assert!(registry::ROUTES.len() == 22, "le manifeste reste complet");
}
