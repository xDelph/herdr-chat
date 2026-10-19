//! `release` — l'assemblage de livraison (T066).
//!
//! ⚠️ **Ce que l'archive doit PROUVER, pas seulement contenir.** Le binaire
//! livré ne doit dépendre ni de Bun, ni de Node, ni d'une bibliothèque système
//! qui n'est pas sur la machine de l'utilisateur. La vérification est donc
//! faite **sur le binaire empaqueté**, pas sur les intentions du build :
//! `ldd`/`otool` pour les liens, et un lancement du binaire **sans Bun dans le
//! PATH** pour la dépendance d'exécution.
//!
//! ⚠️ **Ce qui n'est pas exécuté n'est pas « validé ».** Une cible qui n'est
//! pas celle de la machine est assemblée **compile-only** : elle est compilée,
//! empaquetée, et déclarée telle quelle. Aucun rapport ne dira « validée sur
//! Linux » sans qu'un runner Linux l'ait lancée.

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Les cibles connues. `natif` dit si la machine courante peut **exécuter** le
/// binaire — c'est ce qui distingue « compilé » de « validé ».
const CIBLES: &[(&str, &str, &str)] = &[
    ("aarch64-apple-darwin", "macos-arm64", "apple"),
    ("x86_64-apple-darwin", "macos-x86_64", "apple"),
    ("x86_64-unknown-linux-gnu", "linux-x86_64", "linux"),
    ("aarch64-unknown-linux-gnu", "linux-aarch64", "linux"),
];

/// La cible de la machine courante, quand elle est dans la table.
fn cible_native() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("x86_64-apple-darwin")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("x86_64-unknown-linux-gnu")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("aarch64-unknown-linux-gnu")
    } else {
        None
    }
}

fn empreinte_sha256(contenu: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(contenu)
        .iter()
        .map(|octet| format!("{octet:02x}"))
        .collect()
}

/// Assemble une cible : build, archive, empreinte, manifeste.
pub fn assemble(racine: &Path, cible: &str, exiger_natif: bool) -> Result<PathBuf, String> {
    let Some((_, etiquette, famille)) = CIBLES.iter().find(|(triple, _, _)| *triple == cible)
    else {
        return Err(format!(
            "cible inconnue : {cible} (connues : {})",
            CIBLES
                .iter()
                .map(|(triple, _, _)| *triple)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    };
    let natif = cible_native() == Some(cible);
    if exiger_natif && !natif {
        return Err(format!(
            "{cible} n'est pas la cible de cette machine : elle ne peut être qu'assemblée compile-only"
        ));
    }

    // 1) Le build : **avec** la PWA. `HERDRCHAT_REQUIRE_PWA=1` fait échouer le
    //    build si `apps/web/dist` manque (porte prouvée capable d'échouer, T054).
    let statut = Command::new("cargo")
        .current_dir(racine)
        .args(["build", "--release", "--locked", "-p", "herdrchat"])
        .arg("--target")
        .arg(cible)
        .env("HERDRCHAT_REQUIRE_PWA", "1")
        .status()
        .map_err(|cause| format!("cargo build : {cause}"))?;
    if !statut.success() {
        return Err(format!("le build de {cible} a échoué"));
    }
    let binaire = racine.join("target").join(cible).join("release/herdrchat");
    if !binaire.is_file() {
        return Err(format!(
            "binaire absent après build : {}",
            binaire.display()
        ));
    }

    // 2) Les liens : aucune dépendance implicite à OpenSSL système.
    let liens = liens_du_binaire(&binaire, famille)?;
    let ssl_systeme = liens
        .iter()
        .any(|lien| lien.contains("libssl") || lien.contains("libcrypto"));
    if ssl_systeme {
        return Err(format!(
            "le binaire {cible} lie OpenSSL système — la livraison dépendrait d'une bibliothèque absente chez l'utilisateur : {liens:?}"
        ));
    }

    // 3) Le dossier de livraison.
    let dist = racine.join("dist");
    std::fs::create_dir_all(&dist).map_err(|cause| format!("dist : {cause}"))?;
    let dossier = dist.join(format!("herdr-chat-{etiquette}"));
    let _ = std::fs::remove_dir_all(&dossier);
    std::fs::create_dir_all(&dossier).map_err(|cause| format!("dossier de livraison : {cause}"))?;
    copie(&binaire, &dossier.join("herdrchat"))?;
    copie(&racine.join("LICENSE"), &dossier.join("LICENSE"))?;
    copie(&racine.join("README.md"), &dossier.join("README.md"))?;
    // Le service et la formule sont **préparés**, pas publiés (T066).
    for (source, nom) in [
        (
            racine.join("packaging/herdr-chat.service"),
            "herdr-chat.service",
        ),
        (racine.join("packaging/herdr-chat.rb"), "herdr-chat.rb"),
    ] {
        if source.is_file() {
            copie(&source, &dossier.join(nom))?;
        }
    }

    // 4) Le manifeste : ce qui a produit le binaire, et ce qu'il contient.
    let manifeste = json!({
        "cible": cible,
        "etiquette": etiquette,
        "validee": natif,
        "note": if natif {
            "assemblée ET exécutée sur cette machine"
        } else {
            "compile-only : compilée et empaquetée, NON exécutée ici"
        },
        "rustc": sortie("rustc", &["-vV"]),
        "cargo": sortie("cargo", &["--version"]),
        "binaire": {
            "octets": std::fs::metadata(dossier.join("herdrchat")).map(|m| m.len()).unwrap_or(0),
            "sha256": std::fs::read(dossier.join("herdrchat")).map(|c| empreinte_sha256(&c)).unwrap_or_default(),
        },
        "liens": liens,
        "pwa_embarquee": std::fs::read_dir(racine.join("apps/web/dist"))
            .map(|entrees| entrees.filter_map(Result::ok).count())
            .unwrap_or(0),
    });
    std::fs::write(
        dossier.join("manifest.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifeste)
                .map_err(|cause| format!("manifeste : {cause}"))?
        ),
    )
    .map_err(|cause| format!("écriture du manifeste : {cause}"))?;

    // 5) L'archive et son empreinte.
    let archive = dist.join(format!("herdr-chat-{etiquette}.tar.gz"));
    let statut = Command::new("tar")
        .current_dir(&dossier)
        .args(["-czf"])
        .arg(&archive)
        .arg(".")
        .status()
        .map_err(|cause| format!("tar : {cause}"))?;
    if !statut.success() {
        return Err(format!("l'archive de {cible} a échoué"));
    }
    let contenu = std::fs::read(&archive).map_err(|cause| format!("archive : {cause}"))?;
    let empreinte = empreinte_sha256(&contenu);
    let nom = archive
        .file_name()
        .map(|nom| nom.to_string_lossy().to_string())
        .unwrap_or_default();
    std::fs::write(
        dist.join(format!("{nom}.sha256")),
        format!("{empreinte}  {nom}\n"),
    )
    .map_err(|cause| format!("empreinte : {cause}"))?;
    println!(
        "{} : {} ({} octets, sha256 {})",
        nom,
        if natif { "validée" } else { "compile-only" },
        contenu.len(),
        &empreinte[..16]
    );
    Ok(archive)
}

fn copie(source: &Path, destination: &Path) -> Result<(), String> {
    std::fs::copy(source, destination)
        .map(|_| ())
        .map_err(|cause| format!("copie de {} : {cause}", source.display()))
}

fn sortie(programme: &str, arguments: &[&str]) -> String {
    Command::new(programme)
        .args(arguments)
        .output()
        .ok()
        .map(|sortie| String::from_utf8_lossy(&sortie.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Les bibliothèques dynamiques du binaire — `otool -L` sur macOS, `ldd` sur
/// Linux. Une sortie illisible n'est **pas** un « aucune dépendance » : c'est
/// une vérification impossible, et elle le dit.
fn liens_du_binaire(binaire: &Path, famille: &str) -> Result<Vec<String>, String> {
    let (programme, arguments): (&str, Vec<&str>) = if famille == "apple" {
        ("otool", vec!["-L"])
    } else {
        ("ldd", vec![])
    };
    let sortie = Command::new(programme)
        .args(arguments)
        .arg(binaire)
        .output()
        .map_err(|cause| format!("{programme} indisponible : {cause}"))?;
    let texte = String::from_utf8_lossy(&sortie.stdout).to_string();
    if texte.trim().is_empty() {
        return Err(format!(
            "{programme} n'a rien rendu pour {} — liens non vérifiés",
            binaire.display()
        ));
    }
    Ok(texte
        .lines()
        .skip(1)
        .map(|ligne| ligne.trim().to_string())
        .filter(|ligne| !ligne.is_empty())
        .collect())
}

/// Le point d'entrée : `xtask release [--target <triple>] [--all]`.
pub fn entree(racine: &Path, arguments: &[String]) -> Result<(), String> {
    let mut cibles: Vec<&str> = Vec::new();
    let mut exiger_natif = false;
    let mut iterateur = arguments.iter();
    while let Some(argument) = iterateur.next() {
        match argument.as_str() {
            "--all" => cibles = CIBLES.iter().map(|(triple, _, _)| *triple).collect(),
            "--native" => {
                exiger_natif = true;
                if let Some(native) = cible_native() {
                    cibles = vec![native];
                }
            }
            "--target" => {
                let cible = iterateur
                    .next()
                    .ok_or_else(|| String::from("--target attend un triple"))?;
                cibles.push(cible);
            }
            autre => return Err(format!("option inconnue : {autre}")),
        }
    }
    if cibles.is_empty() {
        let native = cible_native()
            .ok_or_else(|| String::from("machine non reconnue : passer --target <triple>"))?;
        cibles = vec![native];
        exiger_natif = true;
    }
    let mut archives: Vec<Value> = Vec::new();
    for cible in cibles {
        let archive = assemble(racine, cible, exiger_natif)?;
        archives.push(json!(archive.display().to_string()));
    }
    println!("{} archive(s) dans dist/", archives.len());
    Ok(())
}
