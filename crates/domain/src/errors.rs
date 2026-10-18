//! Causes nommées et taxonomie d'erreurs de port.
//!
//! ⚠️ **La cause est nommée, jamais un 502 indifférencié** (B03) : confondre
//! « permission refusée » et « panne réseau » fait croire à une panne et fait
//! relancer inutilement. Quatre causes de lecture se ressemblent de loin et
//! produisent des réponses radicalement différentes.

use serde::{Deserialize, Serialize};

/// Cause d'une réponse de session : `absente | vide | invalide | io`.
///
/// ⚠️ Ces quatre cas se confondent de loin, et les confondre produit soit une
/// erreur rouge en boucle, soit — pire — une vue qui ment :
///
/// | Cause       | Sens                                     | Réponse          |
/// |-------------|------------------------------------------|------------------|
/// | [`Absente`] | le fichier n'existe pas encore            | 200, vide        |
/// | [`Vide`]    | le fichier existe, zéro entrée            | 200, vide        |
/// | [`Invalide`]| contenu illisible ou ligne tronquée       | 422              |
/// | [`Io`]      | permission, disque, erreur du système     | 502              |
///
/// `absente` n'est **pas** une panne : Herdr annonce un `agent_session` valide
/// vers un fichier que Pi n'a pas encore créé (le JSONL naît au premier
/// message — mesuré sur un vrai agent devin). Les codes d'orthographe viennent
/// du fil actuel ; ne jamais requalifier un autre code.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub enum ReadCause {
    /// Le fichier n'existe pas encore.
    #[serde(rename = "absente")]
    Absente,
    /// Le fichier existe, zéro entrée.
    #[serde(rename = "vide")]
    Vide,
    /// Contenu illisible ou ligne tronquée.
    #[serde(rename = "invalide")]
    Invalide,
    /// Permission, disque, erreur du système.
    #[serde(rename = "io")]
    Io,
}

/// Ce qu'une cause dit, avec son message et son caractère bénin.
///
/// - `benign = true` **seulement** pour `absente` et `vide` : rien ne va mal.
/// - Le message est destiné à l'utilisateur et **distinct pour chaque cause**.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct ReadVerdict {
    pub cause: ReadCause,
    pub message: String,
    pub benign: bool,
}

fn verdict_fini(cause: ReadCause, message: &'static str, benign: bool) -> ReadVerdict {
    ReadVerdict {
        cause,
        message: message.into(),
        benign,
    }
}

fn verdict_cause(cause: ReadCause) -> ReadVerdict {
    match cause {
        ReadCause::Absente => verdict_fini(ReadCause::Absente, "session absente", true),
        ReadCause::Vide => verdict_fini(ReadCause::Vide, "session vide", true),
        ReadCause::Invalide => verdict_fini(ReadCause::Invalide, "session illisible", false),
        ReadCause::Io => verdict_fini(ReadCause::Io, "session inaccessible", false),
    }
}

/// Le verdict exact d'une cause — les messages sont les textes du fil actuel.
#[must_use]
pub fn verdict_of(cause: ReadCause) -> ReadVerdict {
    verdict_cause(cause)
}

/// Une session **existante** mais dont on ne peut pas interpréter le contenu.
///
/// Distinguée de `io` : une ligne tronquée ou un JSON altéré n'est pas une
/// panne du serveur ; le message porte le détail à la place du diagnostic
/// générique — sinon l'utilisateur croit à une panne réseau et relance pour rien.
#[must_use]
pub fn invalid_session(detail: &str) -> ReadVerdict {
    ReadVerdict {
        cause: ReadCause::Invalide,
        benign: false,
        message: format!("session illisible ({detail})"),
    }
}

/// Classe une erreur d'entrée-sortie posée par la lecture du fichier.
///
/// ⚠️ La distinction se fait sur la **nature** d'erreur, jamais sur le texte
/// du message — il varie selon la plateforme. `absente` correspond à CE
/// FICHIER inexistant (`NotFound`) ; les autres natures restent `io`.
#[must_use]
pub fn verdict_of_io(error: &std::io::Error) -> ReadVerdict {
    use std::io::ErrorKind;
    let cause = match error.kind() {
        ErrorKind::NotFound => ReadCause::Absente,
        // Permission refusée ou boucle de liens : le fichier existe, on ne
        // peut pas le lire — pas une session absente.
        _ => ReadCause::Io,
    };
    verdict_cause(cause)
}

/// Échec d'un appel de port — le monde a refusé, genré par sa nature.
///
/// ⚠️ **Le genre amont est préservé** (code + message Herdr distincts), et
/// une décision de politique (chemin refusé) n'est **pas** une panne : elle
/// vit dans sa variante propre, jamais morphée en erreur réseau.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum PortError {
    /// Herdr (ou le magasin amont) a répondu une erreur structurée :
    /// `code` et `message` sont tous deux requis.
    Upstream { code: String, message: String },
    /// La conversation avec le transport a échoué avant toute réponse.
    Transport { detail: String },
    /// Le délai attendu (méthode ou socket) a été dépassé — distinct d'une
    /// réponse négative : rien ne dit ce que l'amont a fait.
    Timeout,
    /// Une capacité demandée n'a pas été mesurée sur cette instance.
    /// L'affichage la présente comme absente, jamais comme en panne.
    Unsupported { feature: String },
    /// La politique de chemin (S03) a refusé : une **décision**, pas une
    /// panne ; le détail porte le motif exact (`hors-racine`,
    /// `lien-sortant`…). La requalification en cause bénigne se fait à
    /// l'appel, où la raison est connue.
    PathRejected { detail: String },
}

impl PortError {
    /// Le message destiné à la trace humaine, sans déduire une cause.
    #[must_use]
    pub fn description(&self) -> String {
        match self {
            PortError::Upstream { code, message } => format!("upstream {code}: {message}"),
            PortError::Transport { detail } => format!("transport: {detail}"),
            PortError::Timeout => "deadline exceeded".into(),
            PortError::Unsupported { feature } => format!("unsupported: {feature}"),
            PortError::PathRejected { detail } => format!("path rejected: {detail}"),
        }
    }
}

impl std::fmt::Display for PortError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.description())
    }
}

impl std::error::Error for PortError {}
/// Les **treize natures** d'erreur du domaine (TECH §5) — fermées, sans
/// statut HTTP : le statut est la décision de `http-api`, par route.
///
/// ⚠️ `invalide ≠ vide ≠ absent ≠ IO` (C04) : quatre faits distincts, jamais
/// aplatis. `SourceAbsent` et `SourceInvalid` sont des **pannes de lecture** ;
/// une cause de lecture **bénigne** (absente, vide) n'est pas une erreur —
/// voir [`cause_de_lecture`].
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Nature {
    /// L'entrée reçue ne respecte pas sa forme (corps, paramètre, argument).
    InvalidInput,
    /// Rien ne prouve une source : c'est une **valeur**, portée comme telle,
    /// mais certains endpoints la traitent en erreur documentée (H04 → 404).
    NoSource,
    /// La source annoncée n'existe pas au moment de la lecture (base SQLite
    /// manquante → H04 503).
    SourceAbsent,
    /// La source existe mais son contenu n'est pas ce qui est attendu.
    SourceInvalid,
    /// La lecture de la source a échoué (I/O réelle).
    SourceIo,
    /// La politique de chemin a refusé (S03) : décision, pas une panne.
    PathDenied,
    /// L'amont est injoignable ou absent dans le délai.
    UpstreamUnavailable,
    /// L'amont a refusé, avec sa raison.
    UpstreamRejected,
    /// L'amont a répondu hors de sa propre forme (décodage impossible).
    UpstreamMalformed,
    /// Le délai est dépassé sans verdict.
    Deadline,
    /// L'action a partiellement eu lieu — l'état réel est dans le détail.
    PartialAction,
    /// Une ressource partagée est saturée (plafond documenté atteint).
    Overloaded,
    /// Un invariant interne est violé : 500 nommé, jamais un succès fabriqué.
    InternalInvariant,
}

impl Nature {
    /// Le code stable de la nature, pour le journal diagnostic structuré.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Nature::InvalidInput => "invalid_input",
            Nature::NoSource => "no_source",
            Nature::SourceAbsent => "source_absent",
            Nature::SourceInvalid => "source_invalid",
            Nature::SourceIo => "source_io",
            Nature::PathDenied => "path_denied",
            Nature::UpstreamUnavailable => "upstream_unavailable",
            Nature::UpstreamRejected => "upstream_rejected",
            Nature::UpstreamMalformed => "upstream_malformed",
            Nature::Deadline => "deadline",
            Nature::PartialAction => "partial_action",
            Nature::Overloaded => "overloaded",
            Nature::InternalInvariant => "internal_invariant",
        }
    }
}

/// Le contexte diagnostic **structuré** — pour le journal, pas pour l'écran.
///
/// ⚠️ **Aucun secret ne passe** : [`Diagnostic::insere`] **refuse** toute clé
/// qui ressemble à du matériel privé (clef privée, token, mot de passe). Un
/// refus nommé, pas une réécriture silencieuse — masquer serait pire.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Diagnostic {
    /// Le code stable de la nature (redondant avec `nature`, porté pour un
    /// journal plat).
    pub code: &'static str,
    /// La cause réelle, telle que portée — déjà sûre.
    pub cause: Option<String>,
    /// Les entrées de contexte clé/valeur.
    pub entrees: Vec<(String, String)>,
}

/// Les fragments de clé qui désignent du matériel privé — mesurés sur ce que
/// le service manipule (clefs VAPID, tokens de push) ; liste fermée, élargie
/// seulement avec une preuve.
const FRAGMENTS_SECRETS: [&str; 7] = [
    "prive", "privee", "private", "secret", "token", "password", "passe",
];

impl Diagnostic {
    #[must_use]
    fn de_nature(nature: Nature) -> Self {
        Self {
            code: nature.code(),
            cause: None,
            entrees: Vec::new(),
        }
    }

    /// Insère une entrée de contexte. **Refuse** les clés qui désignent du
    /// matériel privé — l'erreur est nommée, jamais avalée.
    pub fn insere(&mut self, cle: &str, valeur: impl Into<String>) -> Result<(), String> {
        let cle_basse = cle.to_lowercase();
        if FRAGMENTS_SECRETS
            .iter()
            .any(|fragment| cle_basse.contains(fragment))
        {
            return Err(format!("clé de contexte refusée (matériel privé) : {cle}"));
        }
        self.entrees.push((cle.to_string(), valeur.into()));
        Ok(())
    }
}

/// Une erreur du domaine : nature fermée, détail pour l'écran (nettoyé **à
/// l'affichage**, comme le fil actuel), contexte diagnostic structuré — et
/// **jamais** de statut HTTP (TECH §5).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct ErreurDomaine {
    pub nature: Nature,
    /// Le détail brut — [`ErreurDomaine::message_sur`] le rend sûr à l'écran.
    pub detail: String,
    pub diagnostic: Diagnostic,
}

impl std::fmt::Display for ErreurDomaine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message_sur())
    }
}

impl std::error::Error for ErreurDomaine {}

macro_rules! nature_erreur {
    ($($constructeur:ident, $variante:ident);+ $(;)?) => {
        impl ErreurDomaine {
            $(
                #[must_use]
                pub fn $constructeur(detail: impl Into<String>) -> Self {
                    let nature = Nature::$variante;
                    Self {
                        nature,
                        detail: detail.into(),
                        diagnostic: Diagnostic::de_nature(nature),
                    }
                }
            )+
        }
    };
}

nature_erreur! {
    entree_invalide, InvalidInput;
    sans_source, NoSource;
    source_absente, SourceAbsent;
    source_invalide, SourceInvalid;
    source_illisible, SourceIo;
    chemin_refuse, PathDenied;
    amont_injoignable, UpstreamUnavailable;
    amont_refus, UpstreamRejected;
    amont_malforme, UpstreamMalformed;
    delai_depasse, Deadline;
    action_partielle, PartialAction;
    sature, Overloaded;
    invariant_viole, InternalInvariant;
}

impl ErreurDomaine {
    /// Porte la cause réelle dans le diagnostic — chaîne déjà sûre.
    #[must_use]
    pub fn avec_cause(mut self, cause: impl Into<String>) -> Self {
        self.diagnostic.cause = Some(cause.into());
        self
    }

    /// Insère une entrée de contexte (le refus des clés privées se propage).
    pub fn avec_entree(mut self, cle: &str, valeur: impl Into<String>) -> Result<Self, String> {
        self.diagnostic.insere(cle, valeur)?;
        Ok(self)
    }

    /// Le message **sûr** pour l'écran : identifiants retirés, plafonné à
    /// 300 caractères, jamais vide (mesuré sur Reply.ts).
    #[must_use]
    pub fn message_sur(&self) -> String {
        let nettoie = supprime_identifiants(&self.detail);
        if nettoie.trim().is_empty() {
            String::from("erreur sans message")
        } else {
            nettoie
        }
    }
}

/// Retire les identifiants internes d'un message destiné à l'écran, puis
/// plafonne à 300 caractères — les trois règles mesurées de Reply.ts :
///
/// - `wX:pY` → « le nouvel onglet » ;
/// - `wX:tY` → « son onglet » ;
/// - `pane_id=…` / `tab_id=…` / `workspace_id=…` → retirés.
///
/// ⚠️ Sans dépendance regex : les jetons sont reconnus sur les frontières de
/// mots, ce qui couvre exactement les `\b` du fil ; les caractères hors
/// ASCII passent tels quels (le plafond recule jusqu'à une frontière de
/// caractère, jamais au milieu d'un accent).
#[must_use]
pub fn supprime_identifiants(message: &str) -> String {
    let sans_ids = retire_ids_nommes(message);
    let mut sortie = String::with_capacity(sans_ids.len());
    let mut jeton = String::new();
    for caractere in sans_ids.chars() {
        if caractere.is_ascii_alphanumeric() || caractere == ':' {
            jeton.push(caractere);
        } else {
            if !jeton.is_empty() {
                sortie.push_str(remplace_si_identifiant(&jeton));
                jeton.clear();
            }
            sortie.push(caractere);
        }
    }
    if !jeton.is_empty() {
        sortie.push_str(remplace_si_identifiant(&jeton));
    }
    plafonne_300(&sortie).to_string()
}

/// Le plafond de 300 caractères, en reculant jusqu'à une frontière de
/// caractère (jamais au milieu d'un accent).
fn plafonne_300(message: &str) -> &str {
    if message.len() <= 300 {
        return message;
    }
    let mut borne = 300;
    while borne > 0 && !message.is_char_boundary(borne) {
        borne -= 1;
    }
    &message[..borne]
}

fn retire_ids_nommes(message: &str) -> String {
    let mut sortie = String::with_capacity(message.len());
    let mut garde = false;
    for mot in message.split_whitespace() {
        if mot.starts_with("pane_id=")
            || mot.starts_with("tab_id=")
            || mot.starts_with("workspace_id=")
        {
            continue;
        }
        if garde {
            sortie.push(' ');
        }
        sortie.push_str(mot);
        garde = true;
    }
    sortie
}

fn remplace_si_identifiant(jeton: &str) -> &str {
    let (avant, apres) = match jeton.split_once(':') {
        Some((avant, apres)) => (avant, apres),
        None => return jeton,
    };
    // wX — le « w » suivi d'alphanumériques (éventuellement aucun).
    if avant.as_bytes().first() != Some(&b'w') {
        return jeton;
    }
    let corps_avant = &avant[1..];
    if !corps_avant.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return jeton;
    }
    // pY / tY — la lettre de sens puis au moins un alphanumérique.
    let lettres = apres.as_bytes();
    if lettres.len() < 2 || !lettres[1..].iter().all(|b| b.is_ascii_alphanumeric()) {
        return jeton;
    }
    match lettres[0] {
        b'p' => "le nouvel onglet",
        b't' => "son onglet",
        _ => jeton,
    }
}

/// Une cause de lecture **d'erreur** devient une erreur du domaine — les
/// causes **bénignes** (absente, vide) n'en sont pas : la valeur parle
/// ([`ReadVerdict`]), et la convertir serait masquer un état normal.
#[must_use]
pub fn cause_de_lecture(cause: ReadCause, detail: impl Into<String>) -> Option<ErreurDomaine> {
    match cause {
        ReadCause::Invalide => Some(ErreurDomaine::source_invalide(detail)),
        ReadCause::Io => Some(ErreurDomaine::source_illisible(detail)),
        ReadCause::Absente | ReadCause::Vide => None,
    }
}
