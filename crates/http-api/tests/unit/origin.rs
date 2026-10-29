//! Tests de la garde d'origine (T049, S02) — pure, sans routeur.
//! Prouve : S01.

use http_api::origin::{RaisonGarde, describe_refus, est_autorisee, est_loopback, verifie_garde};

fn attendues() -> Vec<String> {
    vec![
        "http://127.0.0.1:8791".to_string(),
        "https://macbook.ts.net".to_string(),
    ]
}

#[test]
fn loopback_localhost_ports_confondus() {
    assert!(est_loopback("http://localhost:8791"));
    assert!(est_loopback("http://localhost:5173"));
    assert!(est_loopback("http://localhost"));
}

#[test]
fn loopback_adresses_ip() {
    assert!(est_loopback("http://127.0.0.1:8791"));
    assert!(est_loopback("http://127.0.0.1"));
    assert!(est_loopback("http://[::1]:8791"));
    assert!(est_loopback("http://[::1]"));
}

#[test]
fn loopback_casse_et_crochets() {
    assert!(est_loopback("http://LOCALHOST:8791"));
    assert!(est_loopback("HTTP://[::1]:8791"));
}

#[test]
fn loopback_refuse_les_distantes() {
    assert!(!est_loopback("http://evil.com"));
    assert!(!est_loopback("http://macbook.ts.net.evil.com"));
    assert!(!est_loopback("http://100.64.1.2:8791"));
    assert!(!est_loopback("http://192.168.1.10:8791"));
    assert!(!est_loopback("http://[fd7a:115c:a1e0::1]:8791"));
}

#[test]
fn loopback_refuse_les_malformees() {
    assert!(!est_loopback(""));
    assert!(!est_loopback("localhost:8791"));
    assert!(!est_loopback("ftp://localhost"));
    assert!(!est_loopback("http://"));
    assert!(!est_loopback("http://[::1"));
    // IPv6 brute sans crochets : malformée, écartée.
    assert!(!est_loopback("http://fd7a:115c:a1e0::1:8791"));
}

#[test]
fn autorisee_liste_exacte_ou_loopback() {
    let attendues = attendues();
    assert!(est_autorisee(Some("http://127.0.0.1:8791"), &attendues));
    assert!(est_autorisee(Some("https://macbook.ts.net"), &attendues));
    // Loopback même absent de la liste.
    assert!(est_autorisee(Some("http://localhost:5173"), &attendues));
    assert!(est_autorisee(Some("http://[::1]:8791"), &attendues));
}

#[test]
fn autorisee_refuse_les_proches_et_absentes() {
    let attendues = attendues();
    // Pas de comparaison partielle, pas de motif.
    assert!(!est_autorisee(
        Some("https://macbook.ts.net.evil.com"),
        &attendues
    ));
    assert!(!est_autorisee(Some("http://100.64.1.2:8791"), &attendues));
    assert!(!est_autorisee(None, &attendues));
    assert!(!est_autorisee(Some(""), &attendues));
    // Liste vide : seule la machine elle-même passe.
    assert!(est_autorisee(Some("http://localhost"), &[]));
    assert!(!est_autorisee(Some("http://evil.com"), &[]));
}

#[test]
fn garde_origine_absente_403() {
    let refus = verifie_garde(None, Some("application/json"), None, &attendues())
        .err()
        .unwrap_or_else(|| panic!("une origine absente doit être refusée"));
    assert_eq!(refus.raison, RaisonGarde::OrigineAbsente);
    assert_eq!(refus.statut, 403);
    assert_eq!(refus.attendue, None);
    assert_eq!(refus.recue, None);
}

#[test]
fn garde_origine_vide_est_absente() {
    let refus = verifie_garde(Some(""), Some("application/json"), None, &attendues())
        .err()
        .unwrap_or_else(|| panic!("une origine vide est une origine absente"));
    assert_eq!(refus.raison, RaisonGarde::OrigineAbsente);
}

#[test]
fn garde_origine_etrangere_403_avec_les_deux() {
    let refus = verifie_garde(
        Some("http://evil.com"),
        Some("application/json"),
        None,
        &attendues(),
    )
    .err()
    .unwrap_or_else(|| panic!("une origine étrangère doit être refusée"));
    assert_eq!(refus.raison, RaisonGarde::OrigineEtrangere);
    assert_eq!(refus.statut, 403);
    // Les deux origines sont dites : la cause est diagnosable.
    assert_eq!(
        refus.attendue.as_deref(),
        Some("http://127.0.0.1:8791 | https://macbook.ts.net")
    );
    assert_eq!(refus.recue.as_deref(), Some("http://evil.com"));
}

#[test]
fn garde_content_type_non_json_415() {
    let refus = verifie_garde(
        Some("http://localhost"),
        Some("application/x-www-form-urlencoded"),
        None,
        &attendues(),
    )
    .err()
    .unwrap_or_else(|| panic!("un formulaire HTML ne peut pas produire du JSON"));
    assert_eq!(refus.raison, RaisonGarde::ContentType);
    assert_eq!(refus.statut, 415);
}

#[test]
fn garde_content_type_absent_415() {
    let refus = verifie_garde(Some("http://localhost"), None, None, &attendues())
        .err()
        .unwrap_or_else(|| panic!("sans Content-Type, rien ne garantit le JSON"));
    assert_eq!(refus.raison, RaisonGarde::ContentType);
}

#[test]
fn garde_content_type_json_avec_parametres() {
    assert!(
        verifie_garde(
            Some("http://localhost"),
            Some("application/json; charset=utf-8"),
            None,
            &attendues(),
        )
        .is_ok(),
        "le paramètre charset ne doit pas faire échouer le JSON"
    );
}

#[test]
fn garde_taille_declaree_au_dela_413() {
    let refus = verifie_garde(
        Some("http://localhost"),
        Some("application/json"),
        Some("70000"),
        &attendues(),
    )
    .err()
    .unwrap_or_else(|| panic!("un corps déclaré au-delà de 64 KiB est refusé avant lecture"));
    assert_eq!(refus.raison, RaisonGarde::CorpsTropGrand);
    assert_eq!(refus.statut, 413);
}

#[test]
fn garde_taille_declaree_a_la_limite_passe() {
    assert!(
        verifie_garde(
            Some("http://localhost"),
            Some("application/json"),
            Some("65536"),
            &attendues(),
        )
        .is_ok(),
        "64 KiB exacts passent la garde déclarée"
    );
}

#[test]
fn garde_taille_illisible_ignoree() {
    // Une taille illisible n'est pas un refus : la taille RÉELLE sera
    // tranchée à la lecture (C09).
    assert!(
        verifie_garde(
            Some("http://localhost"),
            Some("application/json"),
            Some("beaucoup"),
            &attendues(),
        )
        .is_ok(),
        "une taille non numérique ne doit pas être un refus"
    );
}

#[test]
fn garde_passe_quand_tout_va_bien() {
    assert!(
        verifie_garde(
            Some("http://localhost:8791"),
            Some("application/json"),
            Some("12"),
            &attendues(),
        )
        .is_ok()
    );
}

#[test]
fn messages_la_cause_jamais_muette() {
    assert_eq!(
        describe_refus(RaisonGarde::OrigineAbsente, None, None),
        "missing origin: likely cross-site request"
    );
    assert_eq!(
        describe_refus(
            RaisonGarde::OrigineEtrangere,
            Some("http://a | http://b"),
            Some("http://evil.com"),
        ),
        "unauthorized origin (expected http://a | http://b, received http://evil.com)"
    );
    assert_eq!(
        describe_refus(RaisonGarde::Methode, None, None),
        "method not allowed on this route"
    );
    assert_eq!(
        describe_refus(RaisonGarde::ContentType, None, None),
        "expected Content-Type: application/json"
    );
    assert_eq!(
        describe_refus(RaisonGarde::CorpsTropGrand, None, None),
        "body too large (maximum 65536 bytes)"
    );
}
