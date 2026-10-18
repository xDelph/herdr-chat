//! `contracts export` / `contracts check` — les exports de schémas (T009).
//!
//! ⚠️ **Déterminisme prouvé, pas espéré** : `check` génère **deux fois**
//! dans des répertoires temporaires, compare octet par octet les deux
//! passes, puis compare avec le dépôt (`packages/shared/generated`) — une
//! modification de DTO sans régénération est un échec nommé. Le corpus est
//! ensuite validé **côté JS** par les validateurs générés : accepté/refusé
//! identiquement à serde (C01).

use ::contracts::schema::{self, VERSION};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Les cinq documents générés — l'ensemble est fermé : un fichier de plus ou
/// de moins dans `generated` est un échec de `check`.
const GENERES: [&str; 6] = [
    "contracts.schema.json",
    "openapi.json",
    "cibles.json",
    "contracts.d.ts",
    "valider.mjs",
    // T057 : la façade Effect dérivée du bundle — le client décode avec
    // elle, comme le serveur sérialise avec le contrat.
    "schemas.ts",
];

/// Écrit un document JSON en pretty + saut final — l'unique format d'export.
fn ecris_json(destination: &Path, document: &Value) -> Result<(), String> {
    let mut texte = serde_json::to_string_pretty(document)
        .map_err(|cause| format!("sérialisation de {} : {cause}", destination.display()))?;
    texte.push('\n');
    fs::write(destination, texte)
        .map_err(|cause| format!("écriture de {} : {cause}", destination.display()))
}

/// Génère les trois documents Rust (bundle, OpenAPI, cibles) dans un
/// répertoire — déterministes par construction.
fn ecris_documents_rust(destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|cause| format!("création de {} : {cause}", destination.display()))?;
    let cibles = schema::cibles();
    let table_cibles: serde_json::Map<String, Value> = cibles
        .into_iter()
        .map(|(cible, nom): (&'static str, &'static str)| {
            (cible.to_string(), Value::String(nom.to_string()))
        })
        .collect();
    ecris_json(
        &destination.join("contracts.schema.json"),
        &schema::bundle(),
    )?;
    ecris_json(&destination.join("openapi.json"), &schema::openapi())?;
    ecris_json(
        &destination.join("cibles.json"),
        &serde_json::json!({ "version": VERSION, "cibles": Value::Object(table_cibles) }),
    )
}

/// Lance un script bun de génération (outils de build figés dans les
/// lockfiles, TECH §5) — la sortie du script est **retranscrite** (c'est la
/// preuve de ce que check a fait) et son échec est rapporté tel quel.
fn lance_bun(root: &Path, script: &str, arguments: &[&Path]) -> Result<(), String> {
    let sortie = Command::new("bun")
        .arg(root.join(script))
        .args(arguments)
        .current_dir(root)
        .output()
        .map_err(|cause| format!("bun introuvable pour {script} : {cause}"))?;
    let standard = String::from_utf8_lossy(&sortie.stdout);
    let erreur = String::from_utf8_lossy(&sortie.stderr);
    if !standard.is_empty() {
        print!("{standard}");
    }
    if !erreur.is_empty() {
        eprint!("{erreur}");
    }
    if !sortie.status.success() {
        return Err(format!(
            "{script} en échec (code {:?})",
            sortie.status.code()
        ));
    }
    Ok(())
}

/// Export complet vers `destination` : trois documents Rust + types TS +
/// validateurs Ajv standalone.
pub fn exporter(root: &Path, destination: &Path) -> Result<(), String> {
    ecris_documents_rust(destination)?;
    lance_bun(
        root,
        "scripts/contracts-types.ts",
        &[
            &destination.join("contracts.schema.json"),
            &destination.join("contracts.d.ts"),
        ],
    )?;
    lance_bun(
        root,
        "scripts/contracts-validators.ts",
        &[
            &destination.join("contracts.schema.json"),
            &destination.join("valider.mjs"),
        ],
    )?;
    // La façade Effect : même source, même déterminisme (noms triés).
    lance_bun(
        root,
        "scripts/contracts-schemas.ts",
        &[
            &destination.join("contracts.schema.json"),
            &destination.join("schemas.ts"),
        ],
    )?;
    Ok(())
}

/// Un répertoire temporaire unique sous le tmpdir système (pid + nonce).
fn temporaire(prefixe: &str) -> Result<PathBuf, String> {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    for nonce in 0..4_096_u32 {
        let chemin = base.join(format!("{prefixe}-{pid}-{nonce}"));
        match fs::create_dir(&chemin) {
            Ok(()) => return Ok(chemin),
            Err(cause) if cause.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(cause) => return Err(format!("répertoire temporaire : {cause}")),
        }
    }
    Err("aucun emplacement temporaire libre".to_string())
}

/// Compare deux répertoires d'export octet par octet, sur l'ensemble fermé
/// des cinq documents — toute différence est nommée.
fn compares(a: &Path, b: &Path, label_a: &str, label_b: &str) -> Result<(), String> {
    for nom in GENERES.iter() {
        let contenu_a = fs::read(a.join(nom))
            .map_err(|cause| format!("{label_a}/{nom} illisible : {cause}"))?;
        let contenu_b = fs::read(b.join(nom))
            .map_err(|cause| format!("{label_b}/{nom} illisible : {cause}"))?;
        if contenu_a != contenu_b {
            return Err(format!("{nom} diffère entre {label_a} et {label_b}"));
        }
    }
    Ok(())
}

/// `contracts check` : deux exports identiques entre eux (déterminisme),
/// le dépôt portant **exactement** les cinq documents et identiques à une
/// passe fraîche, puis le corpus validé côté JS sur le dépôt.
pub fn verifier(root: &Path) -> Result<(), String> {
    // 1. Deux passes temporaires, identiques octet pour octet.
    let passe_a = temporaire("contracts-check-a")?;
    let passe_b = temporaire("contracts-check-b")?;
    let determinant = (|| -> Result<(), String> {
        exporter(root, &passe_a)?;
        exporter(root, &passe_b)?;
        compares(&passe_a, &passe_b, "passe A", "passe B")
    })();
    let _ = fs::remove_dir_all(&passe_a);
    let _ = fs::remove_dir_all(&passe_b);
    determinant?;

    // 2. Le dépôt porte exactement les cinq documents, identiques à une
    // passe fraîche — sinon les DTO ont changé sans régénération.
    let depot = root.join("packages/shared/generated");
    let entrees =
        fs::read_dir(&depot).map_err(|cause| format!("{} illisible : {cause}", depot.display()))?;
    let mut nommes: Vec<String> = entrees
        .filter_map(|entree| entree.ok())
        .filter_map(|entree| entree.file_name().into_string().ok())
        .collect();
    nommes.sort();
    let mut attendus = GENERES.map(str::to_string).to_vec();
    attendus.sort();
    if nommes != attendus {
        return Err(format!(
            "packages/shared/generated porte {:?} — attendu {:?} (relancer `cargo xtask contracts export`)",
            nommes, attendus
        ));
    }
    let passe = temporaire("contracts-check-depot")?;
    let identique = (|| -> Result<(), String> {
        exporter(root, &passe)?;
        compares(&passe, &depot, "export frais", "dépôt")
    })();
    let _ = fs::remove_dir_all(&passe);
    identique?;

    // 3. Le corpus, validé par les validateurs générés (dépôt actif).
    let corpus = root.join("compatibility/contracts/corpus.json");
    lance_bun(root, "scripts/contracts-corpus.ts", &[&depot, &corpus])?;
    Ok(())
}
