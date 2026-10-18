//! La cartographie erreurs → fil HTTP (T010) : chaque erreur injectée
//! obtient code/cause/corps prévus ; les formes atypiques restent atypiques.

use contracts::http::commands::SendState;
use contracts::http::errors::ReadCause;
use contracts::presence::Nullable;
use contracts::registry::RouteId;
use domain::errors::{ErreurDomaine, Nature};
use http_api::errors::{
    ReponseErreur, catalogue_en_valeur, focus_sans_effet, journal_sans_effet, reponse_erreur,
    statut,
};

/// Les treize natures, dans l'ordre du manifeste du domaine.
const TOUTES: [Nature; 13] = [
    Nature::InvalidInput,
    Nature::NoSource,
    Nature::SourceAbsent,
    Nature::SourceInvalid,
    Nature::SourceIo,
    Nature::PathDenied,
    Nature::UpstreamUnavailable,
    Nature::UpstreamRejected,
    Nature::UpstreamMalformed,
    Nature::Deadline,
    Nature::PartialAction,
    Nature::Overloaded,
    Nature::InternalInvariant,
];

fn erreur_de(nature: Nature) -> ErreurDomaine {
    let detail = format!("erreur injectée {nature:?}");
    match nature {
        Nature::InvalidInput => ErreurDomaine::entree_invalide(detail),
        Nature::NoSource => ErreurDomaine::sans_source(detail),
        Nature::SourceAbsent => ErreurDomaine::source_absente(detail),
        Nature::SourceInvalid => ErreurDomaine::source_invalide(detail),
        Nature::SourceIo => ErreurDomaine::source_illisible(detail),
        Nature::PathDenied => ErreurDomaine::chemin_refuse(detail),
        Nature::UpstreamUnavailable => ErreurDomaine::amont_injoignable(detail),
        Nature::UpstreamRejected => ErreurDomaine::amont_refus(detail),
        Nature::UpstreamMalformed => ErreurDomaine::amont_malforme(detail),
        Nature::Deadline => ErreurDomaine::delai_depasse(detail),
        Nature::PartialAction => ErreurDomaine::action_partielle(detail),
        Nature::Overloaded => ErreurDomaine::sature(detail),
        Nature::InternalInvariant => ErreurDomaine::invariant_viole(detail),
    }
}

#[test]
fn la_matrice_complete_reste_dans_le_vocabulaire_documente() {
    // TOUTES les natures × TOUTES les routes : le statut doit être documenté
    // pour la route, ou le repli 500 nommé (CURRENT.md §2 : les défauts non
    // attrapés produisent un 500 d'exécution).
    for route in contracts::registry::ROUTES.iter() {
        let documentes: Vec<u16> = contracts::registry::variantes_totales(route)
            .iter()
            .map(|variante| variante.statut)
            .collect();
        for nature in TOUTES.iter() {
            let trouve = statut(route.id, &erreur_de(*nature));
            let permis = documentes.contains(&trouve) || trouve == 500;
            assert!(
                permis,
                "{:?} × {nature:?} : statut {trouve} hors du manifeste {documentes:?}",
                route.id
            );
        }
    }
}

#[test]
fn h04_session_distingue_toutes_les_natures() {
    // invalide ≠ vide ≠ absent ≠ IO (C04) — et chaque statut documenté.
    let attendus = [
        (Nature::InvalidInput, 400),
        (Nature::PathDenied, 403),
        (Nature::NoSource, 404),
        (Nature::SourceInvalid, 409),
        (Nature::UpstreamMalformed, 422),
        (Nature::SourceAbsent, 503),
        (Nature::SourceIo, 502),
        (Nature::UpstreamUnavailable, 502),
        (Nature::UpstreamRejected, 502),
        (Nature::Deadline, 502),
        (Nature::PartialAction, 502),
        (Nature::Overloaded, 502),
        (Nature::InternalInvariant, 500),
    ];
    for (nature, attendu) in attendus.iter() {
        let trouve = statut(RouteId::SessionAgent, &erreur_de(*nature));
        assert!(
            trouve == *attendu,
            "{nature:?} → {trouve}, documenté {attendu}"
        );
    }
}

#[test]
fn les_autres_routes_portent_leur_table() {
    let echantillons: [(RouteId, Nature, u16); 12] = [
        (RouteId::Sante, Nature::UpstreamUnavailable, 503),
        (RouteId::Sante, Nature::InternalInvariant, 500),
        (RouteId::Overview, Nature::UpstreamMalformed, 500),
        (RouteId::Conversations, Nature::UpstreamUnavailable, 503),
        (RouteId::Conversations, Nature::SourceIo, 502),
        (RouteId::Arret, Nature::NoSource, 404),
        (RouteId::Arret, Nature::Deadline, 502),
        (RouteId::Lancement, Nature::NoSource, 400),
        (RouteId::Lancement, Nature::Deadline, 503),
        (RouteId::Lancement, Nature::PartialAction, 502),
        (RouteId::Fichier, Nature::PathDenied, 403),
        (RouteId::Fichier, Nature::InternalInvariant, 500),
    ];
    for (route, nature, attendu) in echantillons.iter() {
        let trouve = statut(*route, &erreur_de(*nature));
        assert!(
            trouve == *attendu,
            "{route:?} {nature:?} → {trouve}, documenté {attendu}"
        );
    }
}

#[test]
fn h05_le_prompt_rate_porte_son_etat_nomme() {
    // B05 : trois états, jamais « envoyé ».
    let cas: [(Nature, SendState); 5] = [
        (Nature::Deadline, SendState::Attente),
        (Nature::UpstreamUnavailable, SendState::Attente),
        (Nature::UpstreamRejected, SendState::Erreur),
        (Nature::UpstreamMalformed, SendState::Inconnu),
        (Nature::PartialAction, SendState::Inconnu),
    ];
    for (nature, etat_attendu) in cas.iter() {
        let (statut_trouve, reponse) = reponse_erreur(RouteId::Prompt, &erreur_de(*nature));
        assert!(
            statut_trouve == 502,
            "l'échec de prompt est un 502, pas {statut_trouve}"
        );
        match reponse {
            ReponseErreur::PromptRate(rate) => match (rate.state, etat_attendu) {
                (SendState::Attente, SendState::Attente)
                | (SendState::Erreur, SendState::Erreur)
                | (SendState::Inconnu, SendState::Inconnu) => (),
                (trouve, attendu) => panic!("{nature:?} : état {trouve:?}, attendu {attendu:?}"),
            },
            autre => panic!("H05 attend PromptRate, pas {autre:?}"),
        }
    }
    // Le 400/500 passent par la forme Api — le corps reste nommé.
    let (statut_invalide, reponse) =
        reponse_erreur(RouteId::Prompt, &erreur_de(Nature::InvalidInput));
    assert!(statut_invalide == 400, "corps malformé = 400");
    match reponse {
        ReponseErreur::Api(corps) => assert!(!corps.error.is_empty(), "le message parle"),
        autre => panic!("400 attend Api, pas {autre:?}"),
    }
}

#[test]
fn h09_le_catalogue_indisponible_est_une_valeur_du_200() {
    let erreur = erreur_de(Nature::UpstreamUnavailable);
    assert!(
        statut(RouteId::CatalogueModeles, &erreur) == 200,
        "H09 n'a pas de branche non-200"
    );
    let valeur = catalogue_en_valeur("codex", "decouverte", &erreur);
    match &valeur.error {
        Nullable::Valeur(message) => {
            assert!(
                message.contains("injectée"),
                "le message sûr est porté : {message}"
            );
        }
        Nullable::Nulle => panic!("l'erreur doit être VISIBLE dans la valeur, pas effacée"),
    }
    assert!(
        valeur.models.is_empty(),
        "les listes vides sont le vide mesuré"
    );
    assert!(valeur.kind == "codex" && valeur.source == "decouverte");
}

#[test]
fn h11_h13_h15_rendent_leurs_formes_atypiques() {
    // H11 : l'échec Herdr rend focused:false — jamais un succès inventé.
    assert!(statut(RouteId::Focus, &erreur_de(Nature::Deadline)) == 200);
    let focus = focus_sans_effet();
    assert!(!focus.focused, "le fait : pas de focus");

    // H13 : l'échec rend {ok:false}.
    assert!(statut(RouteId::JournalClient, &erreur_de(Nature::SourceIo)) == 200);
    assert!(!journal_sans_effet().ok, "l'acquittement dit faux");

    // H15 : le 503 est du TEXTE brut.
    let (statut_vapid, reponse) =
        reponse_erreur(RouteId::CleVapid, &erreur_de(Nature::UpstreamUnavailable));
    assert!(statut_vapid == 503);
    match reponse {
        ReponseErreur::TexteBrut(texte) => assert!(!texte.is_empty(), "le texte parle"),
        autre => panic!("H15 503 attend du texte brut, pas {autre:?}"),
    }
    // …et sa panne de setup reste un 500 JSON.
    assert!(statut(RouteId::CleVapid, &erreur_de(Nature::InternalInvariant)) == 500);
}

#[test]
fn le_corps_de_lecture_porte_sa_cause_sans_l_aplatir() {
    // C04 : invalide ≠ vide ≠ absent ≠ IO — la cause passe nommée.
    let erreur = ErreurDomaine::source_invalide("ligne de travers");
    let corps = http_api::errors::corps_de_lecture(ReadCause::Invalide, &erreur);
    match corps.cause.as_option() {
        Some(cause) => assert!(*cause == ReadCause::Invalide, "la cause reste nommée"),
        None => panic!("la cause doit être présente"),
    }
    let erreur = ErreurDomaine::source_illisible("disque parti");
    let corps = http_api::errors::corps_de_lecture(ReadCause::Io, &erreur);
    match corps.cause.as_option() {
        Some(cause) => assert!(*cause == ReadCause::Io),
        None => panic!("la cause IO doit être présente"),
    }
    // Le corps générique ne porte PAS de cause — et son hint nomme le code.
    let corps = http_api::errors::corps(&erreur);
    assert!(
        corps.cause.est_absente(),
        "le corps générique ne dit pas la cause"
    );
    match corps.hint.as_option() {
        Some(indice) => assert!(
            indice.contains("source_io"),
            "le code diagnostic passe : {indice}"
        ),
        None => panic!("le hint porte le code diagnostic"),
    }
}
