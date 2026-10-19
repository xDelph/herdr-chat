//! L'assemblage des ports (T056/T065) : la fenêtre de résumé est **mise en
//! cache** par l'identité mesurée de la source (chemin, taille, mtime), et
//! une source qui change est **relue** — jamais de résumé périmé.
//!
//! ⚠️ **Pourquoi ce cache existe.** Le banc T065 a mesuré
//! `GET /api/conversations` à p95 72 ms contre 5 ms pour la référence : le
//! chemin Rust relisait et ré-analysait chaque session à chaque requête. Le
//! cache de résumés de D19 existait déjà mais n'était pas branché sur la
//! lecture.
//!
//! ⚠️ **Ce que ces tests prouvent, dans cet ordre.** Un cache qui ne se
//! rafraîchit pas est un mensonge, un cache qui ne sert jamais est un
//! ornement : il faut donc prouver les deux — le deuxième appel ne relit
//! **pas**, et un fichier qui grandit est **relu**.

use application::conversations::LitSessions;
use application::overview::SourceDeSession;
use application::ports::SessionFuture;
use application::sessions_types::{ResolvedSource, SessionHint};
use domain::ids::PaneId;
use domain::ports::SessionPort;
use domain::session::{SessionEntry, SessionPage, SessionPageOutcome, SessionPageRequest};
use herdrchat::assemblage::{CacheFenetres, LitSessionsViaPort, Signature, signature_de};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

fn racine(prefixe: &str) -> std::path::PathBuf {
    let chemin = std::env::temp_dir().join(format!(
        "{prefixe}-{}-{}",
        std::process::id(),
        NONCE.fetch_add(1, Ordering::SeqCst)
    ));
    match std::fs::create_dir_all(&chemin) {
        Ok(()) => (),
        Err(cause) => panic!("racine refusée : {cause}"),
    }
    chemin
}

/// Un port de sessions qui compte ses lectures et rend la ligne demandée.
struct Compteur {
    lectures: Arc<AtomicUsize>,
    lignes: Arc<std::sync::Mutex<Vec<String>>>,
}

impl SessionPort for Compteur {
    fn resolve(&self, _hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        Box::pin(async { Ok(None) })
    }

    fn page(&self, request: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        self.lectures.fetch_add(1, Ordering::SeqCst);
        let lignes = self
            .lignes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let entrees: Vec<SessionEntry> = lignes
            .iter()
            .enumerate()
            .map(|(indice, ligne)| SessionEntry {
                kind: String::from("message"),
                id: Some(format!("m{indice}")),
                parent_id: None,
                raw: ligne.clone(),
                timestamp: None,
            })
            .collect();
        let page = SessionPage {
            session_path: request.source.base.clone(),
            entries: entrees,
            incremental: false,
            cursor: None,
            previous_cursor: None,
            has_more: false,
            reset: false,
            rattrape: true,
        };
        Box::pin(async move { Ok(SessionPageOutcome::Page(page)) })
    }

    fn metadata(
        &self,
        _source: ResolvedSource,
    ) -> SessionFuture<'_, domain::session::SessionMetadata> {
        Box::pin(async { Ok(domain::session::SessionMetadata::default()) })
    }
}

fn port(
    lectures: Arc<AtomicUsize>,
    lignes: Arc<std::sync::Mutex<Vec<String>>>,
) -> LitSessionsViaPort {
    LitSessionsViaPort {
        port: Arc::new(Compteur { lectures, lignes }),
        familles: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        fenetres: Arc::new(std::sync::Mutex::new(CacheFenetres::default())),
    }
}

fn source(base: &str) -> SourceDeSession {
    SourceDeSession {
        kind: application::noyau::SessionRefKind::Path,
        base: Some(base.to_string()),
        session_id: None,
        cwd: None,
        parent: None,
    }
}

fn ligne(texte: &str) -> String {
    format!(r#"{{"type":"message","message":{{"role":"user","content":"{texte}"}}}}"#)
}

#[test]
fn le_deuxieme_appel_ne_relit_pas_une_source_inchangee() {
    let racine = racine("assemblee-cache");
    let fichier = racine.join("s.jsonl");
    let contenu = format!("{}\n{}\n", ligne("un"), ligne("deux"));
    match std::fs::write(&fichier, &contenu) {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    let lectures = Arc::new(AtomicUsize::new(0));
    let lignes = Arc::new(std::sync::Mutex::new(vec![ligne("un"), ligne("deux")]));
    let adaptateur = port(Arc::clone(&lectures), Arc::clone(&lignes));
    let base = fichier.to_string_lossy().to_string();
    let pane = PaneId::from(String::from("w1:p1"));

    let premiere = adaptateur
        .fenetre(&pane, &source(&base))
        .unwrap_or_else(|cause| panic!("première fenêtre : {cause:?}"));
    assert_eq!(premiere.len(), 2);
    assert_eq!(
        lectures.load(Ordering::SeqCst),
        1,
        "la première lecture passe par le port"
    );

    let seconde = adaptateur
        .fenetre(&pane, &source(&base))
        .unwrap_or_else(|cause| panic!("seconde fenêtre : {cause:?}"));
    assert_eq!(seconde, premiere, "le cache rend la même fenêtre");
    assert_eq!(
        lectures.load(Ordering::SeqCst),
        1,
        "aucune relecture tant que la source n'a pas changé"
    );
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn une_source_qui_grandit_est_relue_pas_servie_perimee() {
    let racine = racine("assemblee-perime");
    let fichier = racine.join("s.jsonl");
    match std::fs::write(&fichier, format!("{}\n", ligne("un"))) {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    let lectures = Arc::new(AtomicUsize::new(0));
    let lignes = Arc::new(std::sync::Mutex::new(vec![ligne("un")]));
    let adaptateur = port(Arc::clone(&lectures), Arc::clone(&lignes));
    let base = fichier.to_string_lossy().to_string();
    let pane = PaneId::from(String::from("w1:p1"));

    let premiere = adaptateur
        .fenetre(&pane, &source(&base))
        .unwrap_or_else(|cause| panic!("première fenêtre : {cause:?}"));
    assert_eq!(premiere.len(), 1);

    // L'agent écrit une ligne de plus : taille ET mtime changent.
    let mut ajout = std::fs::OpenOptions::new()
        .append(true)
        .open(&fichier)
        .unwrap_or_else(|cause| panic!("ouverture : {cause}"));
    {
        use std::io::Write as _;
        match ajout.write_all(format!("{}\n", ligne("trois")).as_bytes()) {
            Ok(()) => (),
            Err(cause) => panic!("ajout : {cause}"),
        }
    }
    {
        let mut garde = lignes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        garde.push(ligne("trois"));
    }
    let seconde = adaptateur
        .fenetre(&pane, &source(&base))
        .unwrap_or_else(|cause| panic!("seconde fenêtre : {cause:?}"));
    assert_eq!(seconde.len(), 2, "la ligne ajoutée est servie");
    assert_eq!(lectures.load(Ordering::SeqCst), 2, "la source a été relue");
    let _ = std::fs::remove_dir_all(&racine);
}

#[test]
fn le_cache_est_borne_et_evince_la_plus_ancienne() {
    let mut cache = CacheFenetres::default();
    let signature = Signature {
        octets: 1,
        mtime_ns: 1,
    };
    for indice in 0..(herdrchat::assemblage::CAPACITE_FENETRES + 10) {
        cache.pose(&format!("source-{indice}"), signature, Vec::new());
    }
    assert_eq!(
        cache.len(),
        herdrchat::assemblage::CAPACITE_FENETRES,
        "le cache ne dépasse pas sa borne"
    );
    assert!(
        cache.lit("source-0", signature).is_none(),
        "la plus ancienne est évincée"
    );
    assert!(
        cache
            .lit(
                &format!("source-{}", herdrchat::assemblage::CAPACITE_FENETRES + 9),
                signature
            )
            .is_some(),
        "la plus récente est servie"
    );
}

#[test]
fn une_signature_differente_est_un_defaut_de_cache() {
    let racine = racine("assemblee-signature");
    let fichier = racine.join("s.jsonl");
    match std::fs::write(&fichier, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    let avant = signature_de(&fichier.to_string_lossy())
        .unwrap_or_else(|| panic!("une signature pour un fichier existant"));
    match std::fs::write(&fichier, "{}{}") {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    let apres = signature_de(&fichier.to_string_lossy())
        .unwrap_or_else(|| panic!("une signature pour un fichier existant"));
    assert_ne!(avant, apres, "la taille change la signature");
    assert!(
        signature_de("/chemin/qui/n/existe/pas").is_none(),
        "un chemin absent n'a pas de signature — donc pas de cache"
    );
    let _ = std::fs::remove_dir_all(&racine);
}
