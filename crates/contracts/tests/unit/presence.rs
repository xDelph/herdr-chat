//! Les quatre présences du fil, une par une — jamais confondues.

use contracts::presence::{Field, Nullable};
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
struct ObligatoireNullable {
    valeur: Nullable<String>,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
struct Omissible {
    #[serde(default, skip_serializing_if = "Field::est_absente")]
    champ: Field<String>,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
struct OmissibleNullable {
    #[serde(
        default,
        deserialize_with = "contracts::presence::optionnel_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    champ: Option<Nullable<String>>,
}

#[test]
fn le_nullable_obligatoire_refuse_le_champ_absent() {
    match serde_json::from_str::<ObligatoireNullable>("{\"valeur\": null}") {
        Ok(decode) => match decode.valeur {
            Nullable::Nulle => (),
            autre => panic!("null mesuré attendu, pas {autre:?}"),
        },
        Err(cause) => panic!("null explicite doit décoder en Nulle : {cause}"),
    }
    if serde_json::from_str::<ObligatoireNullable>("{}").is_ok() {
        panic!("un champ Nullable absent doit être refusé — obligatoire");
    }
    match serde_json::from_str::<ObligatoireNullable>("{\"valeur\": \"présente\"}") {
        Ok(decode) => {
            assert!(
                decode.valeur.as_option() == Some(&String::from("présente")),
                "la valeur passe"
            );
        }
        Err(cause) => panic!("valeur simple doit décoder : {cause}"),
    }
    // Sérialisation : Nulle → null sur le fil, jamais une absence.
    let nulle = ObligatoireNullable {
        valeur: Nullable::Nulle,
    };
    match serde_json::to_value(&nulle) {
        Ok(valeur) => assert!(
            valeur == serde_json::json!({ "valeur": null }),
            "Nulle se sérialise en null explicite, pas {valeur}"
        ),
        Err(cause) => panic!("sérialisation refusée : {cause}"),
    }
}

#[test]
fn l_omissible_refuse_le_null_explicite() {
    // absent → Field vide, sans erreur.
    match serde_json::from_str::<Omissible>("{}") {
        Ok(decode) => assert!(decode.champ.est_absente(), "absent = champ vide, un fait"),
        Err(cause) => panic!("champ absent doit passer : {cause}"),
    }
    // null explicite → refus — c'est la distinction du schéma TS.
    match serde_json::from_str::<Omissible>("{\"champ\": null}") {
        Ok(_) => panic!("null explicite doit être refusé sur un champ optionnel"),
        Err(cause) => assert!(
            cause.to_string().contains("null"),
            "le motif dit pourquoi : {cause}"
        ),
    }
    // valeur → présente.
    match serde_json::from_str::<Omissible>("{\"champ\": \"là\"}") {
        Ok(decode) => {
            assert!(
                decode.champ.as_option() == Some(&String::from("là")),
                "la valeur passe"
            );
        }
        Err(cause) => panic!("valeur simple doit décoder : {cause}"),
    }
    // Sérialisation : absent → le champ n'apparaît pas (pas de null inventé).
    let absent = Omissible { champ: Field(None) };
    match serde_json::to_value(&absent) {
        Ok(valeur) => assert!(
            valeur == serde_json::json!({}),
            "absent = champ omis, pas {valeur}"
        ),
        Err(cause) => panic!("sérialisation refusée : {cause}"),
    }
}

#[test]
fn l_omissible_nullable_porte_les_trois_etats() {
    // absent → None.
    match serde_json::from_str::<OmissibleNullable>("{}") {
        Ok(decode) => assert!(decode.champ.is_none(), "absent = None"),
        Err(cause) => panic!("champ absent doit passer : {cause}"),
    }
    // null → Some(Nulle) — le point exact où l'Option de serde se tromperait.
    match serde_json::from_str::<OmissibleNullable>("{\"champ\": null}") {
        Ok(decode) => match decode.champ {
            Some(Nullable::Nulle) => (),
            autre => panic!("null mesuré attendu, pas {autre:?}"),
        },
        Err(cause) => panic!("null explicite doit passer sur un champ nullable : {cause}"),
    }
    // valeur → Some(Valeur).
    match serde_json::from_str::<OmissibleNullable>("{\"champ\": \"valeur\"}") {
        Ok(decode) => match decode.champ {
            Some(Nullable::Valeur(texte)) => {
                assert!(texte == "valeur", "la valeur passe, pas {texte}");
            }
            autre => panic!("valeur mesurée attendue, pas {autre:?}"),
        },
        Err(cause) => panic!("valeur simple doit décoder : {cause}"),
    }
    // Sérialisation : None → omis ; Some(Nulle) → null présent.
    let absent = OmissibleNullable { champ: None };
    let nulle = OmissibleNullable {
        champ: Some(Nullable::Nulle),
    };
    match (serde_json::to_value(&absent), serde_json::to_value(&nulle)) {
        (Ok(absent), Ok(nulle)) => {
            assert!(
                absent == serde_json::json!({}),
                "absent = omis, pas {absent}"
            );
            assert!(
                nulle == serde_json::json!({"champ": null}),
                "null = présent, pas {nulle}"
            );
        }
        (Err(cause), _) | (_, Err(cause)) => panic!("sérialisation refusée : {cause}"),
    }
}

#[test]
fn les_schemas_refletent_les_presences() {
    use schemars::JsonSchema;
    use schemars::generate::SchemaGenerator;
    let mut generateur = SchemaGenerator::default();
    // Nullable : valeur ou null — les deux sur le fil.
    let schema_nullable = <Nullable<String>>::json_schema(&mut generateur);
    let texte =
        serde_json::to_string(&schema_nullable).unwrap_or_else(|cause| panic!("schéma : {cause}"));
    assert!(
        texte.contains("null"),
        "Nullable accepte null au schéma : {texte}"
    );
    // Field : le schéma de T SANS null — l'absence est une clé omise.
    let schema_field = <Field<String>>::json_schema(&mut generateur);
    let texte =
        serde_json::to_string(&schema_field).unwrap_or_else(|cause| panic!("schéma : {cause}"));
    assert!(
        !texte.contains("null"),
        "Field refuse null au schéma : {texte}"
    );
    assert!(
        texte.contains("string"),
        "Field porte le schéma de sa valeur : {texte}"
    );
}
