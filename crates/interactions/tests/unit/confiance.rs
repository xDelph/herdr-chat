//! L'invite de confiance (T037) : la phrase mesurée se reconnaît, un autre
//! dialogue non — et la détection ne répond jamais.

use interactions::confiance::est_invite_confiance;

#[test]
fn la_phrase_mesuree_se_reconnait() {
    // La forme exacte relevée sur un pane réel (codex, dossier non approuvé).
    let ecran = "Trust this folder?\n\nFolder settings can run code automatically, even without a model request.\n1. Yes, I trust this folder\n2. No, exit\n";
    assert!(est_invite_confiance(ecran), "l'invite est à l'écran");
}

#[test]
fn la_phrase_est_insensible_a_la_casse() {
    assert!(
        est_invite_confiance("Please TRUST THIS FOLDER before continuing."),
        "la casse ne change pas le sens"
    );
    assert!(
        est_invite_confiance("trust this directory"),
        "le second marqueur mesuré passe"
    );
}

#[test]
fn un_autre_dialogue_n_est_pas_une_invite_de_confiance() {
    // Un agent bloqué sur n'importe quelle AUTRE question : pas de confiance.
    for ecran in [
        "Do you want to execute this code?\n1. Allow once\n2. Deny\n",
        "blocked and requires interactive input",
        "",
        "Trust this terminal?",
        "folder",
    ] {
        assert!(
            !est_invite_confiance(ecran),
            "«{ecran}» ne nomme pas l'invite de confiance"
        );
    }
}

#[test]
fn la_detection_ne_repond_jamais() {
    // Le contrat de ce module : il ne produit que la décision — aucune
    // touche, aucune réponse ne peut sortir d'ici (pas de fonction d'envoi).
    assert!(
        est_invite_confiance("Trust this folder?"),
        "la détection rend une valeur, rien d'autre"
    );
}
