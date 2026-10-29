//! Les erreurs de domaine riches (T010) : treize natures, diagnostic
//! structuré sans secret, messages sûrs pour l'écran.

use domain::errors::{
    Diagnostic, ErreurDomaine, Nature, ReadCause, cause_de_lecture, supprime_identifiants,
};

#[test]
fn les_treize_natures_portent_leur_code_stable() {
    let attendus = [
        (Nature::InvalidInput, "invalid_input"),
        (Nature::NoSource, "no_source"),
        (Nature::SourceAbsent, "source_absent"),
        (Nature::SourceInvalid, "source_invalid"),
        (Nature::SourceIo, "source_io"),
        (Nature::PathDenied, "path_denied"),
        (Nature::UpstreamUnavailable, "upstream_unavailable"),
        (Nature::UpstreamRejected, "upstream_rejected"),
        (Nature::UpstreamMalformed, "upstream_malformed"),
        (Nature::Deadline, "deadline"),
        (Nature::PartialAction, "partial_action"),
        (Nature::Overloaded, "overloaded"),
        (Nature::InternalInvariant, "internal_invariant"),
    ];
    for (nature, code) in attendus.iter() {
        assert!(nature.code() == *code, "{nature:?} doit porter {code}");
    }
}

#[test]
fn les_constructeurs_portent_leur_nature_et_leur_code() {
    let erreur = ErreurDomaine::source_absente("base SQLite manquante");
    assert!(erreur.nature == Nature::SourceAbsent);
    assert!(erreur.diagnostic.code == "source_absent");
    let erreur = ErreurDomaine::invariant_viole("invariant rompu");
    assert!(erreur.nature == Nature::InternalInvariant);
    assert!(erreur.diagnostic.code == "internal_invariant");
}

#[test]
fn le_diagnostic_refuse_les_cles_privees_nommeement() {
    let erreur = ErreurDomaine::sature("plafond de flux atteint");
    let refusee = erreur.avec_entree("cle-privee", "matériel");
    match refusee {
        Err(motif) => assert!(motif.contains("private"), "le refus dit pourquoi : {motif}"),
        Ok(_) => panic!("une clé « cle-privee » doit être refusée, pas insérée"),
    }
    for cle in [
        "vapid-cle-privee",
        "token-push",
        "mot_de_passe",
        "private-key",
    ] {
        let erreur = ErreurDomaine::sature("essai");
        match erreur.avec_entree(cle, "x") {
            Err(_) => (),
            Ok(_) => panic!("la clé {cle} doit être refusée"),
        }
    }
    // Une clé saine passe, la valeur est portée telle quelle.
    let erreur = ErreurDomaine::sature("essai")
        .avec_entree("plafond", "8")
        .unwrap_or_else(|cause| panic!("clé saine refusée : {cause}"));
    match erreur.diagnostic.entrees.first() {
        Some((cle, valeur)) => assert!(cle == "plafond" && valeur == "8"),
        None => panic!("l'entrée saine doit rester"),
    }
}

#[test]
fn les_messages_sur_remplacent_les_identifiants_mesures() {
    assert!(
        supprime_identifiants("l'envoi a échoué sur wA:p7") == "l'envoi a échoué sur the new tab",
        "wX:pY → le nouvel onglet"
    );
    assert!(
        supprime_identifiants("l'onglet wB:t3 est occupé") == "l'onglet its tab est occupé",
        "wX:tY → son onglet"
    );
    assert!(
        supprime_identifiants("pane_id=wA:p7 introuvable") == "introuvable",
        "les ids nommés partent"
    );
    assert!(
        supprime_identifiants("workspace_id=wA tab_id=wB:t2").is_empty(),
        "que des ids nommés → vide (le message_sur dira « erreur sans message »)"
    );
    // Un jeton ressemblant mais non conforme passe tel quel.
    assert!(
        supprime_identifiants("le ratio w:p reste") == "le ratio w:p reste",
        "sans w préfixe ni p/t de sens, rien ne bouge"
    );
    assert!(
        supprime_identifiants("adresse http://wA:p7x/fin") == "adresse http://the new tab/fin",
        "les frontières de mots sont celles du fil"
    );
}

#[test]
fn le_message_sur_plafonne_a_300_et_ne_sait_pas_vide() {
    let long = "x".repeat(400);
    let erreur = ErreurDomaine::amont_injoignable(long);
    assert!(
        erreur.message_sur().chars().count() == 300,
        "plafonné à 300 caractères"
    );
    // Le plafond recule jusqu'à une frontière de caractère (accents inclus).
    let accente = "é".repeat(200);
    let erreur = ErreurDomaine::amont_injoignable(accente);
    assert!(
        erreur.message_sur().chars().count() == 150,
        "300 octets = 150 « é »"
    );
    let erreur = ErreurDomaine::amont_injoignable("   ");
    assert!(
        erreur.message_sur() == "error without a message",
        "jamais un message vide"
    );
    let erreur = ErreurDomaine::amont_injoignable("pane_id=wA:p7");
    assert!(
        erreur.message_sur() == "error without a message",
        "tout retiré → le repli parle"
    );
}

#[test]
fn une_cause_benigne_n_est_pas_une_erreur() {
    // invalide ≠ vide ≠ absent ≠ IO (C04) : les deux premières sont des
    // VALEURS (ReadVerdict bénin), les deux suivantes des erreurs nommées.
    match cause_de_lecture(ReadCause::Absente, "rien") {
        None => (),
        Some(erreur) => panic!("absente est bénigne, pas {erreur:?}"),
    }
    match cause_de_lecture(ReadCause::Vide, "rien") {
        None => (),
        Some(erreur) => panic!("vide est bénigne, pas {erreur:?}"),
    }
    let erreur = match cause_de_lecture(ReadCause::Invalide, "ligne de travers") {
        Some(erreur) => erreur,
        None => panic!("invalide doit devenir une erreur"),
    };
    assert!(
        erreur.nature == Nature::SourceInvalid,
        "invalide → SourceInvalid"
    );
    let erreur = match cause_de_lecture(ReadCause::Io, "disque parti") {
        Some(erreur) => erreur,
        None => panic!("io doit devenir une erreur"),
    };
    assert!(erreur.nature == Nature::SourceIo, "io → SourceIo");
}

#[test]
fn le_diagnostic_porte_sa_cause_et_son_contexte() {
    let erreur = ErreurDomaine::source_illisible("lecture refusée")
        .avec_cause("permission refusée par le système")
        .avec_entree("tentative", "1")
        .unwrap_or_else(|cause| panic!("clé saine : {cause}"));
    match &erreur.diagnostic.cause {
        Some(cause) => assert!(cause == "permission refusée par le système"),
        None => panic!("la cause doit rester portée"),
    }
    assert!(
        erreur.diagnostic.entrees.len() == 1,
        "une entrée de contexte"
    );
    assert!(
        Diagnostic::default().entrees.is_empty(),
        "diagnostic par défaut = vide"
    );
}
