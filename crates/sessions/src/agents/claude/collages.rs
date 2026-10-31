//! Les **collages** que Claude Code emballe dans la demande enregistrée.
//!
//! ⚠️ **Retour du 2026-10-31 : « souvent du double envoi de message côté
//! pwa ».** Herdr remet un prompt à Claude Code comme un **collage** ; un
//! collage de plusieurs lignes est écrit dans la session emballé :
//!
//! ```text
//! \n\n<pasted_content id="09c3">\n…le texte envoyé…\n</pasted_content id="09c3">\n
//! ```
//!
//! La demande arrivait telle quelle dans le fil, et la bulle d'envoi — qui
//! attend **le texte envoyé** — ne la reconnaissait jamais : elle restait sous
//! le message, qui semblait parti deux fois. Mesuré (lecture seule) : chaque
//! demande de plusieurs lignes envoyée depuis la PWA à Claude, aucune d'une
//! seule ligne.
//!
//! La règle est celle de Claude Code lui-même (2.1.314, `mbr`/`RIi`, lue dans
//! le binaire) : l'identifiant fait 4 caractères hexadécimaux minuscules, la
//! balise ouvrante est suivie d'un saut de ligne, la fermante (qui répète
//! l'identifiant) en est précédée ; au plus deux sauts de ligne autour du bloc
//! lui appartiennent. Le texte rendu joint les morceaux tapés et les corps des
//! collages par un saut de ligne, puis se rogne. Une forme qui ne suit pas la
//! règle reste intacte : rien n'est deviné.

const OUVRANTE: &str = "<pasted_content id=\"";
const FERMANTE: &str = "</pasted_content id=\"";
const FIN_OUVRANTE: &str = "\">\n";
const LONGUEUR_ID: usize = 4;

/// Un identifiant de collage : exactement 4 caractères `0-9a-f`.
fn identifiant_valide(id: &str) -> bool {
    id.len() == LONGUEUR_ID
        && id
            .bytes()
            .all(|octet| octet.is_ascii_digit() || (b'a'..=b'f').contains(&octet))
}

/// Le texte d'une demande, **sans** l'emballage de ses collages — le texte
/// tel que l'utilisateur l'a envoyé. Sans collage reconnu, le texte rendu est
/// l'original, octet pour octet.
#[must_use]
pub fn texte_sans_collages(texte: &str) -> String {
    let octets = texte.as_bytes();
    let mut morceaux: Vec<&str> = Vec::new();
    let mut avec_collage = false;
    // `consomme` : la fin de ce qui est déjà rangé ; `cherche` : d'où l'on
    // cherche la prochaine balise.
    let mut consomme = 0;
    let mut cherche = 0;
    while let Some(relatif) = texte.get(cherche..).and_then(|reste| reste.find(OUVRANTE)) {
        let debut = cherche + relatif;
        let apres_ouvrante = debut + OUVRANTE.len();
        let id = texte.get(apres_ouvrante..apres_ouvrante + LONGUEUR_ID);
        let Some(id) = id.filter(|id| {
            identifiant_valide(id)
                && texte
                    .get(apres_ouvrante + LONGUEUR_ID..)
                    .is_some_and(|reste| reste.starts_with(FIN_OUVRANTE))
        }) else {
            cherche = apres_ouvrante;
            continue;
        };
        let corps_debut = apres_ouvrante + LONGUEUR_ID + FIN_OUVRANTE.len();
        let fermante = format!("{FERMANTE}{id}\">");
        // La fermante est précédée d'un saut de ligne — celui qui finit la
        // balise ouvrante compte pour un corps vide.
        let Some(saut) = texte
            .get(corps_debut - 1..)
            .and_then(|reste| reste.find(&format!("\n{fermante}")))
        else {
            break;
        };
        let fermante_debut = corps_debut - 1 + saut + 1;
        let mut avant = debut;
        for _ in 0..2 {
            if avant > consomme && octets[avant - 1] == b'\n' {
                avant -= 1;
            }
        }
        if avant > consomme {
            morceaux.push(&texte[consomme..avant]);
        }
        consomme = fermante_debut + fermante.len();
        for _ in 0..2 {
            if octets.get(consomme) == Some(&b'\n') {
                consomme += 1;
            }
        }
        morceaux.push(texte.get(corps_debut..fermante_debut - 1).unwrap_or(""));
        avec_collage = true;
        cherche = consomme;
    }
    if !avec_collage {
        return texte.to_string();
    }
    if consomme < texte.len() {
        morceaux.push(&texte[consomme..]);
    }
    morceaux.join("\n").trim().to_string()
}
