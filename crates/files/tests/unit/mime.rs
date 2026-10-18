//! La politique MIME (T046, S07) : la liste blanche exacte du fil — un SVG
//! n'est JAMAIS inline, l'inconnu est téléchargé, jamais interprété.

use files::mime::{content_type_de, est_inline};
use std::path::Path;

fn chemin(nom: &str) -> &Path {
    Path::new(nom)
}

#[test]
fn les_images_et_le_pdf_sont_inline() {
    for (nom, type_) in [
        ("a.avif", "image/avif"),
        ("a.gif", "image/gif"),
        ("a.jpeg", "image/jpeg"),
        ("a.jpg", "image/jpeg"),
        ("a.png", "image/png"),
        ("a.webp", "image/webp"),
        ("a.pdf", "application/pdf"),
    ] {
        assert!(est_inline(chemin(nom)), "{nom} devrait être inline");
        assert_eq!(content_type_de(chemin(nom)), type_, "{nom} : type exact");
    }
}

#[test]
fn les_textes_sont_servis_en_texte_utf8() {
    for nom in [
        "a.txt", "a.log", "a.json", "a.jsonl", "a.md", "a.diff", "a.patch",
    ] {
        assert!(est_inline(chemin(nom)), "{nom} devrait être inline");
        assert_eq!(
            content_type_de(chemin(nom)),
            "text/plain; charset=utf-8",
            "{nom} : type exact"
        );
    }
}

#[test]
fn un_svg_n_est_jamais_inline() {
    // S07 : un SVG peut porter du script — téléchargé, jamais interprété.
    assert!(!est_inline(chemin("a.svg")));
    assert_eq!(content_type_de(chemin("a.svg")), "application/octet-stream");
}

#[test]
fn l_inconnu_est_telecharge_jamais_interprete() {
    for nom in [
        "a.bin", "a.exe", "a.html", "a.html", "a.js", "a.zip", "a", "a.tar.gz",
    ] {
        assert!(!est_inline(chemin(nom)), "{nom} ne devrait pas être inline");
        assert_eq!(
            content_type_de(chemin(nom)),
            "application/octet-stream",
            "{nom} : téléchargé"
        );
    }
}

#[test]
fn l_extension_est_insensible_a_la_casse() {
    assert_eq!(content_type_de(chemin("a.PNG")), "image/png");
    assert!(est_inline(chemin("a.JPG")));
    // Et la casse d'un SVG reste un SVG.
    assert!(!est_inline(chemin("a.SVG")));
}

#[test]
fn le_type_suit_l_extension_pas_le_contenu() {
    // Un .png qui contient du texte est servi en image/png — le type est
    // déclaré par l'extension, jamais deviné à la lecture.
    assert_eq!(content_type_de(chemin("trompeur.png")), "image/png");
}
