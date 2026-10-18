//! La garde des requêtes mutantes (T049, S02) : origine, Content-Type,
//! taille déclarée — **avant toute action** (CURRENT.md §2).
//!
//! ⚠️ Le service n'a aucune authentification applicative : il écoute sur le
//! loopback et Tailscale Serve l'expose au tailnet. Tout appareil du tailnet
//! peut appeler `/api/agents/:paneId/prompt` — c'est le modèle décidé — mais
//! cela rend le **CSRF** propriété du navigateur. Ce garde ne remplace pas
//! une authentification : il ferme ce qui peut l'être sans elle — une
//! requête cross-site n'envoie pas d'`Origin` utilisable pour
//! `application/json`, et un formulaire HTML ne peut pas produire un corps
//! JSON. Les deux sont vérifiés ici.

use contracts::limits::MAX_BODY_BYTES;

/// Les causes de refus — chacune avec son code HTTP propre.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RaisonGarde {
    OrigineAbsente,
    OrigineEtrangere,
    Methode,
    ContentType,
    CorpsTropGrand,
}

/// Un refus de garde — la cause, et pour l'origine les deux côtés.
#[derive(Clone, Debug)]
pub struct RefusGarde {
    pub raison: RaisonGarde,
    pub statut: u16,
    /// Les origines attendues (la configuration), pour un refus d'origine.
    pub attendue: Option<String>,
    /// L'origine reçue, pour un refus d'origine.
    pub recue: Option<String>,
}

/// Origine servie par la machine elle-même (loopback).
///
/// ⚠️ `localhost`, `[IP_ADDRESS]` et `[::1]` **tous ports confondus** : la
/// PWA est servie aussi bien par le backend que par le serveur de dev, et le
/// port change sans que la sécurité change. Une page servie par la machine ne
/// peut pas être un site tiers : l'accepter ne rouvre pas le CSRF, qui vient
/// précisément d'une origine **distante**.
/// L'après-schéma (`http://` / `https://`, casse libre), ou rien.
fn apres_schema(origine: &str) -> Option<&str> {
    const SCHEMAS: [&str; 2] = ["http://", "https://"];
    for schema in SCHEMAS {
        if origine.len() >= schema.len() && origine[..schema.len()].eq_ignore_ascii_case(schema) {
            return Some(&origine[schema.len()..]);
        }
    }
    None
}

#[must_use]
pub fn est_loopback(origine: &str) -> bool {
    let Some(hote) = hote_de(origine) else {
        return false;
    };
    hote == "localhost" || hote == "127.0.0.1" || hote == "::1"
}

/// L'hôte d'une origine, en minuscules, sans crochets — l'équivalent de
/// `new URL(origin).hostname.toLowerCase()` du fil. Une origine illisible
/// (pas de schéma, IPv6 brute) est `None` : écartée, pas devinée.
fn hote_de(origine: &str) -> Option<String> {
    // Le schéma est insensible à la casse (le fil s'en remet à `new URL`).
    let sans_schema = apres_schema(origine)?;
    let autorite = sans_schema.split('/').next()?;
    let hote = if let Some(apres) = autorite.strip_prefix('[') {
        let fin = apres.find(']')?;
        &apres[..fin]
    } else {
        match autorite.rfind(':') {
            Some(deux_points) => {
                let hote = &autorite[..deux_points];
                // Une adresse IPv6 BRUTE (sans crochets) est malformée.
                if hote.contains(':') {
                    return None;
                }
                hote
            }
            None => autorite,
        }
    };
    Some(hote.to_lowercase())
}

/// Origines autorisées : la liste exacte (config + Tailscale) **ou**
/// loopback. `https://macbook.ts.net.evil.com` ne doit pas passer pour
/// `https://macbook.ts.net` : pas de comparaison partielle, pas de motif.
#[must_use]
pub fn est_autorisee(origine: Option<&str>, attendues: &[String]) -> bool {
    match origine {
        Some(origine) => {
            attendues.iter().any(|attendue| attendue == origine) || est_loopback(origine)
        }
        None => false,
    }
}

/// Vérifie une requête mutante, dans l'ordre du fil : origine, Content-Type,
/// taille déclarée. Aucune action avant validation.
pub fn verifie_garde(
    origine: Option<&str>,
    content_type: Option<&str>,
    content_length: Option<&str>,
    attendues: &[String],
) -> Result<(), RefusGarde> {
    // 1. Origine. Une requête simple (formulaire, `<img>`, `<script>`) n'en
    //    envoie pas : c'est précisément le vecteur à fermer.
    let Some(origine) = origine.filter(|origine| !origine.is_empty()) else {
        return Err(RefusGarde {
            raison: RaisonGarde::OrigineAbsente,
            statut: 403,
            attendue: None,
            recue: None,
        });
    };
    if !est_autorisee(Some(origine), attendues) {
        // Les deux origines sont rapportées : celles attendues viennent de la
        // configuration, celle reçue vient du navigateur. Les nommer suffit à
        // corriger la configuration sans avoir à reproduire la requête.
        return Err(RefusGarde {
            raison: RaisonGarde::OrigineEtrangere,
            statut: 403,
            attendue: Some(attendues.join(" | ")),
            recue: Some(String::from(origine)),
        });
    }

    // 2. Type de contenu. Un formulaire HTML ne peut produire que
    //    `application/x-www-form-urlencoded`, `multipart/form-data` ou
    //    `text/plain` : les exiger rend le cross-site impossible.
    let content_type = content_type.unwrap_or_default();
    if !content_type
        .to_ascii_lowercase()
        .starts_with("application/json")
    {
        return Err(RefusGarde {
            raison: RaisonGarde::ContentType,
            statut: 415,
            attendue: None,
            recue: None,
        });
    }

    // 3. Taille déclarée. Un corps énorme est refusé **avant** d'être lu : le
    //    lire pour le refuser ensuite consommerait la mémoire pour rien. La
    //    taille RÉELLE (même chunked) est tranchée à la lecture (C09).
    if let Ok(longueur) = content_length.unwrap_or_default().trim().parse::<usize>()
        && longueur > MAX_BODY_BYTES
    {
        return Err(RefusGarde {
            raison: RaisonGarde::CorpsTropGrand,
            statut: 413,
            attendue: None,
            recue: None,
        });
    }

    Ok(())
}

/// Message : la cause, jamais un refus muet.
#[must_use]
pub fn describe_refus(raison: RaisonGarde, attendue: Option<&str>, recue: Option<&str>) -> String {
    match raison {
        RaisonGarde::OrigineAbsente => String::from("missing origin: likely cross-site request"),
        RaisonGarde::OrigineEtrangere => format!(
            "unauthorized origin (expected {}, received {})",
            attendue.unwrap_or("?"),
            recue.unwrap_or("?")
        ),
        RaisonGarde::Methode => String::from("method not allowed on this route"),
        RaisonGarde::ContentType => String::from("expected Content-Type: application/json"),
        RaisonGarde::CorpsTropGrand => {
            format!("corps trop grand (maximum {MAX_BODY_BYTES} octets)")
        }
    }
}
