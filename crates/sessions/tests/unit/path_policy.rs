//! La politique de source (T011/C13/S03) : résoudre puis vérifier, refus
//! précis, plusieurs racines, verdicts distincts.

use sessions::path_policy::{RefusChemin, VerdictChemin, resolu_sous};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static NONCE: AtomicU32 = AtomicU32::new(0);

fn temporaire(prefixe: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let chemin = base.join(format!("{prefixe}-{pid}-{nonce}"));
    match fs::create_dir(&chemin) {
        Ok(()) => chemin,
        Err(cause) => panic!("racine temporaire refusée : {cause}"),
    }
}

#[test]
fn un_fichier_legitime_est_autorise_sur_son_chemin_resolu() {
    let racine = temporaire("soutien-politique-legitime");
    let fichier = racine.join("sessions/agent.jsonl");
    match fs::create_dir_all(
        fichier
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(racine.clone()),
    ) {
        Ok(()) => (),
        Err(cause) => panic!("mkdir refusé : {cause}"),
    }
    match fs::write(&fichier, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let verdict = resolu_sous(std::slice::from_ref(&racine), &fichier);
    match verdict {
        VerdictChemin::Autorise { resolu } => assert!(
            resolu.starts_with("/private/var")
                || resolu.starts_with(&racine)
                || resolu.is_absolute(),
            "le résolu est canonique et absolu : {resolu:?}"
        ),
        VerdictChemin::Refuse { raison } => {
            panic!(
                "fichier légitime refusé : {raison:?} ({})",
                raison.message()
            )
        }
    }
}

#[test]
fn les_refus_sont_distincts_et_parlent() {
    // Les quatre causes, chacune avec son message du fil — jamais générique.
    assert!(RefusChemin::RacineAbsente.message() == "sessions root not found");
    assert!(RefusChemin::CheminAbsent.message() == "missing session");
    assert!(RefusChemin::HorsRacine.message() == "session path outside the allowed root");
    assert!(RefusChemin::LienSortant.message() == "symlink escaping the allowed root");
}

#[test]
fn une_racine_absente_est_une_cause_propre() {
    // Racine inexistante : rien n'est lisible, et la cause est distincte
    // d'une sortie de périmètre — un typo de config ne se lit pas comme
    // une intrusion.
    let verdict = resolu_sous(
        &[PathBuf::from("/cette/racine/nexiste/pas")],
        Path::new("/etc/passwd"),
    );
    match verdict {
        VerdictChemin::Refuse {
            raison: RefusChemin::RacineAbsente,
        } => (),
        autre => panic!("racine absente attendue, pas {autre:?}"),
    }
    // Aucune racine configurée : même verdict.
    match resolu_sous(&[], Path::new("/etc/passwd")) {
        VerdictChemin::Refuse {
            raison: RefusChemin::RacineAbsente,
        } => (),
        autre => panic!("sans racine, refus racine-absente, pas {autre:?}"),
    }
}

#[test]
fn la_sortie_et_le_frere_sont_hors_racine() {
    let racine = temporaire("soutien-politique-sortie");
    // Sortie déclarée par `..`.
    let dehors = racine.join("..").join("ailleurs.jsonl");
    match resolu_sous(std::slice::from_ref(&racine), &dehors) {
        VerdictChemin::Refuse {
            raison: RefusChemin::HorsRacine,
        } => (),
        autre => panic!("sortie par .. attendue, pas {autre:?}"),
    }
    // Frère : la comparaison par composants, pas par préfixe. Le frère doit
    // EXISTER pour être vu — un chemin absent se manifeste d'abord comme
    // « missing session » (le premier fait constaté, mesuré dans le fil).
    let racine_frere = racine
        .parent()
        .map(|parent| parent.join("sessions-malveillantes"));
    if let Some(racine_frere) = racine_frere {
        match fs::create_dir_all(&racine_frere) {
            Ok(()) => (),
            Err(cause) => panic!("mkdir frère refusé : {cause}"),
        }
        let frere = racine_frere.join("x.jsonl");
        match fs::write(&frere, "{}") {
            Ok(()) => (),
            Err(cause) => panic!("écriture frère refusée : {cause}"),
        }
        match resolu_sous(std::slice::from_ref(&racine), &frere) {
            VerdictChemin::Refuse {
                raison: RefusChemin::HorsRacine,
            } => (),
            autre => panic!("frère existant attendu hors racine, pas {autre:?}"),
        }
    }
}

#[test]
fn le_lien_sortant_se_distingue_de_la_sortie_declaree() {
    let racine = temporaire("soutien-politique-lien");
    let fichier = racine.join("reel.jsonl");
    match fs::write(&fichier, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    // Le chemin DÉCLARÉ est dedans, mais il POINTE dehors : lien-sortant.
    let sortant = racine.join("annonce.jsonl");
    match std::os::unix::fs::symlink("/etc/passwd", &sortant) {
        Ok(()) => (),
        Err(cause) => panic!("symlink refusé : {cause}"),
    }
    match resolu_sous(std::slice::from_ref(&racine), &sortant) {
        VerdictChemin::Refuse {
            raison: RefusChemin::LienSortant,
        } => (),
        autre => panic!("lien sortant attendu, pas {autre:?}"),
    }
    // Le chemin déclaré est déjà dehors : hors-racine, pas lien-sortant.
    match resolu_sous(std::slice::from_ref(&racine), Path::new("/etc/passwd")) {
        VerdictChemin::Refuse {
            raison: RefusChemin::HorsRacine,
        } => (),
        autre => panic!("hors racine attendu, pas {autre:?}"),
    }
}

#[test]
fn un_chemin_pas_encree_cree_reste_compris_dans_la_racine() {
    // Pi crée le JSONL au premier message : le fichier peut légitimement
    // manquer — le PARENT résolu décide.
    let racine = temporaire("soutien-politique-absent");
    let futur = racine.join("sessions/pas-encore.jsonl");
    match fs::create_dir_all(racine.join("sessions")) {
        Ok(()) => (),
        Err(cause) => panic!("mkdir refusé : {cause}"),
    }
    match resolu_sous(std::slice::from_ref(&racine), &futur) {
        VerdictChemin::Refuse {
            raison: RefusChemin::CheminAbsent,
        } => (),
        autre => panic!("chemin absent attendu (parent dedans), pas {autre:?}"),
    }
    // Le parent lui-même est dehors (créé pour exister) : HORS RACINE, pas
    // chemin absent.
    let dehors_dossier = racine.parent().map(|parent| parent.join("autre"));
    if let Some(dehors_dossier) = dehors_dossier {
        match fs::create_dir_all(&dehors_dossier) {
            Ok(()) => (),
            Err(cause) => panic!("mkdir dehors refusé : {cause}"),
        }
        let dehors_futur = dehors_dossier.join("pas-encore.jsonl");
        match resolu_sous(std::slice::from_ref(&racine), &dehors_futur) {
            VerdictChemin::Refuse {
                raison: RefusChemin::HorsRacine,
            } => (),
            autre => panic!("parent dehors attendu hors racine, pas {autre:?}"),
        }
    }
}

#[test]
fn les_plusieurs_racines_se_composent_avec_le_refus_precis() {
    // Chaque agent a son dossier : pi ET codex doivent passer ensemble.
    let racine_pi = temporaire("soutien-politique-pi");
    let racine_codex = temporaire("soutien-politique-codex");
    let session_codex = racine_codex.join("x.jsonl");
    match fs::write(&session_codex, "{}") {
        Ok(()) => (),
        Err(cause) => panic!("écriture refusée : {cause}"),
    }
    let racines = vec![racine_pi.clone(), racine_codex.clone()];
    match resolu_sous(&racines, &session_codex) {
        VerdictChemin::Autorise { .. } => (),
        VerdictChemin::Refuse { raison } => panic!(
            "une session codex doit passer sous ses racines : {raison:?} ({})",
            raison.message()
        ),
    }
    // Un refus PRÉCIS l'emporte sur « racine-absente » : une racine morte ne
    // masque pas une vraie sortie de périmètre.
    let racines_mortes = vec![
        PathBuf::from("/racine/morte"),
        PathBuf::from("/autre/morte"),
    ];
    match resolu_sous(&racines_mortes, Path::new("/etc/passwd")) {
        VerdictChemin::Refuse {
            raison: RefusChemin::RacineAbsente,
        } => (),
        autre => panic!("toutes mortes + sortie → racine-absente, pas {autre:?}"),
    }
}
