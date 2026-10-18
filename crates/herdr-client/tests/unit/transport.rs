//! Le transport Unix (T012) contre un **faux socket** : fragments UTF-8,
//! corrélation, enveloppes cassées, EOF, délai, surtaille — et zéro relance
//! automatique.

use herdr_client::transport::{CADRE_MAX_OCTETS, ErreurTransport, TransportUnix};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::thread;
use std::time::Duration;

static NONCE: AtomicU32 = AtomicU32::new(0);

/// Un faux serveur : socket lié **une fois**, une connexion servie par un
/// fil qui applique le script.
struct FauxHerdr {
    chemin: PathBuf,
    ecoute: UnixListener,
}

impl FauxHerdr {
    fn nouveau(prefixe: &str) -> Self {
        let racine = std::env::temp_dir().join(format!(
            "{prefixe}-{}-{}",
            std::process::id(),
            NONCE.fetch_add(1, Ordering::SeqCst)
        ));
        match std::fs::create_dir(&racine) {
            Ok(()) => (),
            Err(cause) => panic!("racine refusée : {cause}"),
        }
        let chemin = racine.join("herdr.sock");
        let ecoute = match UnixListener::bind(&chemin) {
            Ok(ecoute) => ecoute,
            Err(cause) => panic!("bind refusé : {cause}"),
        };
        Self { chemin, ecoute }
    }

    /// Accepte UNE connexion dans un fil séparé, puis applique le script.
    fn sert_une<F>(&self, script: F)
    where
        F: FnOnce(UnixStream) + Send + 'static,
    {
        let ecoute = match self.ecoute.try_clone() {
            Ok(ecoute) => ecoute,
            Err(cause) => panic!("clone d'écoute refusé : {cause}"),
        };
        thread::spawn(move || {
            if let Ok((flux, _)) = ecoute.accept() {
                script(flux);
            }
        });
    }
}

/// Lit la requête du transport (une ligne) — pour que le script réponde.
fn lis_cadre(flux: &mut UnixStream) -> (u64, String, Value) {
    let clone = match flux.try_clone() {
        Ok(clone) => clone,
        Err(cause) => panic!("clone : {cause}"),
    };
    let mut lecteur = BufReader::new(clone);
    let mut ligne = String::new();
    match lecteur.read_line(&mut ligne) {
        Ok(lus) if lus > 0 => (),
        autre => panic!("cadre illisible : {autre:?}"),
    }
    let demande: Value = match serde_json::from_str(ligne.trim()) {
        Ok(demande) => demande,
        Err(cause) => panic!("JSON du cadre : {cause}"),
    };
    (
        demande.get("id").and_then(Value::as_u64).unwrap_or(0),
        demande
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        demande.get("params").cloned().unwrap_or(Value::Null),
    )
}

fn connecte(faux: &FauxHerdr) -> TransportUnix {
    match TransportUnix::connecte(&faux.chemin) {
        Ok(transport) => transport,
        Err(cause) => panic!("connexion refusée : {cause}"),
    }
}

#[test]
fn un_echange_simple_corrige_la_correlation() {
    let faux = FauxHerdr::nouveau("soutien-transport-simple");
    faux.sert_une(|mut flux| {
        let (identifiant, methode, _) = lis_cadre(&mut flux);
        assert!(methode == "ping", "la méthode passe : {methode}");
        let reponse =
            json!({ "id": identifiant, "result": { "protocol": 22, "version": "0.9.3" } });
        let _ = writeln!(flux, "{reponse}");
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Ok(resultat) => assert!(
            resultat.get("protocol").and_then(Value::as_u64) == Some(22),
            "le résultat passe corrélé"
        ),
        Err(cause) => panic!("échange refusé : {cause}"),
    }
}

#[test]
fn un_cadre_fragmente_avec_utf8_casse_est_reconstitue() {
    let faux = FauxHerdr::nouveau("soutien-transport-fragmente");
    faux.sert_une(|mut flux| {
        let (identifiant, _, _) = lis_cadre(&mut flux);
        // Un « é » (2 octets) coupé EN DEUX, trois fragments séparés.
        let texte = json!({ "id": identifiant, "result": { "texte": "accentué" } }).to_string();
        let octets = texte.as_bytes();
        let coupure = octets.len() - 3;
        let _ = flux.write_all(&octets[..coupure]);
        let _ = flux.flush();
        thread::sleep(Duration::from_millis(20));
        let _ = flux.write_all(&octets[coupure..]);
        let _ = writeln!(flux);
        let _ = flux.flush();
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Ok(resultat) => {
            let texte = resultat.get("texte").and_then(Value::as_str).unwrap_or("");
            assert!(
                texte == "accentué",
                "l'UTF-8 fragmenté se reconstitue : {texte}"
            );
        }
        Err(cause) => panic!("cadre fragmenté refusé : {cause}"),
    }
}

#[test]
fn une_mauvaise_correlation_est_refusee() {
    let faux = FauxHerdr::nouveau("soutien-transport-correlation");
    faux.sert_une(|mut flux| {
        let (_, _, _) = lis_cadre(&mut flux);
        let _ = flux.write_all(b"{\"id\": 999, \"result\": {}}\n");
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::MauvaiseCorrelation { attendu, recu }) => {
            assert!(
                attendu == 1 && recu == 999,
                "les deux ids parlent : {attendu}/{recu}"
            );
        }
        autre => panic!("mauvaise corrélation attendue, pas {autre:?}"),
    }
}

#[test]
fn les_enveloppes_cassees_sont_nommees() {
    // JSON invalide.
    let faux = FauxHerdr::nouveau("soutien-transport-json");
    faux.sert_une(|mut flux| {
        let (_, _, _) = lis_cadre(&mut flux);
        let _ = writeln!(flux, "pas du json {{");
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::JsonInvalide(_)) => (),
        autre => panic!("JSON invalide attendu, pas {autre:?}"),
    }
    // Enveloppe sans id.
    let faux = FauxHerdr::nouveau("soutien-transport-enveloppe");
    faux.sert_une(|mut flux| {
        let (_, _, _) = lis_cadre(&mut flux);
        let _ = flux.write_all(b"{\"result\": {}}\n");
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::EnveloppeInvalide(_)) => (),
        autre => panic!("enveloppe sans id attendue, pas {autre:?}"),
    }
    // Ni result ni error.
    let faux = FauxHerdr::nouveau("soutien-transport-vide");
    faux.sert_une(|mut flux| {
        let (identifiant, _, _) = lis_cadre(&mut flux);
        let _ = writeln!(flux, r#"{{"id": {identifiant}}}"#);
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::EnveloppeInvalide(_)) => (),
        autre => panic!("enveloppe vide attendue, pas {autre:?}"),
    }
}

#[test]
fn un_refus_amont_structure_est_un_refus_amont() {
    let faux = FauxHerdr::nouveau("soutien-transport-refus");
    faux.sert_une(|mut flux| {
        let (identifiant, _, _) = lis_cadre(&mut flux);
        let _ = writeln!(
            flux,
            r#"{{"id": {identifiant}, "error": {{"code": "E-42", "message": "pane absent"}}}}"#
        );
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::AmontRefus { code, message }) => {
            assert!(
                code == "E-42" && message == "pane absent",
                "code+message portés : {code}/{message}"
            );
        }
        autre => panic!("refus amont structuré attendu, pas {autre:?}"),
    }
}

#[test]
fn la_fermeture_et_le_delai_se_voient() {
    // EOF : le serveur ferme sans répondre.
    let faux = FauxHerdr::nouveau("soutien-transport-ferme");
    faux.sert_une(|mut flux| {
        let (_, _, _) = lis_cadre(&mut flux);
        let _ = flux.shutdown(std::net::Shutdown::Both);
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::Ferme) => (),
        autre => panic!("EOF attendu, pas {autre:?}"),
    }
    // Délai : le serveur garde le silence au-delà du délai imposé.
    let faux = FauxHerdr::nouveau("soutien-transport-delai");
    faux.sert_une(|mut flux| {
        let (_, _, _) = lis_cadre(&mut flux);
        thread::sleep(Duration::from_millis(300));
        let _ = flux.write_all(b"{\"id\": 1, \"result\": {}}\n");
    });
    let mut transport = connecte(&faux);
    match transport.appelle_avec_delai("ping", &json!({}), Duration::from_millis(50)) {
        Err(ErreurTransport::DelaiDepasse) => (),
        autre => panic!("délai dépassé attendu, pas {autre:?}"),
    }
}

#[test]
fn une_surtaille_est_refusee_sans_borne_etendue() {
    let faux = FauxHerdr::nouveau("soutien-transport-surtaille");
    faux.sert_une(|mut flux| {
        let (_, _, _) = lis_cadre(&mut flux);
        let _ = flux.write_all(&vec![b'a'; CADRE_MAX_OCTETS + 16]);
        let _ = writeln!(flux);
    });
    let mut transport = connecte(&faux);
    match transport.appelle("ping", &json!({})) {
        Err(ErreurTransport::CadreTropGrand) => (),
        autre => panic!("surtaille attendue, pas {autre:?}"),
    }
}

#[test]
fn aucune_relance_automatique_et_les_ids_avancent() {
    // Le transport ne rejoue JAMAIS : un délai dépassé rend la main à
    // l'appelant — le serveur ne reçoit qu'UN cadre.
    let faux = FauxHerdr::nouveau("soutien-transport-relance");
    let compteur = Arc::new(AtomicUsize::new(0));
    let compteur_fils = Arc::clone(&compteur);
    let ecoute = match faux.ecoute.try_clone() {
        Ok(ecoute) => ecoute,
        Err(cause) => panic!("clone d'écoute refusé : {cause}"),
    };
    thread::spawn(move || {
        if let Ok((flux, _)) = ecoute.accept() {
            let mut local = 0;
            let mut lecteur = BufReader::new(match flux.try_clone() {
                Ok(clone) => clone,
                Err(cause) => panic!("clone : {cause}"),
            });
            let mut ligne = String::new();
            loop {
                ligne.clear();
                match lecteur.read_line(&mut ligne) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        local += 1;
                        compteur_fils.store(local, Ordering::SeqCst);
                        // Silence volontaire : le délai expire côté transport.
                    }
                }
            }
        }
    });
    let mut transport = connecte(&faux);
    match transport.appelle_avec_delai(
        "pane.send_text",
        &json!({ "text": "unique" }),
        Duration::from_millis(60),
    ) {
        Err(ErreurTransport::DelaiDepasse) => (),
        autre => panic!("délai attendu, pas {autre:?}"),
    }
    thread::sleep(Duration::from_millis(150));
    assert!(
        compteur.load(Ordering::SeqCst) == 1,
        "UNE seule écriture — aucune relance mutante automatique"
    );
    // L'appelant rejoue EXPLICITEMENT : le compteur d'ids a avancé.
    assert!(
        transport.prochain_identifiant() == 2,
        "l'identifiant suivant est prêt"
    );
}
