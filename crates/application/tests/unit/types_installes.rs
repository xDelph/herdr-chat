//! Les types lançables (T051) : la politique du lancement — installé ET
//! lisible, une seule liste pour le menu et pour le refus.

use application::types_installes::{
    ErreurInventaire, InventaireTypes, RefusType, TypeInstalle, types_lancables, verifie_type,
};

/// La découverte scriptée : une liste, ou une panne nommée.
struct Inventaire {
    types: Vec<TypeInstalle>,
    panne: Option<ErreurInventaire>,
}

impl Inventaire {
    fn avec(types: Vec<TypeInstalle>) -> Self {
        Self { types, panne: None }
    }

    fn en_panne(detail: &str) -> Self {
        Self {
            types: Vec::new(),
            panne: Some(ErreurInventaire::Indisponible {
                detail: String::from(detail),
            }),
        }
    }
}

impl InventaireTypes for Inventaire {
    fn installes(&self) -> Result<Vec<TypeInstalle>, ErreurInventaire> {
        match &self.panne {
            Some(panne) => Err(panne.clone()),
            None => Ok(self.types.clone()),
        }
    }
}

fn type_installe(commande: &str, cible: &str, installe: bool) -> TypeInstalle {
    TypeInstalle {
        commande: String::from(commande),
        cible: String::from(cible),
        installe,
    }
}

#[test]
fn installe_ne_veut_pas_dire_lisible() {
    // cursor démarre chez Herdr, mais n'expose aucun chemin de session :
    // présent et muet, donc PAS proposé (U14).
    let inventaire = Inventaire::avec(vec![
        type_installe("pi", "pi", true),
        type_installe("cursor-agent", "cursor", true),
    ]);
    let lancables = types_lancables(&inventaire.types);
    assert_eq!(lancables.len(), 1);
    assert_eq!(lancables[0].kind, "pi");
}

#[test]
fn un_type_non_installe_est_ecarte() {
    let inventaire = Inventaire::avec(vec![type_installe("gemini", "gemini", false)]);
    assert!(types_lancables(&inventaire.types).is_empty());
}

#[test]
fn la_commande_connue_donne_le_kind_sinon_la_cible() {
    // `pi` est une commande du vocabulaire : le kind est la commande.
    // `cursor-agent` n'en est pas une : le kind est la cible (`cursor`).
    assert_eq!(type_installe("pi", "pi", true).kind(), "pi");
    assert_eq!(type_installe("claude", "claude", true).kind(), "claude");
    assert_eq!(
        type_installe("cursor-agent", "cursor", true).kind(),
        "cursor"
    );
    // Un alias sans entree au vocabulaire : la cible tranche.
    assert_eq!(type_installe("claude-cli", "claude", true).kind(), "claude");
}

#[test]
fn le_refus_nomme_les_types_offerts() {
    let inventaire = Inventaire::avec(vec![
        type_installe("pi", "pi", true),
        type_installe("claude", "claude", true),
        type_installe("cursor-agent", "cursor", true),
    ]);
    match verifie_type(&inventaire, "gemini") {
        Err(RefusType::Inconnu { kind, offerts }) => {
            assert_eq!(kind, "gemini");
            // L'indice nomme les commandes réellement offertes — cursor n'y
            // est pas (illisible), gemini non plus (absent).
            assert_eq!(offerts, "pi, claude");
        }
        autre => panic!("un type inconnu est un refus nommé : {autre:?}"),
    }
}

#[test]
fn un_type_lancable_passe() {
    let inventaire = Inventaire::avec(vec![type_installe("pi", "pi", true)]);
    let lancable = verifie_type(&inventaire, "pi")
        .unwrap_or_else(|refus| panic!("pi est lançable : {refus:?}"));
    assert_eq!(lancable.kind, "pi");
    assert_eq!(lancable.commande, "pi");
}

#[test]
fn une_decouverte_en_panne_est_un_refus_a_part() {
    // « Je ne sais pas » n'est pas « ce type n'existe pas » : le lancement
    // refuse AVANT de créer un onglet, avec la cause réelle.
    let inventaire = Inventaire::en_panne("integration.list a échoué");
    match verifie_type(&inventaire, "pi") {
        Err(RefusType::Decouverte { detail }) => {
            assert_eq!(detail, "integration.list a échoué");
        }
        autre => panic!("une découverte en panne est nommée : {autre:?}"),
    }
}
