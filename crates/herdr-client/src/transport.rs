//! Le transport Unix (T012) : JSONL ligne par ligne, corrélation par
//! identifiant, cadre borné à 16 MiB, UTF-8 fragmenté, deadline par méthode.
//!
//! ⚠️ **Aucune relance automatique d'une opération mutante** : une erreur de
//! transport remonte telle quelle à l'appelant — seul lui décide de rejouer
//! (et le faire silencieusement enverrait deux fois le même prompt).
//!
//! ⚠️ Transport **bloquant** (`std::os::unix::net`) : les deadlines sont
//! posées sur le socket (`set_read_timeout`/`set_write_timeout`) ; l'adapter
//! vers les ports asynchrones l'enveloppe (T021), sans re-décoder ici.

use serde_json::{Value, json};
use std::io::{BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Un cadre (ligne JSONL) au-delà de 16 MiB est un refus — jamais une
/// lecture qui s'étire sans borne.
pub const CADRE_MAX_OCTETS: usize = 16 * 1024 * 1024;

/// Le délai socket par défaut — **15 secondes, mesuré** (C07 : 15 s socket
/// contre 120 s de shell).
pub const DELAI_PAR_DEFAUT: Duration = Duration::from_secs(15);

/// Le délai de démarrage d'agent **demandé à Herdr** (`agent.start.timeout_ms`)
/// — 120 s, la valeur du fil (Herdr attend que l'agent sorte de `unknown`).
pub const DELAI_DEMARRAGE_HERDR_MS: u64 = 120_000;

/// La marge du socket au-delà du délai demandé à Herdr : le verdict d'Herdr
/// (démarré, ou son propre délai dépassé) doit arriver AVANT que le socket
/// abandonne.
pub const MARGE_SOCKET_DEMARRAGE: Duration = Duration::from_secs(5);

/// Les deadlines **par méthode** : les méthodes lentes documentées sortent
/// du défaut ; tout le reste vit à 15 s.
///
/// ⚠️ Valeurs mesurées seulement : le catalogage des modèles porte la limite
/// partagée (20 s, `MODEL_CATALOG_TIMEOUT_MS`).
///
/// ⚠️ **`agent.start` attend jusqu'à 120 s côté Herdr** : il ne répond
/// qu'une fois l'agent démarré. Avec le défaut de 15 s, un démarrage lent
/// (claude met souvent plus de 15 s) était déclaré « délai dépassé » par le
/// socket alors qu'Herdr travaillait encore — le lancement tombait en
/// « amorçage ambigu » pour un agent qui démarrait normalement. Le socket
/// attend donc le délai demandé à Herdr plus une marge (125 s).
#[must_use]
pub fn delai_de(methode: &str) -> Duration {
    match methode {
        "agent.catalog" | "catalog" => Duration::from_secs(20),
        "agent.start" => Duration::from_millis(DELAI_DEMARRAGE_HERDR_MS) + MARGE_SOCKET_DEMARRAGE,
        _ => DELAI_PAR_DEFAUT,
    }
}

/// Les erreurs du transport — chaque cause distincte, aucune relance
/// automatique.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ErreurTransport {
    /// Le socket a fermé (EOF) — l'amont est parti.
    Ferme,
    /// Un cadre dépasse 16 MiB.
    CadreTropGrand,
    /// La ligne n'est pas du JSON.
    JsonInvalide(String),
    /// Le JSON n'est pas l'enveloppe attendue (id absent, result+error…).
    EnveloppeInvalide(String),
    /// L'amont a répondu une erreur **structurée** (code + message) — un
    /// refus réel, pas une enveloppe cassée.
    AmontRefus { code: String, message: String },
    /// La réponse ne répond pas à NOTRE identifiant.
    MauvaiseCorrelation { attendu: u64, recu: u64 },
    /// Le délai de la méthode est dépassé sans verdict.
    DelaiDepasse,
    /// Le socket lui-même a échoué (connexion, écriture, lecture).
    Socket(String),
}

impl std::fmt::Display for ErreurTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErreurTransport::Ferme => f.write_str("socket fermé par l'amont"),
            ErreurTransport::CadreTropGrand => f.write_str("cadre au-delà de 16 MiB"),
            ErreurTransport::JsonInvalide(detail) => write!(f, "JSON invalide : {detail}"),
            ErreurTransport::EnveloppeInvalide(detail) => {
                write!(f, "enveloppe invalide : {detail}")
            }
            ErreurTransport::AmontRefus { code, message } => {
                write!(f, "refus amont {code} : {message}")
            }
            ErreurTransport::MauvaiseCorrelation { attendu, recu } => {
                write!(f, "corrélation rompue : attendu {attendu}, reçu {recu}")
            }
            ErreurTransport::DelaiDepasse => f.write_str("délai dépassé sans verdict"),
            ErreurTransport::Socket(detail) => write!(f, "socket : {detail}"),
        }
    }
}

impl std::error::Error for ErreurTransport {}

/// Le transport : le **chemin** du socket et un compteur d'identifiants.
///
/// ⚠️ **Une connexion PAR demande**, et c'est une mesure, pas un choix :
/// Herdr ferme la connexion après chaque réponse (la deuxième écriture lève
/// un tube cassé). Le fil ouvrait lui aussi une connexion par appel — trouvé
/// en LANÇANT le vrai démon, pas en relisant le code.
#[derive(Debug)]
pub struct TransportUnix {
    chemin: PathBuf,
    prochain_id: u64,
}

impl TransportUnix {
    /// Retient le chemin — **sans ouvrir de connexion**.
    ///
    /// ⚠️ Une connexion d'essai serait une connexion de trop : Herdr sert
    /// **une** demande par connexion (mesuré), et la joignabilité se prouve au
    /// premier `appelle` (le ping de santé). Un démon doit pouvoir démarrer
    /// même si Herdr est momentanément absent, et le dire dans `/api/health`
    /// (O03) — refuser de démarrer pour un socket absent privait l'utilisateur
    /// de son interface à cause d'un voisin en panne.
    pub fn connecte(chemin: &Path) -> Result<Self, ErreurTransport> {
        Ok(Self {
            chemin: chemin.to_path_buf(),
            prochain_id: 1,
        })
    }

    /// Appelle une méthode : un cadre demande, un cadre réponse, corrélés
    /// par identifiant — avec le délai de la méthode.
    pub fn appelle(&mut self, methode: &str, params: &Value) -> Result<Value, ErreurTransport> {
        self.appelle_avec_delai(methode, params, delai_de(methode))
    }

    /// La même, avec un délai explicite — pour les tests et les politiques
    /// qui savent mieux.
    pub fn appelle_avec_delai(
        &mut self,
        methode: &str,
        params: &Value,
        delai: Duration,
    ) -> Result<Value, ErreurTransport> {
        let identifiant = self.prochain_id;
        self.prochain_id += 1;
        let mut flux = UnixStream::connect(&self.chemin)
            .map_err(|cause| ErreurTransport::Socket(cause.to_string()))?;
        let mut lecteur = BufReader::new(
            flux.try_clone()
                .map_err(|cause| ErreurTransport::Socket(cause.to_string()))?,
        );
        self.envoie(&mut flux, identifiant, methode, params, delai)?;
        self.recoit(&flux, &mut lecteur, identifiant, delai)
    }

    fn envoie(
        &mut self,
        flux: &mut UnixStream,
        identifiant: u64,
        methode: &str,
        params: &Value,
        delai: Duration,
    ) -> Result<(), ErreurTransport> {
        flux.set_write_timeout(Some(delai))
            .map_err(|cause| ErreurTransport::Socket(cause.to_string()))?;
        // ⚠️ L'identifiant est une **chaîne** : mesuré sur le socket réel,
        // Herdr refuse un entier (`invalid type: integer 1, expected a string`).
        // Le faux des tests l'acceptait en nombre — c'est le lancement du vrai
        // démon qui l'a révélé.
        let cadre = json!({
            "id": identifiant.to_string(),
            "method": methode,
            "params": params
        });
        let mut ligne = cadre.to_string();
        ligne.push('\n');
        flux.write_all(ligne.as_bytes())
            .map_err(|cause| ErreurTransport::Socket(cause.to_string()))?;
        flux.flush()
            .map_err(|cause| ErreurTransport::Socket(cause.to_string()))
    }

    /// L'identifiant qui partira avec la PROCHAINE demande — l'appelant qui
    /// rejoue **explicitement** le voit avancer.
    #[must_use]
    pub fn prochain_identifiant(&self) -> u64 {
        self.prochain_id
    }

    fn recoit(
        &mut self,
        flux: &UnixStream,
        lecteur: &mut BufReader<UnixStream>,
        identifiant_attendu: u64,
        delai: Duration,
    ) -> Result<Value, ErreurTransport> {
        flux.set_read_timeout(Some(delai))
            .map_err(|cause| ErreurTransport::Socket(cause.to_string()))?;
        // Lecture par octets jusqu'au saut de ligne : l'UTF-8 peut être
        // fragmenté EN CADRE, jamais À TRAVERS les cadres (le saut de ligne
        // est la frontière) ; le décodage n'arrive qu'à la fin.
        let mut cadre = Vec::new();
        let mut compteur = 0_usize;
        let mut octet = [0_u8; 1];
        loop {
            let lus = lecteur.read(&mut octet).map_err(|cause| {
                if cause.kind() == std::io::ErrorKind::WouldBlock
                    || cause.kind() == std::io::ErrorKind::TimedOut
                {
                    ErreurTransport::DelaiDepasse
                } else {
                    ErreurTransport::Socket(cause.to_string())
                }
            })?;
            if lus == 0 {
                return Err(ErreurTransport::Ferme);
            }
            compteur += lus;
            if compteur > CADRE_MAX_OCTETS {
                return Err(ErreurTransport::CadreTropGrand);
            }
            if octet[0] == b'\n' {
                break;
            }
            cadre.push(octet[0]);
        }
        let texte = String::from_utf8(cadre)
            .map_err(|cause| ErreurTransport::JsonInvalide(cause.to_string()))?;
        let reponse: Value = serde_json::from_str(texte.trim())
            .map_err(|cause| ErreurTransport::JsonInvalide(cause.to_string()))?;
        // L'écho peut revenir en chaîne (le cas réel) ou en nombre (certains
        // intermédiaires) : les deux se lisent, et la corrélation compare la
        // représentation.
        let recu = match reponse.get("id") {
            Some(Value::String(texte)) => texte.parse::<u64>().map_err(|_| {
                ErreurTransport::EnveloppeInvalide(format!("id non numérique : {texte}"))
            })?,
            Some(valeur) => valeur.as_u64().ok_or_else(|| {
                ErreurTransport::EnveloppeInvalide(String::from("id absent ou non numérique"))
            })?,
            None => {
                return Err(ErreurTransport::EnveloppeInvalide(String::from(
                    "id absent",
                )));
            }
        };
        if recu != identifiant_attendu {
            return Err(ErreurTransport::MauvaiseCorrelation {
                attendu: identifiant_attendu,
                recu,
            });
        }
        match (reponse.get("result"), reponse.get("error")) {
            (Some(resultat), None) => Ok(resultat.clone()),
            (None, Some(panne)) => {
                // L'erreur amont reste structurée : code + message, jamais
                // une chaîne opaque ; un corps inattendu se lit tel quel.
                Err(match (panne.get("code"), panne.get("message")) {
                    (Some(code), Some(message)) => ErreurTransport::AmontRefus {
                        code: code.as_str().unwrap_or_default().to_string(),
                        message: message.as_str().unwrap_or_default().to_string(),
                    },
                    _ => ErreurTransport::EnveloppeInvalide(panne.to_string()),
                })
            }
            (Some(_), Some(_)) => Err(ErreurTransport::EnveloppeInvalide(String::from(
                "result ET error présents : enveloppe ambiguë",
            ))),
            (None, None) => Err(ErreurTransport::EnveloppeInvalide(String::from(
                "ni result ni error",
            ))),
        }
    }
}
