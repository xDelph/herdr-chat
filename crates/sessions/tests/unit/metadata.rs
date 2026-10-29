//! La conversion de date des sessions (`iso_vers_ms`) — le reste de
//! l'ancien réducteur de métadonnées, retiré faute d'appelant (P3).

use sessions::metadata::iso_vers_ms;

#[test]
fn iso_vers_ms_repare_le_défaut_number() {
    // Le défaut mesuré : Number("2026-10-09T15:08:21.784Z") = NaN — le
    // parser propre rend les ms exactes.
    let ms = iso_vers_ms("2026-10-09T15:08:21.784Z").unwrap_or_default();
    let aller_retour = sessions::families::codecs::opencode::horodatage_iso(ms).unwrap_or_default();
    assert!(
        aller_retour == "2026-10-09T15:08:21.784Z",
        "aller-retour ISO : {aller_retour}"
    );
    // Sans millisecondes.
    assert!(iso_vers_ms("2026-10-09T15:08:21Z").is_some());
    // Du bruit : rien.
    assert!(iso_vers_ms("pas une date").is_none());
    assert!(
        iso_vers_ms("2026-13-45T99:99:99Z").is_some(),
        "le parseur civil accepte les nombres — la borne reste au fil"
    );
}
