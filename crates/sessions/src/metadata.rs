//! Le réducteur commun de métadonnées (T026/D18–D22) : dernier prompt
//! utilisateur, aperçu (texte ou dernier outil), horodatage, paire
//! modèle/fournisseur, niveau de raisonnement — et le cache de sources.
//!
//! ⚠️ **D22 — conservateur** : les modèles entre chevrons sont des
//! substituts (exclus — jamais « model not declared » sur un agent qui vient
//! d'écrire le sien) ; les horodatages ne se fabriquent pas ; les résumés
//! sont des données **extraites**, pas générées.
//!
//! ⚠️ **D19 — la fusion incrémentale préserve** : une fenêtre nouvelle qui
//! ne déclare rien ne remplace pas ce que les fenêtres précédentes avaient
//! déclaré — le modèle d'une vieille fenêtre survit à une fenêtre muette.
//!
//! ⚠️ **D20 — une source invalide n'efface pas les autres** : le réducteur
//! rend une valeur par source ; l'invalidité de l'une ne touche pas le cache
//! des autres.

use crate::agents::opencode::moteur::EntreeBrute;
use crate::families::openai::text::{modele_utilisable, texte_de};
use serde_json::Value;
use std::collections::HashMap;
use std::collections::VecDeque;

/// Les métadonnées réduites d'une source (D18).
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct ResumeSource {
    /// La dernière demande de l'UTILISATEUR (pas la réponse).
    pub dernier_prompt: Option<String>,
    /// L'aperçu : le dernier texte d'assistant, sinon le dernier outil+indice.
    pub apercu: Option<String>,
    /// Le dernier horodatage connu, en ms (jamais la date du jour).
    pub horodatage_ms: Option<i64>,
    /// Le modèle en vigueur — et son fournisseur **en paire**.
    pub modele: Option<String>,
    pub fournisseur: Option<String>,
    /// Le niveau de raisonnement en vigueur.
    pub raisonnement: Option<String>,
}

impl ResumeSource {
    /// La fusion **incrémentale** : ce que la fenêtre nouvelle déclare
    /// gagne ; ce qu'elle tait garde la valeur précédente (D19).
    #[must_use]
    pub fn fusionne(&self, nouvelle: &ResumeSource) -> ResumeSource {
        ResumeSource {
            dernier_prompt: nouvelle
                .dernier_prompt
                .clone()
                .or(self.dernier_prompt.clone()),
            apercu: nouvelle.apercu.clone().or(self.apercu.clone()),
            horodatage_ms: nouvelle.horodatage_ms.or(self.horodatage_ms),
            modele: nouvelle.modele.clone().or(self.modele.clone()),
            fournisseur: nouvelle.fournisseur.clone().or(self.fournisseur.clone()),
            raisonnement: nouvelle.raisonnement.clone().or(self.raisonnement.clone()),
        }
    }
}

/// Le corps (objet) d'une ligne brute — `None` si illisible.
fn corps_de(brut: &str) -> Option<Value> {
    serde_json::from_str(brut).ok().and_then(|valeur: Value| {
        if valeur.is_object() {
            Some(valeur)
        } else {
            None
        }
    })
}

/// Le rôle d'une ligne : `message.role` (la forme pi) — ou le `role` de
/// premier niveau (la forme à plat du corpus, déjà enveloppée par les
/// profils mais lue toléramment ici).
fn role_de(corps: &Value) -> Option<&str> {
    corps
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        .or_else(|| corps.get("role").and_then(Value::as_str))
}

/// Le contenu d'une ligne : `message.content` ou `content` de premier niveau.
fn contenu_de(corps: &Value) -> Option<&Value> {
    corps
        .get("message")
        .and_then(|message| message.get("content"))
        .or_else(|| corps.get("content"))
}

/// Le texte d'un contenu : une chaîne, ou la jointure des blocs `text`.
fn texte_de_contenu(contenu: &Value) -> String {
    if let Some(texte) = contenu.as_str() {
        return texte.to_string();
    }
    match contenu.as_array() {
        Some(blocs) => blocs
            .iter()
            .filter_map(|bloc| bloc.get("text"))
            .filter_map(Value::as_str)
            .collect::<Vec<&str>>()
            .join(""),
        None => String::new(),
    }
}

/// Le dernier texte d'un rôle donné, en remontant le fil.
#[must_use]
pub fn dernier_texte_de_role(entrees: &[EntreeBrute], role: &str) -> Option<String> {
    for entree in entrees.iter().rev() {
        let corps = match corps_de(&entree.brut) {
            Some(corps) => corps,
            None => continue,
        };
        if role_de(&corps) != Some(role) {
            continue;
        }
        let texte = texte_de_contenu(contenu_de(&corps).unwrap_or(&Value::Null));
        if !texte.is_empty() {
            return Some(texte);
        }
    }
    None
}

/// L'indice lisible dans les arguments d'un outil — jamais de JSON déversé
/// (80 caractères, la première ligne) ; `title` d'abord : le libellé que
/// l'agent donne lui-même à son action.
#[must_use]
fn indice_d_arguments(args: &Value) -> Option<String> {
    if let Some(texte) = args.as_str() {
        let premiere = texte.lines().next().unwrap_or("").trim();
        return if premiere.is_empty() {
            None
        } else {
            Some(premiere.chars().take(80).collect())
        };
    }
    let objet = args.as_object()?;
    for cle in ["title", "cmd", "command", "path", "code"] {
        if let Some(valeur) = objet.get(cle).and_then(Value::as_str) {
            let valeur = valeur.trim();
            if !valeur.is_empty() {
                return Some(valeur.chars().take(80).collect());
            }
        }
    }
    None
}

/// Le dernier **appel d'outil** de l'agent, résumé en une ligne — ⚠️ un agent
/// bloqué n'a souvent rien DIT : sans ce repli, sa ligne restait vide alors
/// que les autres montraient leur demande. On ne fabrique toujours rien :
/// sans appel lisible, `None`.
fn dernier_outil(entrees: &[EntreeBrute], role: &str) -> Option<String> {
    for entree in entrees.iter().rev() {
        let corps = match corps_de(&entree.brut) {
            Some(corps) => corps,
            None => continue,
        };
        if role_de(&corps) != Some(role) {
            continue;
        }
        let contenu = contenu_de(&corps)?.as_array()?.iter();
        for bloc in contenu {
            if bloc.get("type").and_then(Value::as_str) != Some("toolCall") {
                continue;
            }
            let nom = bloc.get("name").and_then(Value::as_str).unwrap_or("");
            if nom.is_empty() {
                continue;
            }
            let indice = bloc.get("arguments").and_then(indice_d_arguments);
            return Some(match indice {
                Some(indice) => format!("{nom} · {indice}"),
                None => nom.to_string(),
            });
        }
    }
    None
}

/// Le dernier horodatage connu, en ms — ⚠️ les horodatages pi sont des
/// **chaînes ISO** : les lire par conversion numérique brute les perdait
/// (`Number(ISO)` = NaN — le défaut mesuré) ; on parse l'ISO proprement,
/// et on ne remplace jamais par la date du jour.
#[must_use]
pub fn horodatage_de(entrees: &[EntreeBrute]) -> Option<i64> {
    for entree in entrees.iter().rev() {
        if let Some(horodatage) = &entree.timestamp
            && let Some(ms) = iso_vers_ms(horodatage)
        {
            return Some(ms);
        }
    }
    None
}

/// Le modèle et le fournisseur **en paire**, et le niveau — deux endroits,
/// le plus récent gagne : les changements (`model_change`/`thinking_level_change`)
/// OU le message lui-même. ⚠️ Si le message qui donne le modèle ne donne pas
/// le fournisseur, on n'y colle PAS celui d'un changement plus ancien, qui
/// décrirait un autre modèle (D22 : la paire est une paire).
#[must_use]
pub fn reglages_de(entrees: &[EntreeBrute]) -> (Option<String>, Option<String>, Option<String>) {
    let mut modele: Option<String> = None;
    let mut fournisseur: Option<String> = None;
    let mut niveau: Option<String> = None;
    for entree in entrees.iter().rev() {
        if modele.is_none() || fournisseur.is_none() {
            match (entree.genre.as_str(), corps_de(&entree.brut)) {
                ("model_change", Some(corps)) => {
                    if let Some(model) = modele
                        .is_none()
                        .then(|| modele_utilisable(corps.get("modelId").unwrap_or(&Value::Null)))
                        .flatten()
                    {
                        modele = Some(model);
                        // Le fournisseur d'un changement plus ancien ne
                        // décrirait pas CE modèle.
                        fournisseur =
                            texte_de(corps.get("provider").unwrap_or(&Value::Null)).or(fournisseur);
                    }
                }
                ("message", Some(corps)) => {
                    let message = corps.get("message").unwrap_or(&Value::Null);
                    if let Some(model) = modele
                        .is_none()
                        .then(|| modele_utilisable(message.get("model").unwrap_or(&Value::Null)))
                        .flatten()
                    {
                        // La PAIRE : le fournisseur du MÊME message, ou
                        // rien — pas celui d'un ancien changement.
                        let paire_fournisseur =
                            texte_de(message.get("provider").unwrap_or(&Value::Null));
                        modele = Some(model);
                        fournisseur = paire_fournisseur;
                    }
                }
                _ => (),
            }
        }
        if niveau.is_none() {
            match (entree.genre.as_str(), corps_de(&entree.brut)) {
                ("thinking_level_change", Some(corps)) => {
                    niveau =
                        texte_de(corps.get("thinkingLevel").unwrap_or(&Value::Null)).or(niveau);
                }
                ("message", Some(corps)) => {
                    niveau = texte_de(
                        corps
                            .get("message")
                            .and_then(|message| message.get("thinkingLevel"))
                            .unwrap_or(&Value::Null),
                    )
                    .or(niveau);
                }
                _ => (),
            }
        }
        if modele.is_some() && niveau.is_some() {
            break;
        }
    }
    (modele, fournisseur, niveau)
}

/// Le réducteur complet — cohérent pour les cinq profils (leurs lignes
/// arrivent en forme pi via les codecs).
#[must_use]
pub fn reduis(entrees: &[EntreeBrute]) -> ResumeSource {
    let (modele, fournisseur, raisonnement) = reglages_de(entrees);
    ResumeSource {
        dernier_prompt: dernier_texte_de_role(entrees, "user"),
        apercu: dernier_texte_de_role(entrees, "assistant")
            .or_else(|| dernier_outil(entrees, "assistant")),
        horodatage_ms: horodatage_de(entrees),
        modele,
        fournisseur,
        raisonnement,
    }
}

/// Le cache de résumés : **256 sources**, la plus ancienne évincée ; la
/// fusion incrémentale préserve les déclarations précédentes (D19) ; une
/// source invalide ne touche pas les autres (D20).
pub struct CacheResumes {
    resumes: HashMap<String, (ResumeSource, usize)>,
    ordre: VecDeque<String>,
    horloge: usize,
}

/// La capacité du cache — 256 sources (D19, mesuré).
pub const CAPACITE_CACHE: usize = 256;

impl CacheResumes {
    #[must_use]
    pub fn nouveau() -> Self {
        Self {
            resumes: HashMap::new(),
            ordre: VecDeque::new(),
            horloge: 0,
        }
    }

    /// Le résumé d'une source — `None` quand on ne l'a jamais réduit (une
    /// source invalide n'entre PAS, et ne touche pas les autres).
    #[must_use]
    pub fn resume(&self, cle_source: &str) -> Option<&ResumeSource> {
        self.resumes.get(cle_source).map(|(resume, _)| resume)
    }

    /// Met à jour le résumé d'une source avec une NOUVELLE fenêtre : la
    /// fusion préserve les déclarations précédentes (D19). Une erreur de
    /// réduction (entrée illisible) **ne touche pas** l'entrée existante.
    pub fn met_a_jour(&mut self, cle_source: &str, entrees: &[EntreeBrute]) {
        let nouvelle = reduis(entrees);
        let fusion = match self.resumes.get(cle_source) {
            Some((precedent, _)) => precedent.fusionne(&nouvelle),
            None => nouvelle,
        };
        self.horloge += 1;
        if !self.ordre.contains(&cle_source.to_string()) {
            self.ordre.push_back(cle_source.to_string());
        }
        if self.resumes.len() >= CAPACITE_CACHE && !self.resumes.contains_key(cle_source) {
            // La plus ancienne évincée (ordre d'insertion).
            if let Some(vieille) = self.ordre.pop_front() {
                self.resumes.remove(&vieille);
            }
        }
        self.resumes
            .insert(cle_source.to_string(), (fusion, self.horloge));
    }

    /// L'invalidation explicite (source remplacée / supprimée).
    pub fn invalide(&mut self, cle_source: &str) {
        self.resumes.remove(cle_source);
        self.ordre.retain(|cle| cle != cle_source);
    }
}

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
