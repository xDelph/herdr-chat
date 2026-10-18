//! Observations, générations, corrélation cwd à trois états.

use domain::ids::PaneId;
use domain::observation::{
    CwdMatch, Generation, Millis, Observation, Snapshot, SnapshotProvenance, UpstreamPing,
};

#[test]
fn une_correlation_dossier_dit_matched_mismatched_ou_rien() {
    // Mesuré : la comparaison TS est `===`, aucune normalisation de barre
    // finale — reproduit tel quel.
    assert_eq!(
        CwdMatch::from_parts(Some("/work/x"), Some("/work/x")),
        CwdMatch::Matched
    );
    assert_eq!(
        CwdMatch::from_parts(Some("/work/x"), Some("/work/autre")),
        CwdMatch::Mismatched
    );
    // Barre finale : différent au caractère près — c'est un mismatch, pas
    // un match adouci.
    assert_eq!(
        CwdMatch::from_parts(Some("/work/x/"), Some("/work/x")),
        CwdMatch::Mismatched
    );
}

#[test]
fn manquant_d_un_cote_la_correlation_est_inverifiable_pas_fausse() {
    // `null` = non vérifiable, volontairement distinct de `false` (D03).
    assert_eq!(
        CwdMatch::from_parts(None, Some("/work/x")),
        CwdMatch::Unverifiable
    );
    assert_eq!(
        CwdMatch::from_parts(Some("/work/x"), None),
        CwdMatch::Unverifiable
    );
    assert_eq!(CwdMatch::from_parts(None, None), CwdMatch::Unverifiable);
}

#[test]
fn la_provision_fil_d_un_match_est_bool_ou_null_seulement() {
    // Les trois états s'écrivent `true | false | null` sur le fil — la
    // conversion vit dans contracts (T010) ; ici on prouve la base.
    assert_eq!(CwdMatch::Matched.as_bool(), Some(true));
    assert_eq!(CwdMatch::Mismatched.as_bool(), Some(false));
    assert_eq!(CwdMatch::Unverifiable.as_bool(), None);
}

#[test]
fn une_generation_recente_ne_recule_pas() {
    // TECH §4 : un rafraîchissement plus lent ne remplace pas une
    // observation plus récente ; l'ordre ici est sa fondation.
    let premiere = Generation(7);
    let recente = Generation(9);
    match recente.cmp(&premiere) {
        std::cmp::Ordering::Greater => (),
        autre => panic!("la génération n'a pas avancé : {autre:?}"),
    }
    assert_eq!(premiere.valeur(), 7_u64);
    assert_eq!(recente.valeur(), 9_u64);
}

#[test]
fn l_observation_porte_valeur_generation_estampille() {
    let rapport = Observation {
        value: "eclair".to_string(),
        generation: Generation(3),
        observed_at: Millis(1_760_000_000_000),
    };
    assert_eq!(rapport.generation.valeur(), 3_u64);
    assert_eq!(rapport.observed_at.0, 1_760_000_000_000_u64);
    assert_eq!(rapport.value, "eclair".to_string());
}

#[test]
fn une_provenance_absente_l_est_reellement() {
    // Snapshot sans provenance (partiel) : absence réelle, pas des zéros.
    let vide = Snapshot::default();
    match (vide.protocol(), vide.version()) {
        (None, None) => (),
        (prot, ver) => panic!("une photo vide affirmait une provenance : {prot:?} / {ver:?}"),
    }
}

#[test]
fn une_provenance_presente_porte_version_et_protocole() {
    // Payload ping strict : protocol conditionne tout le reste.
    let observee = Snapshot {
        provenance: Some(SnapshotProvenance {
            version: "0.9.3".to_string(),
            protocol: 22,
        }),
        ..Snapshot::default()
    };
    assert_eq!(observee.protocol(), Some(22_u64));
    assert_eq!(observee.version(), Some("0.9.3"));
}

#[test]
fn le_ping_amon_ne_dit_que_version_et_protocole() {
    // Le payload ping est strict : protocol + version, il n'y a rien d'autre
    // à prendre — le domaine ne devine rien de plus.
    let pose = UpstreamPing {
        protocol: 22,
        version: "0.9.3".to_string(),
    };
    assert_eq!(pose.protocol, 22_u64);
    assert_eq!(pose.version, "0.9.3".to_string());
    // Un identifiant de pane reste une identité de pane, déclarée elle-même.
    let pane = PaneId::from("wA:p7".to_string());
    assert_eq!(pane.as_str(), "wA:p7");
}
