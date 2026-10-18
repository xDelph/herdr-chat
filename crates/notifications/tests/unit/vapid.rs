//! Les clés VAPID (T044, E08) : la forme des clés Node, l'équivalence
//! vérifiée, la génération cohérente.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use notifications::store::ClefsVapid;
use notifications::vapid::genere_clefs_vapid;

#[test]
fn la_generation_produit_la_forme_des_cles_node() {
    // TECH §7 : la forme exacte des clés Node — publique = point P-256 non
    // compressé (65 octets), privée = scalaire (32 octets), base64url sans
    // padding.
    let clefs = genere_clefs_vapid();
    let publique = URL_SAFE_NO_PAD
        .decode(&clefs.public_key)
        .unwrap_or_else(|_| panic!("publique décodable"));
    let privee = URL_SAFE_NO_PAD
        .decode(&clefs.private_key)
        .unwrap_or_else(|_| panic!("privée décodable"));
    assert_eq!(publique.len(), 65, "point non compressé");
    assert_eq!(publique[0], 0x04, "forme non compressée");
    assert_eq!(privee.len(), 32, "scalaire");
    // Pas de padding : la forme URL-safe sans `=`.
    assert!(!clefs.public_key.contains('='));
    assert!(!clefs.private_key.contains('='));
}

#[test]
fn la_paire_generee_est_coherente() {
    let clefs = genere_clefs_vapid();
    clefs
        .verifie_equivalence()
        .unwrap_or_else(|_| panic!("la paire générée est cohérente"));
}

#[test]
fn deux_generations_donnent_deux_paires() {
    let premiere = genere_clefs_vapid();
    let seconde = genere_clefs_vapid();
    assert_ne!(premiere.private_key, seconde.private_key);
    assert_ne!(premiere.public_key, seconde.public_key);
}

#[test]
fn une_paire_importee_valide_passe_l_equivalence() {
    // TECH §7 : une paire Node existante (ici générée dans la même forme)
    // est acceptée — c'est la preuve que le format d'import est le bon.
    let clefs = genere_clefs_vapid();
    let importee = ClefsVapid::depuis_env(
        Some(clefs.public_key.clone()),
        Some(clefs.private_key.clone()),
    )
    .unwrap_or_else(|_| panic!("paire valide acceptée"));
    assert_eq!(importee.as_ref(), Some(&clefs));
}
