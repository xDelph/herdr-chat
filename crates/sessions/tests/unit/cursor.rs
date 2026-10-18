//! Les curseurs opaques (T024/C12) : aller-retours, legacy, A ne lit jamais
//! B, exclusivité, versions inconnues.

use base64::Engine;
use sessions::cursor::{Curseur, ErreurCurseur, decode, encode, valide_paire};

#[test]
fn l_aller_retour_versionné_est_fidèle() {
    let encode = encode("empreinte-source-1", "burly-stop", 3, 42);
    assert!(encode.starts_with("hc2:"), "opaque et préfixé : {encode}");
    match decode(&encode) {
        Ok(Curseur::Versionne {
            empreinte_source,
            session,
            generation,
            position,
        }) => {
            assert!(empreinte_source == "empreinte-source-1");
            assert!(session == "burly-stop");
            assert!(
                generation == 3 && position == 42,
                "tout est porté : gen {generation} pos {position}"
            );
        }
        autre => panic!("l'aller-retour doit être fidèle : {autre:?}"),
    }
}

#[test]
fn le_legacy_fichier_se_lit_et_se_recolle_à_sa_source() {
    // Le byte-exact du fil : base64(JSON {"dev","ino","offset"}) — l'ordre
    // des champs du fil n'importe pas au décodage.
    let legacy = base64::engine::general_purpose::STANDARD
        .encode("{\"dev\": 5, \"ino\": 7, \"offset\": 100}");
    match decode(&legacy) {
        Ok(Curseur::LegacyFichier { dev, ino, offset }) => {
            assert!(
                dev == 5 && ino == 7 && offset == 100,
                "les trois champs : {dev}/{ino}/{offset}"
            );
            // Le reset LEGACY : il se recolle à la source de la requête qui
            // le porte — sans identité propre, il ne s'attache qu'à elle.
            match decode(&legacy)
                .unwrap_or_else(|cause| panic!("déjà décodé : {cause}"))
                .lie_a("empreinte-x", "sess-1")
            {
                Ok(lie) => {
                    assert!(
                        lie.empreinte_source == "empreinte-x"
                            && lie.session == "sess-1"
                            && lie.position == 100
                    );
                }
                Err(cause) => panic!("le legacy se recolle à la source : {cause}"),
            }
        }
        autre => panic!("le legacy fichier doit se lire : {autre:?}"),
    }
    // Le curseur SQLite legacy du fil : {dev:0, ino:0, offset:seq} — même
    // forme, même recollement (le reset legacy SQLite).
    let legacy_sqlite =
        base64::engine::general_purpose::STANDARD.encode("{\"dev\":0,\"ino\":0,\"offset\":7}");
    match decode(&legacy_sqlite) {
        Ok(Curseur::LegacyFichier { dev, ino, offset }) => {
            assert!(
                dev == 0 && ino == 0 && offset == 7,
                "le seq passe en offset : {dev}/{ino}/{offset}"
            );
        }
        autre => panic!("le legacy SQLite doit se lire : {autre:?}"),
    }
}

#[test]
fn le_curseur_d_a_ne_lit_jamais_b() {
    let encode = encode("source-a", "sess-a", 1, 10);
    match decode(&encode)
        .unwrap_or_else(|cause| panic!("déjà vert : {cause}"))
        .lie_a("source-a", "sess-b")
    {
        Err(ErreurCurseur::SessionEtrangere) => (),
        Ok(lie) => panic!("le curseur de A a lu B : {lie:?}"),
        Err(cause) => panic!("une erreur inattendue : {cause}"),
    }
    match decode(&encode)
        .unwrap_or_else(|cause| panic!("déjà vert : {cause}"))
        .lie_a("source-b", "sess-a")
    {
        Err(ErreurCurseur::SessionEtrangere) => (),
        Ok(lie) => panic!("la source de B a lu le curseur de A : {lie:?}"),
        Err(cause) => panic!("une erreur inattendue : {cause}"),
    }
    // La même source, la même session : passe.
    match decode(&encode)
        .unwrap_or_else(|cause| panic!("déjà vert : {cause}"))
        .lie_a("source-a", "sess-a")
    {
        Ok(lie) => assert!(lie.position == 10),
        Err(cause) => panic!("le bon appariement passe : {cause}"),
    }
}

#[test]
fn les_illisibilités_sont_nommées() {
    // Version inconnue (hc3) : refusée — jamais devinée.
    let futur = encode("s", "s", 1, 1).replacen("hc2:", "hc3:", 1);
    assert!(decode(&futur) == Err(ErreurCurseur::Illisible));
    // Du base64 de non-JSON.
    assert!(
        decode(&base64::engine::general_purpose::STANDARD.encode("pas du json"))
            == Err(ErreurCurseur::Illisible)
    );
    // Pas du base64 du tout.
    assert!(decode("ceci n'est pas un curseur") == Err(ErreurCurseur::Illisible));
    // Un offset négatif (légal en JSON, illégal au fil).
    let négatif =
        base64::engine::general_purpose::STANDARD.encode("{\"dev\":1,\"ino\":1,\"offset\":-2}");
    assert!(
        decode(&négatif) == Err(ErreurCurseur::Illisible),
        "un offset négatif est un casque"
    );
    // Un nombre non entier pour l'offset.
    let flottant =
        base64::engine::general_purpose::STANDARD.encode("{\"dev\":1,\"ino\":1,\"offset\":2.5}");
    assert!(decode(&flottant) == Err(ErreurCurseur::Illisible));
}

#[test]
fn cursor_et_before_sont_exclusifs() {
    assert!(valide_paire(Some("hc2:x"), None).is_ok());
    assert!(valide_paire(None, Some("hc2:x")).is_ok());
    assert!(valide_paire(None, None).is_ok());
    assert!(
        valide_paire(Some("hc2:x"), Some("hc2:y")) == Err(ErreurCurseur::Exclusifs),
        "fournir les deux n'est pas une lecture définissable"
    );
}

#[test]
fn la_cartographie_des_erreurs_est_celle_de_h04() {
    assert!(ErreurCurseur::Illisible.statut() == 400, "illisible = 400");
    assert!(ErreurCurseur::Exclusifs.statut() == 400, "exclusifs = 400");
    assert!(
        ErreurCurseur::SessionEtrangere.statut() == 400,
        "étranger = 400 (le curseur d'A ne lit jamais B)"
    );
    assert!(ErreurCurseur::Perime.statut() == 409, "périmé = 409");
}
