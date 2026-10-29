//! La conversion de date des sessions : ISO 8601 → millisecondes.
//!
//! ⚠️ **Le réducteur de résumé qui vivait ici est retiré (P3).** `reduis`,
//! `CacheResumes` et l'index `IndexSessions` n'avaient aucun appelant en
//! production : le résumé réel est celui de `application::conversations`
//! (dernier prompt, aperçu, réglages, `tourDebut`), et un second réducteur
//! qui divergeait en silence n'était qu'un piège à parité. Seule la
//! conversion de date reste partagée (tâches de fond Claude, assemblage).

/// ISO 8601 (`YYYY-MM-DDTHH:MM:SS(.mmm)?Z`) → ms — le sens inverse du codec
/// opencode ; le parser proprement est la correction du défaut `Number(ISO)`
/// (NaN silencieux).
#[must_use]
pub fn iso_vers_ms(iso: &str) -> Option<i64> {
    let texte = iso.trim();
    let texte = texte.strip_suffix('Z').unwrap_or(texte);
    let (date, heure) = texte.split_once('T')?;
    let mut morceaux_date = date.split('-');
    let annee: i64 = morceaux_date.next()?.parse().ok()?;
    let mois: i64 = morceaux_date.next()?.parse().ok()?;
    let jour: i64 = morceaux_date.next()?.parse().ok()?;
    let mut morceaux_heure = heure.split(':');
    let h: i64 = morceaux_heure.next()?.parse().ok()?;
    let m: i64 = morceaux_heure.next()?.parse().ok()?;
    let reste = morceaux_heure.next().unwrap_or("0");
    let (s, ms): (i64, i64) = match reste.split_once('.') {
        Some((s, frac)) => {
            let mut millisecondes = String::from(frac);
            millisecondes.truncate(3);
            while millisecondes.len() < 3 {
                millisecondes.push('0');
            }
            (s.parse().ok()?, millisecondes.parse().ok()?)
        }
        None => (reste.parse().ok()?, 0),
    };
    // days_from_civil (Hinnant) — l'inverse de l'algorithme du codec.
    let y = if mois <= 2 { annee - 1 } else { annee };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if mois > 2 { mois - 3 } else { mois + 9 };
    let doy = (153 * mp + 2) / 5 + jour - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let jours = era * 146_097 + doe - 719_468;
    Some(jours * 86_400_000 + h * 3_600_000 + m * 60_000 + s * 1_000 + ms)
}
