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
        taches: Arc::new(sessions::agents::claude::taches::LecteurTaches::nouveau(
            std::env::temp_dir().join("herdrchat-taches-absentes"),
        )),
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
        wal: None,
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

#[test]
fn l_horodatage_d_une_ligne_est_celui_du_jour_ecrit() {
    // La copie locale de la conversion datait chaque ligne du lendemain.
    let entree = SessionEntry {
        kind: String::from("message"),
        id: Some(String::from("m1")),
        parent_id: None,
        raw: String::from(r#"{"type":"message","message":{"role":"user","content":"x"}}"#),
        timestamp: Some(String::from("2026-10-29T12:55:21.154Z")),
    };
    let lue = herdrchat::assemblage::entree_lue(&entree);
    assert_eq!(lue.horodatage, Some(1_793_278_521_154));
    let mars = SessionEntry {
        timestamp: Some(String::from("2024-03-01T00:00:00Z")),
        ..entree
    };
    assert_eq!(
        herdrchat::assemblage::entree_lue(&mars).horodatage,
        Some(1_709_251_200_000),
        "le lendemain d'un 29 février"
    );
}

#[test]
fn la_derniere_demande_est_retrouvee_au_dela_de_la_fenetre() {
    // Une demande, puis plus de 64 Kio de sortie d'outil : la fenêtre de
    // résumé ne contient plus la demande. Le résumé doit remonter le fil.
    let dossier = racine("soutien-assemblage-remontee");
    let chemin = dossier.join("session.jsonl");
    let mut contenu = String::new();
    contenu.push_str(
        r#"{"type":"model_change","modelId":"opus-test","timestamp":"2026-10-29T10:00:00Z"}"#,
    );
    contenu.push('\n');
    contenu.push_str(r#"{"type":"message","id":"u1","timestamp":"2026-10-29T10:00:01Z","message":{"role":"user","content":"corrige la racine claude"}}"#);
    contenu.push('\n');
    let sortie = "y".repeat(4000);
    for n in 0..40 {
        contenu.push_str(&format!(
            r#"{{"type":"message","id":"t{n}","timestamp":"2026-10-29T10:01:00Z","message":{{"role":"toolResult","content":"{sortie}"}}}}"#
        ));
        contenu.push('\n');
    }
    std::fs::write(&chemin, contenu).unwrap_or_else(|cause| panic!("écriture : {cause}"));
    let racines = sessions::resolver::Racines {
        pi_sessions: dossier.clone(),
        codex_sessions: dossier.join("codex"),
        codex_home: dossier.join("codex-home"),
        claude_projects: dossier.join("claude"),
        opencode_db: dossier.join("opencode.db"),
        devin_db: dossier.join("devin.db"),
    };
    let lecteur = LitSessionsViaPort {
        port: Arc::new(sessions::port::PortSessions::nouveau(racines)),
        familles: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        fenetres: Arc::new(std::sync::Mutex::new(CacheFenetres::default())),
        taches: Arc::new(sessions::agents::claude::taches::LecteurTaches::nouveau(
            std::env::temp_dir().join("herdrchat-taches-absentes"),
        )),
    };
    let entrees = lecteur
        .fenetre(
            &PaneId::from(String::from("w1:p1")),
            &source(&chemin.display().to_string()),
        )
        .unwrap_or_else(|cause| panic!("fenêtre : {}", cause.cause));
    assert!(
        entrees
            .iter()
            .any(|entree| entree.texte.as_deref() == Some("corrige la racine claude")),
        "la demande lointaine est retrouvée"
    );
    assert!(
        entrees
            .iter()
            .any(|entree| entree.modele.as_deref() == Some("opus-test")),
        "le modèle d'un model_change lointain est retrouvé"
    );
    assert!(
        entrees.len() < 40,
        "on ne garde que ce qui manquait : {}",
        entrees.len()
    );
    let _ = std::fs::remove_dir_all(&dossier);
}

#[test]
fn une_ligne_de_comptabilite_n_est_jamais_une_demande() {
    // `api-request-blob` (Claude Code) porte un `message.role: "user"` : la
    // requête API, pas une demande de l'utilisateur.
    let comptabilite = SessionEntry {
        kind: String::from("api-request-blob"),
        id: None,
        parent_id: None,
        raw: String::from(
            r#"{"type":"api-request-blob","message":{"role":"user","content":"consignes système"}}"#,
        ),
        timestamp: Some(String::from("2026-10-29T12:55:21Z")),
    };
    let lue = herdrchat::assemblage::entree_lue(&comptabilite);
    assert_eq!(lue.role, application::conversations::RoleDeSession::Autre);
    assert!(
        lue.texte.is_none(),
        "aucun texte de demande : {:?}",
        lue.texte
    );
}

fn entree(kind: &str, raw: &str) -> SessionEntry {
    SessionEntry {
        kind: String::from(kind),
        id: None,
        parent_id: None,
        raw: String::from(raw),
        timestamp: Some(String::from("2026-10-29T12:00:00Z")),
    }
}

#[test]
fn l_appel_d_outil_de_l_assistant_fait_l_apercu() {
    // `toolName` n'existe que sur les résultats : un agent qui n'avait fait
    // QUE des appels avait un aperçu vide.
    let lue = herdrchat::assemblage::entree_lue(&entree(
        "message",
        r#"{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"…"},{"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"cargo test --workspace\nsuite"}}]}}"#,
    ));
    let outil = lue.outil.unwrap_or_else(|| panic!("l'appel est lu"));
    assert_eq!(outil.nom, "bash");
    assert_eq!(
        outil.indice.as_deref(),
        Some("cargo test --workspace\nsuite")
    );
    // Arguments en chaîne (codex) : la première ligne, 80 caractères.
    let longue = "x".repeat(120);
    let lue = herdrchat::assemblage::entree_lue(&entree(
        "message",
        &format!(
            r#"{{"type":"message","message":{{"role":"assistant","content":[{{"type":"toolCall","id":"c1","name":"exec","arguments":"{longue}\nautre"}}]}}}}"#
        ),
    ));
    let outil = lue.outil.unwrap_or_else(|| panic!("l'appel est lu"));
    assert_eq!(outil.indice.map(|indice| indice.chars().count()), Some(80));
}

#[test]
fn le_fournisseur_et_le_niveau_d_un_changement_sont_a_la_racine() {
    let modele = herdrchat::assemblage::entree_lue(&entree(
        "model_change",
        r#"{"type":"model_change","modelId":"gpt-5.5","provider":"openai"}"#,
    ));
    assert_eq!(modele.modele.as_deref(), Some("gpt-5.5"));
    assert_eq!(modele.fournisseur.as_deref(), Some("openai"));
    let niveau = herdrchat::assemblage::entree_lue(&entree(
        "thinking_level_change",
        r#"{"type":"thinking_level_change","thinkingLevel":"high"}"#,
    ));
    assert_eq!(niveau.niveau_pensee.as_deref(), Some("high"));
}

#[test]
fn le_harnais_et_la_demande_pendant_le_tour_sont_distingues() {
    use application::conversations::RoleDeSession;
    let rapport = herdrchat::assemblage::entree_lue(&entree(
        "message",
        r#"{"type":"message","message":{"role":"custom","customType":"subagent-report","content":[{"type":"text","text":"rapport"}],"details":{"midTurn":true}}}"#,
    ));
    assert_eq!(rapport.role, RoleDeSession::Harnais);
    assert!(rapport.en_cours_de_tour);
    let demande = herdrchat::assemblage::entree_lue(&entree(
        "message",
        r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"et aussi"}],"details":{"midTurn":true}}}"#,
    ));
    assert_eq!(demande.role, RoleDeSession::User);
    assert!(demande.en_cours_de_tour);
    let ordinaire = herdrchat::assemblage::entree_lue(&entree(
        "message",
        r#"{"type":"message","message":{"role":"user","content":"go"}}"#,
    ));
    assert!(!ordinaire.en_cours_de_tour);
}

#[test]
fn le_journal_wal_change_la_signature() {
    // opencode/Devin en mode WAL : un message neuf va dans `-wal`, la base
    // ne bouge pas avant le checkpoint.
    let dossier = racine("assemblage-wal");
    let base = dossier.join("opencode.db");
    std::fs::write(&base, b"base").unwrap_or_else(|cause| panic!("{cause}"));
    let chemin = base.display().to_string();
    let avant = signature_de(&chemin).unwrap_or_else(|| panic!("signature"));
    assert_eq!(avant.wal, None);
    std::fs::write(dossier.join("opencode.db-wal"), b"un message")
        .unwrap_or_else(|cause| panic!("{cause}"));
    let apres = signature_de(&chemin).unwrap_or_else(|| panic!("signature"));
    assert_ne!(avant, apres, "le WAL qui grandit invalide la fenêtre");
    let _ = std::fs::remove_dir_all(&dossier);
}

#[test]
fn les_taches_ne_sont_lues_que_pour_une_session_claude() {
    use application::overview::ResoutSessions;
    let dossier = racine("assemblage-taches");
    let projet = dossier.join("claude").join("-projet");
    std::fs::create_dir_all(projet.join("s1").join("subagents"))
        .unwrap_or_else(|cause| panic!("{cause}"));
    let session = projet.join("s1.jsonl");
    std::fs::write(
        &session,
        "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"go\"}}\n",
    )
    .unwrap_or_else(|cause| panic!("{cause}"));
    std::fs::write(
        projet
            .join("s1")
            .join("subagents")
            .join("agent-ab1.meta.json"),
        r#"{"agentType":"fork","description":"Audit","requestShape":"background","finished":true}"#,
    )
    .unwrap_or_else(|cause| panic!("{cause}"));
    std::fs::write(
        projet.join("s1").join("subagents").join("agent-ab1.jsonl"),
        "{}\n",
    )
    .unwrap_or_else(|cause| panic!("{cause}"));

    struct Resout(String);
    impl SessionPort for Resout {
        fn resolve(&self, hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
            let base = self.0.clone();
            Box::pin(async move {
                Ok(Some(ResolvedSource {
                    kind: application::sessions_types::SourceKind::File,
                    base,
                    session_id: None,
                    family: hint.agent,
                }))
            })
        }
        fn page(&self, _r: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
            Box::pin(async {
                Ok(SessionPageOutcome::Io {
                    detail: String::from("inutile"),
                })
            })
        }
        fn metadata(
            &self,
            _source: ResolvedSource,
        ) -> SessionFuture<'_, domain::session::SessionMetadata> {
            Box::pin(async { Ok(domain::session::SessionMetadata::default()) })
        }
    }
    let lecteur = LitSessionsViaPort {
        port: Arc::new(Resout(session.display().to_string())),
        familles: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        fenetres: Arc::new(std::sync::Mutex::new(CacheFenetres::default())),
        taches: Arc::new(sessions::agents::claude::taches::LecteurTaches::nouveau(
            dossier.join("claude"),
        )),
    };
    let agent = |kind: &str| domain::observation::AgentObservation {
        agent: Some(domain::ids::AgentKind::from(String::from(kind))),
        ..test_support::fixtures::snapshot_de_base().agents[0].clone()
    };
    let claude = lecteur
        .source_de(&agent("claude"))
        .unwrap_or_else(|| panic!("source"));
    let taches = lecteur
        .taches(&claude)
        .unwrap_or_else(|| panic!("Claude expose ses tâches"))
        .unwrap_or_else(|cause| panic!("{cause}"));
    assert_eq!(taches.len(), 1);
    assert_eq!(
        taches[0].statut,
        application::conversations::StatutTache::Terminee
    );
    assert!(lecteur.transcription_de_tache(&claude, "ab1").is_some());
    assert!(lecteur.transcription_de_tache(&claude, "../s1").is_none());
    // Une autre famille : capacité absente, jamais le profil de Claude.
    let pi = lecteur
        .source_de(&agent("pi"))
        .unwrap_or_else(|| panic!("source"));
    assert!(lecteur.taches(&pi).is_none());
    let _ = std::fs::remove_dir_all(&dossier);
}

/// Un port à deux pages : la plus récente (avec un « avant »), puis la
/// précédente — pour prouver ce que la remontée va chercher.
struct DeuxPages {
    recente: Vec<String>,
    ancienne: Vec<String>,
    lectures: Arc<AtomicUsize>,
}

impl SessionPort for DeuxPages {
    fn resolve(&self, _hint: SessionHint) -> SessionFuture<'_, Option<ResolvedSource>> {
        Box::pin(async { Ok(None) })
    }

    fn page(&self, request: SessionPageRequest) -> SessionFuture<'_, SessionPageOutcome> {
        self.lectures.fetch_add(1, Ordering::SeqCst);
        let ancienne = request.previous_cursor.is_some();
        let lignes = if ancienne {
            &self.ancienne
        } else {
            &self.recente
        };
        let page = SessionPage {
            session_path: request.source.base.clone(),
            entries: lignes
                .iter()
                .map(|raw| {
                    let valeur: serde_json::Value =
                        serde_json::from_str(raw).unwrap_or(serde_json::Value::Null);
                    SessionEntry {
                        kind: valeur["type"].as_str().unwrap_or("message").to_string(),
                        id: None,
                        parent_id: None,
                        raw: raw.clone(),
                        timestamp: None,
                    }
                })
                .collect(),
            incremental: false,
            cursor: None,
            previous_cursor: (!ancienne).then(|| String::from("avant")),
            has_more: !ancienne,
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

#[test]
fn la_remontee_cherche_le_fournisseur_des_familles_qui_l_ecrivent() {
    let recente = vec![
        String::from(
            r#"{"type":"message","message":{"role":"user","content":"go"},"timestamp":"2026-10-29T10:00:00Z"}"#,
        ),
        String::from(
            r#"{"type":"message","message":{"role":"assistant","content":"fait","model":"gpt-6-luna"}}"#,
        ),
    ];
    let ancienne = vec![String::from(
        r#"{"type":"model_change","modelId":"gpt-6-luna","provider":"openai"}"#,
    )];
    for (famille, attendu, lectures_attendues) in [
        ("codex", Some("openai"), 2),
        // Claude n'écrit jamais de fournisseur : aucune remontée pour lui.
        ("claude", None, 1),
    ] {
        let lectures = Arc::new(AtomicUsize::new(0));
        let lecteur = LitSessionsViaPort {
            port: Arc::new(DeuxPages {
                recente: recente.clone(),
                ancienne: ancienne.clone(),
                lectures: Arc::clone(&lectures),
            }),
            familles: Arc::new(std::sync::Mutex::new(std::collections::HashMap::from([(
                String::from("/sessions/s.jsonl"),
                domain::ids::AgentKind::from(String::from(famille)),
            )]))),
            fenetres: Arc::new(std::sync::Mutex::new(CacheFenetres::default())),
            taches: Arc::new(sessions::agents::claude::taches::LecteurTaches::nouveau(
                std::env::temp_dir().join("herdrchat-taches-absentes"),
            )),
        };
        let entrees = lecteur
            .fenetre(
                &PaneId::from(String::from("w1:p1")),
                &source("/sessions/s.jsonl"),
            )
            .unwrap_or_else(|cause| panic!("fenêtre : {}", cause.cause));
        let fournisseur = entrees.iter().find_map(|entree| entree.fournisseur.clone());
        assert_eq!(fournisseur.as_deref(), attendu, "{famille}");
        assert_eq!(
            lectures.load(Ordering::SeqCst),
            lectures_attendues,
            "{famille}"
        );
    }
}

/// Régression (P0) : la résolution de l'accueil portait `cwd`/`parent` en dur
/// à `None` et jetait l'identifiant de l'en-tête — `sessionCwd` et
/// `sessionCwdMatches` absents pour toutes les sessions Pi.
#[test]
fn la_resolution_porte_ce_que_declare_l_en_tete_d_une_session_pi() {
    use application::overview::ResoutSessions;
    use herdrchat::assemblage::ResoutSessionsViaPort;
    let racine = racine("assemblee-entete");
    let fichier = racine.join("s.jsonl");
    let contenu = concat!(
        r#"{"type":"session","version":3,"id":"s-7","cwd":"/tmp/projet","parentSession":"p-1"}"#,
        "\n"
    );
    match std::fs::write(&fichier, contenu) {
        Ok(()) => (),
        Err(cause) => panic!("écriture : {cause}"),
    }
    let port = sessions::port::PortSessions::nouveau(sessions::resolver::Racines {
        pi_sessions: racine.clone(),
        claude_projects: racine.join("claude"),
        codex_home: racine.join("codex-home"),
        codex_sessions: racine.join("codex-sessions"),
        devin_db: racine.join("devin.db"),
        opencode_db: racine.join("opencode.db"),
    });
    let resolveur = ResoutSessionsViaPort {
        port: Arc::new(port),
    };
    let mut agent = test_support::fixtures::snapshot_de_base().agents[0].clone();
    agent.agent = Some(domain::ids::AgentKind::from(String::from("pi")));
    agent.session = Some(domain::observation::AgentSessionRef {
        kind: domain::observation::SessionRefKind::Path,
        value: fichier.to_string_lossy().to_string(),
    });
    let source = resolveur
        .source_de(&agent)
        .unwrap_or_else(|| panic!("la session publiée doit se résoudre"));
    assert_eq!(source.cwd.as_deref(), Some("/tmp/projet"));
    assert_eq!(
        source.session_id.as_ref().map(|id| id.as_str()),
        Some("s-7")
    );
    assert_eq!(source.parent.as_ref().map(|id| id.as_str()), Some("p-1"));
    let _ = std::fs::remove_dir_all(&racine);
}
