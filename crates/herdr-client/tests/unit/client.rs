//! Le client Herdr (T013) contre un faux socket : requêtes exactes
//! (target/pane_id/tab_id), lecture visible sans lignes + strip_ansi,
//! discriminant de succès (C05), capacités historiques.

use herdr_client::capabilities;
use herdr_client::client::{ClientHerdr, SourceLecture};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

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

    /// Sert **une connexion par demande** — mesuré sur le vrai Herdr : il
    /// ferme la connexion après chaque réponse, donc le client en ouvre une
    /// par appel. Le script est rejoué pour chacune.
    fn sert_une<F>(&self, script: F)
    where
        F: Fn(UnixStream) + Clone + Send + 'static,
    {
        let ecoute = match self.ecoute.try_clone() {
            Ok(ecoute) => ecoute,
            Err(cause) => panic!("clone d'écoute refusé : {cause}"),
        };
        std::thread::spawn(move || {
            while let Ok((flux, _)) = ecoute.accept() {
                let script = script.clone();
                std::thread::spawn(move || script(flux));
            }
        });
    }
}

fn connecte(faux: &FauxHerdr) -> ClientHerdr {
    match ClientHerdr::connecte(&faux.chemin) {
        Ok(client) => client,
        Err(cause) => panic!("connexion refusée : {cause}"),
    }
}

#[test]
fn le_vocabulaire_des_capacites_est_coherent() {
    // 14 déclarées, 12 utilisées (sites de demande mesurés), 2 déclarées
    // non activées — et les utilisées ⊆ déclarées.
    assert!(
        capabilities::vocabulaire_coherent(),
        "utilisé ⊆ déclaré, et la différence fait exactement les non-activées"
    );
    for methode in capabilities::METHODES_UTILISEES.iter() {
        assert!(
            capabilities::est_activee(methode),
            "{methode} doit être active"
        );
    }
    for methode in capabilities::METHODES_DECLAREES_NON_UTILISEES.iter() {
        assert!(
            !capabilities::est_activee(methode),
            "{methode} est déclarée mais PAS activée (E3 : l'amont ne l'implémente pas)"
        );
    }
}

#[test]
fn la_lecture_visible_nenvoie_pas_de_lignes_et_passe_strip_ansi() {
    let faux = FauxHerdr::nouveau("soutien-client-lecture");
    let cadre_vu = Arc::new(Mutex::new(None::<Value>));
    let cadre_fils = Arc::clone(&cadre_vu);
    faux.sert_une(move |mut flux| {
        // Copie du cadre AVANT de répondre (le script n'a pas de retour).
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
        let cadre: Value = match serde_json::from_str(ligne.trim()) {
            Ok(cadre) => cadre,
            Err(cause) => panic!("JSON du cadre : {cause}"),
        };
        *cadre_fils.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cadre);
        let identifiant = 1_u64;
        let _ = writeln!(
            flux,
            "{}",
            json!({ "id": identifiant, "result": { "read": { "text": "sortie écran", "truncated": false } } })
        );
    });
    let mut client = connecte(&faux);
    match client.lecture_ecran("wA:p7", None, SourceLecture::Visible) {
        Ok((texte, tronque)) => {
            assert!(texte == "sortie écran", "le texte passe : {texte}");
            assert!(!tronque);
        }
        Err(cause) => panic!("lecture refusée : {cause}"),
    }
    let cadre = match cadre_vu
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
    {
        Some(cadre) => cadre,
        None => panic!("le cadre doit avoir été noté"),
    };
    let params = cadre.get("params").cloned().unwrap_or(Value::Null);
    assert!(
        params.get("target").and_then(Value::as_str) == Some("wA:p7"),
        "agent.read attend target"
    );
    assert!(
        params.get("strip_ansi").and_then(Value::as_bool) == Some(true),
        "strip_ansi posé au fil"
    );
    assert!(
        params.get("lines").is_none(),
        "visible ne porte PAS de lignes (mesuré)"
    );
    assert!(params.get("source").and_then(Value::as_str) == Some("visible"));

    // recent, lui, porte les lignes (200 par défaut mesuré).
    let faux = FauxHerdr::nouveau("soutien-client-lecture-recent");
    faux.sert_une(|mut flux| {
        let _ = lit_dernier_sans_reponse(&mut flux);
        let _ = writeln!(
            flux,
            "{}",
            json!({ "id": 1, "result": { "read": { "text": "histoire récente" } } })
        );
    });
    let mut client = connecte(&faux);
    match client.lecture_ecran("wA:p8", None, SourceLecture::Recent) {
        Ok((texte, tronque)) => {
            assert!(texte == "histoire récente");
            assert!(!tronque, "absent = faux (dégradé propre, jamais inventé)");
        }
        Err(cause) => panic!("lecture recent refusée : {cause}"),
    }
}

/// Consomme la ligne du client sans répondre (pour les scripts qui n'ont
/// pas besoin du contenu).
fn lit_dernier_sans_reponse(flux: &mut UnixStream) -> Value {
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
    match serde_json::from_str(ligne.trim()) {
        Ok(cadre) => cadre,
        Err(cause) => panic!("JSON du cadre : {cause}"),
    }
}

#[test]
fn les_orthographes_exactes_des_deux_envois() {
    // pane.send_text attend pane_id ; agent.send_keys attend target —
    // mesuré : les confondre échouerait sur un missing field.
    let faux = FauxHerdr::nouveau("soutien-client-orthographes");
    let cadre_vu = Arc::new(Mutex::new(None::<Value>));
    let cadre_fils = Arc::clone(&cadre_vu);
    faux.sert_une(move |mut flux| {
        let cadre = lit_dernier_sans_reponse(&mut flux);
        *cadre_fils
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cadre);
        let _ = writeln!(flux, "{}", json!({ "id": 1, "result": { "écrit": true } }));
    });
    let mut client = connecte(&faux);
    match client.texte_brut("wA:p9", "du texte") {
        Ok(_) => (),
        Err(cause) => panic!("texte refusé : {cause}"),
    }
    let cadre = match cadre_vu
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
    {
        Some(cadre) => cadre,
        None => panic!("cadre noté"),
    };
    let params = cadre.get("params").cloned().unwrap_or(Value::Null);
    assert!(
        cadre.get("method").and_then(Value::as_str) == Some("pane.send_text")
            && params.get("pane_id").and_then(Value::as_str) == Some("wA:p9")
            && params.get("text").and_then(Value::as_str) == Some("du texte"),
        "la forme exacte de pane.send_text : {params}"
    );

    let faux = FauxHerdr::nouveau("soutien-client-touches");
    let cadre_vu = Arc::new(Mutex::new(None::<Value>));
    let cadre_fils = Arc::clone(&cadre_vu);
    faux.sert_une(move |mut flux| {
        let cadre = lit_dernier_sans_reponse(&mut flux);
        *cadre_fils
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cadre);
        let _ = writeln!(flux, "{}", json!({ "id": 1, "result": { "touché": true } }));
    });
    let mut client = connecte(&faux);
    match client.touches("wA:p9", &["Enter".to_string()]) {
        Ok(_) => (),
        Err(cause) => panic!("touches refusées : {cause}"),
    }
    let cadre = match cadre_vu
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
    {
        Some(cadre) => cadre,
        None => panic!("cadre noté"),
    };
    let params = cadre.get("params").cloned().unwrap_or(Value::Null);
    assert!(
        cadre.get("method").and_then(Value::as_str) == Some("agent.send_keys")
            && params.get("target").and_then(Value::as_str) == Some("wA:p9")
            && params
                .get("keys")
                .and_then(Value::as_array)
                .map(|t| t.len())
                == Some(1),
        "la forme exacte de agent.send_keys : {params}"
    );
}

#[test]
fn un_discriminant_de_succes_non_objet_ne_confirme_pas_un_prompt() {
    // C05 : le fil exige result = OBJET (Record) — un result null, une
    // chaîne, un tableau : PAS une confirmation.
    let cas: [&str; 3] = [r#""ok""#, "null", "[]"];
    for resultat in cas.iter() {
        let faux = FauxHerdr::nouveau("soutien-client-c05");
        let resultat_fils = resultat.to_string();
        faux.sert_une(move |mut flux| {
            let _ = lit_dernier_sans_reponse(&mut flux);
            let _ = writeln!(flux, r#"{{"id": 1, "result": {resultat_fils}}}"#);
        });
        let mut client = connecte(&faux);
        match client.prompt("wA:p1", "le texte") {
            Err(cause) => assert!(
                matches!(
                    cause,
                    herdr_client::transport::ErreurTransport::EnveloppeInvalide(_)
                ),
                "le discriminant {resultat} doit refuser : {cause}"
            ),
            Ok(_) => panic!("un result {resultat} ne peut PAS confirmer un prompt"),
        }
    }
    // Et un result objet corrélé confirme (l'évidence de transport).
    let faux = FauxHerdr::nouveau("soutien-client-c05-ok");
    faux.sert_une(|mut flux| {
        let _ = lit_dernier_sans_reponse(&mut flux);
        let _ = writeln!(
            flux,
            r#"{{"id": 1, "result": {{"statut": "peu importe"}}}}"#
        );
    });
    let mut client = connecte(&faux);
    match client.prompt("wA:p1", "le texte") {
        Ok(_) => (),
        Err(cause) => panic!("un result objet corrélé confirme : {cause}"),
    }
}

#[test]
fn la_creation_donglet_exige_un_pane_racine_utilisable() {
    // La réponse {tab, root_pane} est vérifiée : sans root_pane, échec
    // nommé — pas une structure à moitié remplie.
    let faux = FauxHerdr::nouveau("soutien-client-onglet-incomplet");
    faux.sert_une(|mut flux| {
        let _ = lit_dernier_sans_reponse(&mut flux);
        let _ = writeln!(flux, "{}", json!({ "id": 1, "result": { "tab": "t-sim" } }));
    });
    let mut client = connecte(&faux);
    match client.creation_onglet(Some("/projets/atelier"), false, None, Some("wA")) {
        Err(cause) => assert!(
            format!("{cause}").contains("racine"),
            "l'échec dit pourquoi : {cause}"
        ),
        Ok(_) => panic!("un onglet sans pane racine ne passe pas"),
    }
    // Avec le root_pane : la structure complète passe, avec les params exacts.
    let faux = FauxHerdr::nouveau("soutien-client-onglet-complet");
    let cadre_vu = Arc::new(Mutex::new(None::<Value>));
    let cadre_fils = Arc::clone(&cadre_vu);
    faux.sert_une(move |mut flux| {
        let cadre = lit_dernier_sans_reponse(&mut flux);
        *cadre_fils
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cadre);
        let _ = writeln!(
            flux,
            "{}",
            json!({ "id": 1, "result": { "tab": "t-1", "root_pane": "p-1" } })
        );
    });
    let mut client = connecte(&faux);
    match client.creation_onglet(Some("/projets/atelier"), false, None, Some("wA")) {
        Ok(onglet) => {
            assert!(
                onglet.tab == "t-1" && onglet.root_pane == "p-1",
                "la réponse vérifiée passe"
            );
        }
        Err(cause) => panic!("création refusée : {cause}"),
    }
    let cadre = match cadre_vu
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
    {
        Some(cadre) => cadre,
        None => panic!("cadre noté"),
    };
    let params = cadre.get("params").cloned().unwrap_or(Value::Null);
    assert!(
        params.get("cwd").and_then(Value::as_str) == Some("/projets/atelier")
            && params.get("focus").and_then(Value::as_bool) == Some(false)
            && params.get("label").is_none_or(Value::is_null)
            && params.get("workspace_id").and_then(Value::as_str) == Some("wA"),
        "tab.create porte cwd/focus/label/workspace_id (mesuré) : {params}"
    );
}

/// Le port RÉEL contre le faux socket : `agent.start` part avec le délai du
/// fil (120 s) et le refus « coquille pas prête » d'Herdr devient
/// `ShellNotReady` — sans quoi les 10 essais du moteur ne se déclenchaient
/// jamais et un onglet tout juste créé donnait 502.
#[test]
fn le_port_traduit_le_refus_coquille_de_agent_start() {
    use domain::ports::ControlPort;
    use domain::ports::{StartAgent, StartEvidence};

    let faux = FauxHerdr::nouveau("herdr-start");
    let vues: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let notees = Arc::clone(&vues);
    faux.sert_une(move |flux| {
        let mut lecteur = BufReader::new(match flux.try_clone() {
            Ok(clone) => clone,
            Err(cause) => panic!("clone : {cause}"),
        });
        let mut ligne = String::new();
        if lecteur.read_line(&mut ligne).is_err() {
            return;
        }
        let demande: Value = match serde_json::from_str(&ligne) {
            Ok(valeur) => valeur,
            Err(cause) => panic!("demande illisible : {cause}"),
        };
        notees
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(demande.clone());
        let reponse = json!({
            "id": demande["id"],
            "error": { "code": "invalid_request", "message": "pane w1:p4 is not an available shell" }
        });
        let mut flux = flux;
        let _ = writeln!(flux, "{reponse}");
    });
    let port = match herdr_client::port::PortHerdr::connecte(&faux.chemin) {
        Ok(port) => port,
        Err(cause) => panic!("port : {cause}"),
    };
    let mut futur = port.start_agent(StartAgent {
        pane: domain::ids::PaneId::from(String::from("w1:p4")),
        kind: domain::ids::AgentKind::from(String::from("pi")),
        name: None,
        args: Vec::new(),
    });
    let mut contexte = std::task::Context::from_waker(std::task::Waker::noop());
    let issue = match futur.as_mut().poll(&mut contexte) {
        std::task::Poll::Ready(issue) => issue,
        std::task::Poll::Pending => panic!("un port bloquant répond au premier poll"),
    };
    assert!(
        matches!(issue, Ok(StartEvidence::ShellNotReady { .. })),
        "{issue:?}"
    );
    let demandes = vues
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    assert_eq!(demandes.len(), 1, "une seule demande : aucune relance ici");
    assert_eq!(demandes[0]["method"], "agent.start");
    assert_eq!(demandes[0]["params"]["timeout_ms"], 120_000);
}
