//! La lecture d'une question **à l'écran** (T032) — le port fidèle de
//! `question.ts`, sans dépendance regex : les motifs du fil sont écrits à la
//! main, chaque règle porte sa mesure.
//!
//! ⚠️ **Le filet d'abord** : opencode encadre sa zone de question d'un `┃` —
//! sans le retirer, AUCUN choix n'était reconnu et un agent bloqué restait
//! muet (mesuré 2026-10-16).
//!
//! ⚠️ **On lit la DERNIÈRE invite de l'écran** : un agent qui a déjà travaillé
//! en a affiché plusieurs — la première serait périmée.

use serde_json::Value;

/// Un choix offert, tel qu'affiché.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Choix {
    pub libelle: String,
    /// Le détail — sur la même ligne (après un trou de 2+ espaces) ou sur la
    /// ligne suivante, indentée plus profond que le choix.
    pub detail: Option<String>,
    pub numero: u64,
    /// Le curseur du sélecteur (`›` opencode/codex, `❯` Claude Code).
    pub selectionne: bool,
}

/// Comment on atteint un choix sur l'interface affichée — lu à l'écran.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Navigation {
    /// Les choix sont numérotés : on frappe le chiffre (Claude, codex,
    /// opencode).
    Chiffres,
    /// Les choix ne sont PAS numérotés : on déplace le curseur `→` avec
    /// `j`/`k` (sélecteur des extensions de pi, `extension-selector.js`).
    Fleches,
}

/// Une question posée, prête à afficher.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Question {
    pub texte: String,
    /// Les lignes de contexte (`App: Zen`, `Field 1/1`), en retrait.
    pub contexte: Vec<String>,
    pub choix: Vec<Choix>,
    /// Ce qu'il faut faire pour valider — « enter to submit | esc to cancel ».
    pub invite: Option<String>,
    /// Comment atteindre un choix (chiffres, ou curseur à déplacer).
    pub navigation: Navigation,
}

/// Retire le filet de rendu en début de ligne — **le filet, pas ce qui le
/// suit** : les espaces d'après portent l'INDENTATION, et c'est elle qui
/// distingue le détail d'un choix de la ligne d'invite.
fn sans_filet(ligne: &str) -> &str {
    let debut = ligne.trim_start_matches([' ', '\t']);
    let Some(premier) = debut.chars().next() else {
        return ligne;
    };
    match premier {
        '┃' | '│' | '|' => debut[premier.len_utf8()..].as_ref() as &str,
        _ => ligne,
    }
}

/// L'indentation d'une ligne, en caractères.
fn indentation(ligne: &str) -> usize {
    ligne.len() - ligne.trim_start().len()
}

/// Le curseur de Claude Code (`figures.pointer` d'Ink sur macOS).
const CURSEUR_CLAUDE: char = '❯';

/// La ligne d'un choix : curseur facultatif (`›` opencode/codex, `❯` Claude
/// Code), numéro 1-2 chiffres, `.` ou `)`, puis espaces, puis le corps.
///
/// ⚠️ Sans `❯`, la ligne SURLIGNÉE d'une question de Claude n'était pas un
/// choix : la liste commençait à 2, la numérotation était refusée, et la PWA
/// renvoyait l'utilisateur au clavier (retour du 2026-10-29).
fn ligne_choix(ligne: &str) -> Option<(bool, u64, &str)> {
    let mut reste = ligne.trim_start_matches([' ', '\t']);
    let selectionne = reste.starts_with('›') || reste.starts_with(CURSEUR_CLAUDE);
    if selectionne {
        reste = reste[reste.chars().next()?.len_utf8()..].trim_start_matches([' ', '\t']);
    }
    let chiffres: String = reste.chars().take_while(char::is_ascii_digit).collect();
    if chiffres.is_empty() || chiffres.len() > 2 {
        return None;
    }
    let numero: u64 = chiffres.parse().ok()?;
    let apres_chiffres = &reste[chiffres.len()..];
    let suivant = apres_chiffres.chars().next()?;
    if suivant != '.' && suivant != ')' {
        return None;
    }
    let corps = apres_chiffres[suivant.len_utf8()..].trim_start_matches([' ', '\t']);
    if corps.is_empty() {
        return None;
    }
    Some((selectionne, numero, corps))
}

/// La ligne d'aide du sélecteur — ⚠️ **`↑↓` existe aussi, sans barre
/// oblique** (mesuré sur opencode : une seule forme reconnue perdait
/// l'invite sur un autre agent).
fn est_ligne_invite(ligne: &str) -> bool {
    let debut = ligne.trim_start_matches([' ', '\t']);
    let basse = debut.to_lowercase();
    basse.starts_with("enter") || basse.starts_with("↑/↓") || basse.starts_with("↑↓")
}

/// `Field 1/1` — la position dans une suite de questions.
fn est_ligne_champ(ligne: &str) -> bool {
    let debut = ligne.trim_start_matches([' ', '\t']).to_lowercase();
    let suite = match debut.strip_prefix("field") {
        Some(suite) => suite,
        None => return false,
    };
    let apres_espaces = suite.trim_start_matches([' ', '\t']);
    let chiffres = apres_espaces
        .chars()
        .take_while(char::is_ascii_digit)
        .count();
    if chiffres == 0 {
        return false;
    }
    let reste = &apres_espaces[chiffres..];
    let reste = reste.trim_start_matches([' ', '\t']);
    let Some(reste) = reste.strip_prefix('/') else {
        return false;
    };
    let apres_barre = reste
        .trim_start_matches(' ')
        .trim_start_matches([' ', '\t']);
    !apres_barre.is_empty()
        && apres_barre
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit())
}

/// `Clé: valeur` — le contexte d'une invite (`App: Zen`).
fn est_ligne_contexte(ligne: &str) -> bool {
    let debut = ligne.trim_start_matches([' ', '\t']);
    let Some(premier) = debut.chars().next() else {
        return false;
    };
    if !premier.is_ascii_alphabetic() {
        return false;
    }
    let Some(deux_points) = debut.find(':') else {
        return false;
    };
    if deux_points - 1 > 24 + premier.len_utf8() {
        return false;
    }
    for caractere in debut[1..deux_points].chars() {
        if !caractere.is_alphanumeric() && !" ._ -".contains(caractere) {
            return false;
        }
    }
    let apres = debut[deux_points + 1..].trim_start_matches([' ', '\t']);
    !apres.is_empty()
}

/// Sépare libellé et détail : le détail commence à la **dernière** suite de
/// deux espaces ou plus qui laisse un texte des deux côtés (les libellés
/// sont alignés à droite ; « Allow for this session » est un libellé, pas
/// deux champs — un espace seul ne sépare pas).
fn separer_libelle(brut: &str) -> (String, Option<String>) {
    let texte = brut.trim_end();
    let octets = texte.as_bytes();
    let mut meilleur: Option<usize> = None;
    let mut index = 0_usize;
    while index < octets.len() {
        if octets[index] == b' ' || octets[index] == b'\t' {
            let debut_trou = index;
            while index < octets.len() && (octets[index] == b' ' || octets[index] == b'\t') {
                index += 1;
            }
            if index - debut_trou >= 2 && debut_trou > 0 && index < texte.len() {
                meilleur = Some(debut_trou);
            }
        } else {
            index += 1;
        }
    }
    match meilleur {
        None => (texte.trim().to_string(), None),
        Some(trou) => {
            let libelle = texte[..trou].trim().to_string();
            if libelle.is_empty() {
                return (texte.trim().to_string(), None);
            }
            let detail = texte[trou..].trim().to_string();
            if detail.is_empty() {
                (libelle, None)
            } else {
                (libelle, Some(detail))
            }
        }
    }
}

/// La chaîne que **opencode ajoute lui-même** pour la saisie libre —
/// relevée dans son bundle (2.0.23) : la reconnaître sert à ne PAS
/// l'envoyer comme un choix (le choisir ouvre un champ texte).
pub const OPTION_SAISIE_LIBRE: &str = "Type your own answer";

/// Les saisies libres de Claude Code (`AskUserQuestion`, 2.1.312) : « Type
/// something. » (choix unique), « Type something » (choix multiple).
pub const OPTIONS_SAISIE_LIBRE_CLAUDE: [&str; 2] = ["Type something.", "Type something"];

/// Un libellé de choix est-il une option de saisie libre (opencode, Claude) ?
#[must_use]
pub fn est_option_saisie_libre(libelle: &str) -> bool {
    let libelle = libelle.trim();
    libelle == OPTION_SAISIE_LIBRE || OPTIONS_SAISIE_LIBRE_CLAUDE.contains(&libelle)
}

/// Lit la question affichée sur un écran de terminal — `None` si rien ne
/// s'y lit (un écran non reconnu n'émet AUCUNE action).
#[must_use]
pub fn question_de_l_ecran(ecran: &str) -> Option<Question> {
    let lignes: Vec<&str> = ecran.split('\n').map(sans_filet).collect();
    let numerotees: Vec<usize> = (0..lignes.len())
        .filter(|index| ligne_choix(lignes[*index]).is_some())
        .collect();
    if numerotees.is_empty() {
        return question_a_fleches(&lignes);
    }
    let numero_de = |index: usize| ligne_choix(lignes[index]).map(|(_, numero, _)| numero);

    // La suite CONTIGUË qui se termine sur le dernier choix — le « moins
    // un exactement » borne la remontée : une liste numérotée plus haut
    // (une sortie d'outil) ne continue pas la numérotation.
    let mut debut = numerotees.len() - 1;
    while debut > 0 {
        let courant = numero_de(numerotees[debut]);
        let precedent = numero_de(numerotees[debut - 1]);
        match (courant, precedent) {
            (Some(courant), Some(precedent)) if courant > 0 && precedent == courant - 1 => {
                debut -= 1;
            }
            _ => break,
        }
    }
    let retenues = &numerotees[debut..];
    let premier = retenues[0];

    let mut choix: Vec<Choix> = Vec::new();
    for &index in retenues {
        let (selectionne, numero, corps) = ligne_choix(lignes[index])?;
        let (libelle, detail_meme_ligne) = separer_libelle(corps);
        // ⚠️ Le détail peut être sur la LIGNE SUIVANTE, indentée plus
        // profond que le choix — deux garde-fous : plus indentée, et pas
        // une ligne de choix ni d'invite (sans le second, `enter to
        // submit` devenait le détail du dernier choix).
        let sur_la_suivante = match lignes.get(index + 1) {
            Some(suivante)
                if detail_meme_ligne.is_none()
                    && !suivante.trim().is_empty()
                    && ligne_choix(suivante).is_none()
                    && !est_ligne_invite(suivante)
                    && indentation(suivante) > indentation(lignes[index]) =>
            {
                Some(suivante.trim().to_string())
            }
            _ => None,
        };
        choix.push(Choix {
            detail: detail_meme_ligne.or(sur_la_suivante),
            libelle,
            numero,
            selectionne,
        });
    }
    // Une liste sans numérotation cohérente n'est pas une invite : c'est
    // une sortie d'outil qui contient des « 1. », « 2. ».
    if choix.len() < 2 {
        return None;
    }
    for (rang, choix) in choix.iter().enumerate() {
        if choix.numero != (rang + 1) as u64 {
            return None;
        }
    }

    // Contexte et question : les lignes qui précèdent la liste.
    let mut avant: Vec<String> = Vec::new();
    let mut index = premier;
    while index > 0 {
        index -= 1;
        let ligne = lignes[index];
        let propre = ligne.trim();
        if propre.is_empty() {
            if !avant.is_empty() {
                avant.insert(0, String::new());
            }
            continue;
        }
        avant.insert(0, propre.to_string());
        if !est_ligne_champ(ligne) && !est_ligne_contexte(ligne) {
            break;
        }
    }
    let mut texte: Option<String> = None;
    let mut contexte: Vec<String> = Vec::new();
    for ligne in &avant {
        if texte.is_none() && !est_ligne_champ(ligne) && !est_ligne_contexte(ligne) {
            texte = Some(ligne.clone());
            continue;
        }
        if !ligne.is_empty() {
            contexte.push(ligne.clone());
        }
    }
    let mut texte = texte?;
    // ⚠️ Une longue question est REPLIÉE sur plusieurs lignes (Claude Code la
    // rend en paragraphe) : on ne gardait que sa dernière ligne. Les lignes
    // non vides juste au-dessus, jusqu'à la ligne vide, en font partie.
    if contexte.is_empty() {
        let mut index = premier;
        while index > 0 && lignes[index - 1].trim().is_empty() {
            index -= 1;
        }
        // `index` est sur la dernière ligne de la question ; on remonte au-delà.
        let mut haut = index.saturating_sub(1);
        let mut morceaux: Vec<String> = Vec::new();
        while haut > 0 {
            let precedente = lignes[haut - 1].trim();
            if precedente.is_empty()
                || precedente
                    .chars()
                    .all(|c| matches!(c, '─' | '━' | '═' | '-' | '╌'))
                || ligne_choix(lignes[haut - 1]).is_some()
                || est_ligne_invite(lignes[haut - 1])
                || est_ligne_champ(lignes[haut - 1])
            {
                break;
            }
            morceaux.insert(0, precedente.to_string());
            haut -= 1;
        }
        if !morceaux.is_empty() {
            morceaux.push(texte);
            texte = morceaux.join(" ");
        }
    }

    // L'invite de validation, après la liste.
    let invite = lignes[premier..]
        .iter()
        .find(|ligne| est_ligne_invite(ligne))
        .map(|ligne| ligne.trim().to_string());

    Some(Question {
        texte,
        contexte,
        choix,
        invite,
        navigation: Navigation::Chiffres,
    })
}

/// Le numéro est-il un choix **réellement proposé** ? — la garde qui empêche
/// d'envoyer une décision qui n'existe pas.
#[must_use]
pub fn numero_offert(choix: &[Choix], numero: i64) -> bool {
    // Un i64 positif tient dans un u64 — le cast d'u64::MAX en i64 donnait
    // -1 : la borne haute fausse rendait TOUTE offre fausse.
    numero >= 0 && choix.iter().any(|c| c.numero == numero as u64)
}

/// Le résumé de la question en valeur affichable (diagnostic).
#[must_use]
pub fn en_resume(question: &Question) -> Value {
    serde_json::json!({
        "texte": question.texte,
        "choix": question.choix.iter().map(|c| c.numero).collect::<Vec<u64>>(),
    })
}

/// Le curseur du sélecteur de pi (`extension-selector.js`, `select-list.js`).
const CURSEUR_PI: &str = "→ ";

/// Une question à choix NON numérotés (sélecteur des extensions de pi) :
///
/// ```text
///  Titre
///
///  Description
///
///  → Option A
///    Option B
///
///  ↑↓ navigate  enter select  esc cancel
/// ```
///
/// Les numéros sont ceux de l'ordre affiché ; la réponse déplace le curseur
/// (`Navigation::Fleches`) au lieu de frapper un chiffre.
fn question_a_fleches(lignes: &[&str]) -> Option<Question> {
    // La DERNIÈRE ligne d'aide « ↑↓ navigate » : l'invite courante.
    let aide = (0..lignes.len()).rev().find(|index| {
        let basse = lignes[*index].trim().to_lowercase();
        basse.starts_with("↑↓") && basse.contains("navigate")
    })?;
    // Le bloc d'options : les lignes non vides juste au-dessus de l'aide.
    let mut fin = aide;
    while fin > 0 && lignes[fin - 1].trim().is_empty() {
        fin -= 1;
    }
    let mut debut = fin;
    while debut > 0 && !lignes[debut - 1].trim().is_empty() {
        debut -= 1;
    }
    let bloc = &lignes[debut..fin];
    let curseurs = bloc
        .iter()
        .filter(|ligne| ligne.trim_start().starts_with(CURSEUR_PI))
        .count();
    if bloc.len() < 2 || curseurs != 1 {
        return None;
    }
    let choix: Vec<Choix> = bloc
        .iter()
        .enumerate()
        .map(|(rang, ligne)| {
            let propre = ligne.trim_start();
            let selectionne = propre.starts_with(CURSEUR_PI);
            let libelle = propre
                .strip_prefix(CURSEUR_PI)
                .unwrap_or(propre)
                .trim()
                .to_string();
            Choix {
                libelle,
                detail: None,
                numero: (rang + 1) as u64,
                selectionne,
            }
        })
        .collect();
    // Le texte : les paragraphes au-dessus (titre, puis description), jusqu'au
    // cadre (`────`) ou au haut de l'écran.
    let mut paragraphes: Vec<String> = Vec::new();
    let mut courant: Vec<String> = Vec::new();
    let mut index = debut;
    while index > 0 {
        index -= 1;
        let propre = lignes[index].trim();
        if propre.chars().all(|c| matches!(c, '─' | '━' | '═')) && !propre.is_empty() {
            break;
        }
        if propre.is_empty() {
            if !courant.is_empty() {
                paragraphes.insert(0, courant.join(" "));
                courant.clear();
                // Titre et description, pas plus : sans cadre, on ne remonte
                // jamais dans la conversation.
                if paragraphes.len() == 2 {
                    break;
                }
            }
            continue;
        }
        courant.insert(0, propre.to_string());
    }
    if !courant.is_empty() {
        paragraphes.insert(0, courant.join(" "));
    }
    let texte = paragraphes.join(" — ");
    if texte.is_empty() {
        return None;
    }
    Some(Question {
        texte,
        contexte: Vec::new(),
        choix,
        invite: Some(lignes[aide].trim().to_string()),
        navigation: Navigation::Fleches,
    })
}
