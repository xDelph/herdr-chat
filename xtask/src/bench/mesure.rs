//! Les **mesures** : centiles de latence et empreinte du processus (T065).
//!
//! ⚠️ **Ce qui est mesuré, et ce qui ne l'est pas.** On mesure la latence
//! vue par le client (ouverture de connexion comprise), les octets reçus, le
//! RSS maximum et le temps CPU consommé par le processus du serveur. On ne
//! mesure **pas** la consommation du navigateur, ni celle de `tailscale serve` :
//! elles sont hors du périmètre comparé, et les mélanger rendrait la
//! comparaison ininterprétable.
//!
//! ⚠️ **Le RSS est un maximum observé, pas une moyenne** : un pic manqué par
//! l'échantillonneur est un pic qu'on n'a pas vu — c'est écrit dans le rapport
//! plutôt que masqué par une moyenne rassurante.

use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

/// Les centiles d'une série, en microsecondes.
#[derive(Clone, Copy, Debug)]
pub struct Centiles {
    pub n: usize,
    pub p50: u128,
    pub p95: u128,
    pub p99: u128,
    pub max: u128,
}

/// Calcule les centiles — série vide : tout à zéro, jamais une division nulle.
#[must_use]
pub fn centiles(mut valeurs: Vec<u128>) -> Centiles {
    if valeurs.is_empty() {
        return Centiles {
            n: 0,
            p50: 0,
            p95: 0,
            p99: 0,
            max: 0,
        };
    }
    valeurs.sort_unstable();
    let rang = |pourcentage: usize| -> u128 {
        // Le centile par rang le plus proche : pour 4 valeurs, p95 = la 4ᵉ.
        let indice = (valeurs.len() * pourcentage)
            .div_ceil(100)
            .saturating_sub(1);
        valeurs[indice.min(valeurs.len() - 1)]
    };
    Centiles {
        n: valeurs.len(),
        p50: rang(50),
        p95: rang(95),
        p99: rang(99),
        max: *valeurs.last().unwrap_or(&0),
    }
}

/// L'empreinte du processus, échantillonnée pendant la charge.
#[derive(Clone, Copy, Debug, Default)]
pub struct Empreinte {
    /// Le RSS le plus haut observé (Kio).
    pub rss_max_kio: u64,
    /// Le CPU consommé, en millisecondes (delta entre le début et la fin).
    pub cpu_ms: u64,
    pub echantillons: usize,
}

/// Échantillonne `pid` toutes les 200 ms jusqu'à l'arrêt.
pub struct Echantillonneur {
    arret: std::sync::Arc<std::sync::atomic::AtomicBool>,
    fil: Option<thread::JoinHandle<Empreinte>>,
}

impl Echantillonneur {
    #[must_use]
    pub fn demarre(pid: u32) -> Self {
        let arret = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let arret_fils = std::sync::Arc::clone(&arret);
        let fil = thread::spawn(move || {
            let mut rss_max_kio = 0_u64;
            let mut echantillons = 0_usize;
            let debut_cpu = cpu_ms(pid).unwrap_or(0);
            while !arret_fils.load(std::sync::atomic::Ordering::SeqCst) {
                if let Some(rss) = rss_kio(pid) {
                    rss_max_kio = rss_max_kio.max(rss);
                    echantillons += 1;
                }
                thread::sleep(Duration::from_millis(200));
            }
            let fin_cpu = cpu_ms(pid).unwrap_or(debut_cpu);
            Empreinte {
                rss_max_kio,
                cpu_ms: fin_cpu.saturating_sub(debut_cpu),
                echantillons,
            }
        });
        let _ = pid;
        Self {
            arret,
            fil: Some(fil),
        }
    }

    #[must_use]
    pub fn termine(mut self) -> Empreinte {
        self.arret.store(true, std::sync::atomic::Ordering::SeqCst);
        match self.fil.take() {
            Some(fil) => fil.join().unwrap_or_default(),
            None => Empreinte::default(),
        }
    }
}

impl Drop for Echantillonneur {
    fn drop(&mut self) {
        self.arret.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Le RSS du processus, en Kio — `None` si `ps` ne le connaît pas (processus
/// déjà terminé) : une absence, jamais un zéro présenté comme une mesure.
fn rss_kio(pid: u32) -> Option<u64> {
    let sortie = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    String::from_utf8_lossy(&sortie.stdout)
        .trim()
        .parse::<u64>()
        .ok()
}

/// Le temps CPU cumulé du processus, en millisecondes (`ps -o time=`).
fn cpu_ms(pid: u32) -> Option<u64> {
    let sortie = Command::new("ps")
        .args(["-o", "time=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let texte = String::from_utf8_lossy(&sortie.stdout).trim().to_string();
    // Formes rendues : `MM:SS.ss`, `HH:MM:SS`, `D-HH:MM:SS`.
    let (jours, reste) = match texte.split_once('-') {
        Some((jours, reste)) => (jours.parse::<u64>().unwrap_or(0), reste.to_string()),
        None => (0, texte),
    };
    let morceaux: Vec<&str> = reste.split(':').collect();
    let secondes = match morceaux.as_slice() {
        [minutes, secondes] => {
            minutes.parse::<f64>().unwrap_or(0.0) * 60.0 + secondes.parse::<f64>().unwrap_or(0.0)
        }
        [heures, minutes, secondes] => {
            heures.parse::<f64>().unwrap_or(0.0) * 3600.0
                + minutes.parse::<f64>().unwrap_or(0.0) * 60.0
                + secondes.parse::<f64>().unwrap_or(0.0)
        }
        _ => 0.0,
    };
    Some(((jours as f64 * 86_400.0 + secondes) * 1000.0) as u64)
}

/// Le corps d'une réponse — la **sonde** du banc : quand une pile rend des
/// erreurs, le rapport doit dire lesquelles, pas seulement compter les non-200.
pub fn sonde(racine: &str, route: &str) -> Result<(u16, String), String> {
    use std::io::{Read, Write};
    let mut flux = std::net::TcpStream::connect(racine).map_err(|cause| cause.to_string())?;
    let _ = flux.set_read_timeout(Some(Duration::from_secs(30)));
    let requete = format!("GET {route} HTTP/1.1\r\nHost: {racine}\r\nConnection: close\r\n\r\n");
    flux.write_all(requete.as_bytes())
        .map_err(|cause| cause.to_string())?;
    let mut tampon = Vec::new();
    flux.read_to_end(&mut tampon)
        .map_err(|cause| cause.to_string())?;
    let texte = String::from_utf8_lossy(&tampon).to_string();
    let corps = match texte.find("\r\n\r\n") {
        Some(fin) => texte[fin + 4..].to_string(),
        None => texte.clone(),
    };
    let statut = texte
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    Ok((statut, corps.chars().take(3000).collect()))
}

/// Attend qu'une route réponde 200, ou rend le dernier échec — jamais une
/// attente silencieuse infinie.
pub fn attend_pret(racine: &str, route: &str, delai: Duration) -> Result<Duration, String> {
    let debut = Instant::now();
    let mut dernier = String::from("aucune tentative");
    while debut.elapsed() < delai {
        match demande_statut(racine, route) {
            Ok(200) => return Ok(debut.elapsed()),
            Ok(autre) => dernier = format!("statut {autre}"),
            Err(cause) => dernier = cause,
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!("pas prêt après {delai:?} : {dernier}"))
}

fn demande_statut(racine: &str, route: &str) -> Result<u16, String> {
    use std::io::{Read, Write};
    let mut flux = std::net::TcpStream::connect(racine).map_err(|cause| cause.to_string())?;
    let _ = flux.set_read_timeout(Some(Duration::from_secs(5)));
    // ⚠️ L'hôte est le loopback RÉEL : la garde d'origine refuse un
    // hôte inconnu (403), et un banc qui mesure des 403 ne mesure rien.
    let requete = format!("GET {route} HTTP/1.1\r\nHost: {racine}\r\nConnection: close\r\n\r\n");
    flux.write_all(requete.as_bytes())
        .map_err(|cause| cause.to_string())?;
    let mut tampon = Vec::new();
    flux.read_to_end(&mut tampon)
        .map_err(|cause| cause.to_string())?;
    let entete = String::from_utf8_lossy(&tampon[..tampon.len().min(64)]).to_string();
    Ok(entete
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0))
}
