//! La version du produit est UNE : `--version` du binaire, le workspace
//! Cargo et `package.json` disent la même chose.
//!
//! ⚠️ Mesuré avant correction : le binaire disait `0.0.0` (workspace jamais
//! renseigné) quand `package.json` disait `0.1.8`. La ligne Rust est une
//! nouvelle version majeure du produit : `0.2.0`.

use std::path::PathBuf;

fn version_de_package_json() -> String {
    let chemin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../package.json");
    let texte = std::fs::read_to_string(&chemin)
        .unwrap_or_else(|cause| panic!("package.json illisible : {cause}"));
    let valeur: serde_json::Value =
        serde_json::from_str(&texte).unwrap_or_else(|cause| panic!("package.json : {cause}"));
    valeur["version"]
        .as_str()
        .unwrap_or_else(|| panic!("package.json sans version"))
        .to_string()
}

#[test]
fn le_binaire_le_workspace_et_package_json_ont_la_meme_version() {
    let sortie = std::process::Command::new(env!("CARGO_BIN_EXE_herdrchat"))
        .arg("--version")
        .output()
        .unwrap_or_else(|cause| panic!("binaire non lancé : {cause}"));
    assert!(sortie.status.success(), "--version doit réussir");
    let texte = String::from_utf8_lossy(&sortie.stdout).trim().to_string();
    let attendue = version_de_package_json();
    assert_eq!(texte, format!("herdrchat {attendue}"));
    assert_eq!(
        env!("CARGO_PKG_VERSION"),
        attendue,
        "workspace = package.json"
    );
    assert_ne!(
        attendue, "0.0.0",
        "une version jamais renseignée n'est pas une version"
    );
}
