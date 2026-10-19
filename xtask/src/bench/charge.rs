//! La **charge** : des clients qui demandent les routes de lecture, et qui
//! mesurent ce qu'ils obtiennent (T065).
//!
//! ⚠️ **Pas de bibliothèque HTTP.** Un client `GET` sur une connexion, réponse
//! lue jusqu'à la fermeture : c'est ce que fait le navigateur d'un onglet qui
//! rafraîchit, et ça évite d'ajouter une dépendance à un banc d'essai qui doit
//! mesurer le serveur, pas le client.
//!
//! ⚠️ **Chaque client est un fil** : la latence mesurée est celle d'un client
//! qui attend, pas d'un client qui partage un ordonnanceur avec les autres.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// Une demande mesurée.
#[derive(Clone, Debug)]
pub struct Reponse {
    /// La route demandée — une latence agrégée sur deux routes ne dit pas
    /// laquelle coûte (une page lourde et une page légère s'y moyennent).
    pub route: String,
    pub statut: u16,
    pub octets: usize,
    /// Microsecondes — la précision de la milliseconde serait plus grossière
    /// que les écarts qu'on cherche.
    pub micros: u128,
}

/// Les routes lues par un client, en cycle — l'ordre d'un onglet qui
/// rafraîchit : l'aperçu global, puis la liste, puis la session d'un pane.
#[derive(Clone, Debug)]
pub struct PlanDeCharge {
    pub racine: String,
    pub routes: Vec<String>,
    pub duree: Duration,
}

/// Le résultat d'un client.
pub struct Mesure {
    pub reponses: Vec<Reponse>,
}

/// Lance `clients` fils pour `plan.duree`, et rend leurs mesures.
pub fn lance(plan: &PlanDeCharge, clients: usize) -> Vec<Mesure> {
    let arret = Arc::new(AtomicBool::new(false));
    let mut fils = Vec::new();
    for _ in 0..clients {
        let plan = plan.clone();
        let arret_fils = Arc::clone(&arret);
        fils.push(thread::spawn(move || {
            let mut mesures: Vec<Reponse> = Vec::new();
            let debut = Instant::now();
            let mut indice = 0_usize;
            while debut.elapsed() < plan.duree && !arret_fils.load(Ordering::SeqCst) {
                let route = &plan.routes[indice % plan.routes.len()];
                indice += 1;
                match demande(&plan.racine, route) {
                    Ok(reponse) => mesures.push(reponse),
                    Err(_) => arret_fils.store(true, Ordering::SeqCst),
                }
            }
            Mesure { reponses: mesures }
        }));
    }
    fils.into_iter().filter_map(|fil| fil.join().ok()).collect()
}

/// Un `GET` sur une connexion neuve.
fn demande(racine: &str, route: &str) -> Result<Reponse, String> {
    let debut = Instant::now();
    let mut flux =
        TcpStream::connect(racine).map_err(|cause| format!("connexion à {racine} : {cause}"))?;
    let _ = flux.set_read_timeout(Some(Duration::from_secs(30)));
    // ⚠️ L'hôte est le loopback RÉEL : la garde d'origine refuse un
    // hôte inconnu (403), et un banc qui mesure des 403 ne mesure rien.
    let requete = format!("GET {route} HTTP/1.1\r\nHost: {racine}\r\nConnection: close\r\n\r\n");
    flux.write_all(requete.as_bytes())
        .map_err(|cause| format!("écriture : {cause}"))?;
    let mut tampon = Vec::new();
    flux.read_to_end(&mut tampon)
        .map_err(|cause| format!("lecture : {cause}"))?;
    let micros = debut.elapsed().as_micros();
    let entete_fin = trouve(&tampon, b"\r\n\r\n").map_or(tampon.len(), |fin| fin + 4);
    let entete = String::from_utf8_lossy(&tampon[..entete_fin.min(tampon.len())]).to_string();
    let statut = entete
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .unwrap_or(0);
    Ok(Reponse {
        route: route.to_string(),
        statut,
        octets: tampon.len(),
        micros,
    })
}

fn trouve(graine: &[u8], motif: &[u8]) -> Option<usize> {
    graine
        .windows(motif.len())
        .position(|fenetre| fenetre == motif)
}
