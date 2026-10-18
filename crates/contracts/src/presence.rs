//! Présence et nullabilité **exactes** — les quatre cas du fil, jamais confondus.
//!
//! Le schéma TS (Effect Schema) distingue par champ :
//!
//! - `Schema.X` — **obligatoire** : présent, jamais null ;
//! - `Schema.optional(Schema.X)` — **omissible** : absent ou valeur, **null refusé** ;
//! - `Schema.NullOr(Schema.X)` — **nullable obligatoire** : présent, peut valoir null ;
//! - `Schema.optional(Schema.NullOr(Schema.X))` — **omissible et nullable** :
//!   absent, null, ou valeur.
//!
//! `Option<T>` de Rust ne porte que deux états. Ici :
//!
//! - [`Nullable<T>`] porte « présent, peut être null » — un champ **obligatoire**
//!   nullable (pas de `default` serde : un champ manquant est une erreur) ;
//! - [`Field<T>`] (alias de `Option<T>`) porte « absent ou valeur », avec le
//!   décodeur [`refuse_null`] qui **refuse le null explicite** ;
//! - le quatrième cas se compose : `Option<Nullable<T>>` avec [`optionnel_nullable`].

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Une valeur **présente** qui peut valoir null — l'homologue exact de
/// `Schema.NullOr(Schema.X)`.
///
/// ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
/// `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
/// champ manquant — sans `default` serde, un champ absent est une erreur).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Nullable<T> {
    Valeur(T),
    Nulle,
}

impl<T> Nullable<T> {
    /// La valeur, s'il y en a une — `None` pour un null mesuré.
    #[must_use]
    pub fn as_option(&self) -> Option<&T> {
        match self {
            Nullable::Valeur(valeur) => Some(valeur),
            Nullable::Nulle => None,
        }
    }

    /// La valeur par valeur — pour les conversions vers le domaine.
    #[must_use]
    pub fn en_option(self) -> Option<T> {
        match self {
            Nullable::Valeur(valeur) => Some(valeur),
            Nullable::Nulle => None,
        }
    }

    /// Depuis l'`Option` du domaine — la distinction absence/null se perd
    /// **explicitement** (l'appelant sait qu'il aplati).
    #[must_use]
    pub fn de_option(valeur: Option<T>) -> Self {
        match valeur {
            Some(valeur) => Nullable::Valeur(valeur),
            None => Nullable::Nulle,
        }
    }
}

impl<T: Serialize> Serialize for Nullable<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Nullable::Valeur(valeur) => serializer.serialize_some(valeur),
            Nullable::Nulle => serializer.serialize_none(),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Nullable<T> {
    // ⚠️ On passe par `serde_json::Value` (deserialize_any), PAS par
    // `deserialize_option` : le `missing_field` de serde délègue à
    // `deserialize_option` — un champ absent deviendrait silencieusement
    // `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
    // un null explicite devient `Nulle`, une valeur délègue à `T`.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let valeur = serde_json::Value::deserialize(deserializer)?;
        match valeur {
            serde_json::Value::Null => Ok(Nullable::Nulle),
            autre => T::deserialize(autre)
                .map(Nullable::Valeur)
                .map_err(serde::de::Error::custom),
        }
    }
}

/// Un champ **omissible** : absent ou valeur. Alias d'`Option<T>` — le travail
/// est dans les décodeurs : [`refuse_null`] pour l'omissible simple (le null
/// explicite est un refus), [`optionnel_nullable`] pour l'omissible-et-nullable.
///
/// Usage attendu sur un champ omissible :
/// `#[serde(default, deserialize_with = "presence::refuse_null", skip_serializing_if = "Option::is_none")]`
pub type Field<T> = Option<T>;

/// Décodeur de champ **omissible** : absent → `None` (avec `default`), valeur →
/// `Some`, **null explicite → erreur** — la distinction mesurée du schéma TS
/// (`Schema.optional` refuse null).
pub fn refuse_null<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    struct Visiteur<T> {
        fantome: std::marker::PhantomData<T>,
    }
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visiteur<T> {
        type Value = Option<T>;
        fn expecting(&self, formateur: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formateur.write_str("une valeur ou une absence — null refusé pour un champ optionnel")
        }
        fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Option<T>, D::Error> {
            T::deserialize(deserializer).map(Some)
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Option<T>, E> {
            Err(E::custom(
                "null explicite refusé : un champ optionnel est absent ou a une valeur",
            ))
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Option<T>, E> {
            Err(E::custom(
                "null explicite refusé : un champ optionnel est absent ou a une valeur",
            ))
        }
    }
    deserializer.deserialize_option(Visiteur {
        fantome: std::marker::PhantomData,
    })
}

/// Décodeur de champ **omissible et nullable** : absent → `None` (avec
/// `default`), null → `Some(Nullable::Nulle)`, valeur → `Some(Nullable::Valeur)`.
/// ⚠️ Le `Option` de serde par défaut confond null et absence — c'est précisément
/// ce que ce décodeur refuse de faire.
pub fn optionnel_nullable<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Nullable<T>>, D::Error> {
    struct Visiteur<T> {
        fantome: std::marker::PhantomData<T>,
    }
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visiteur<T> {
        type Value = Option<Nullable<T>>;
        fn expecting(&self, formateur: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formateur.write_str("une valeur, null, ou une absence — trois cas distincts")
        }
        fn visit_some<D: Deserializer<'de>>(
            self,
            deserializer: D,
        ) -> Result<Option<Nullable<T>>, D::Error> {
            T::deserialize(deserializer).map(|valeur| Some(Nullable::Valeur(valeur)))
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Option<Nullable<T>>, E> {
            Ok(Some(Nullable::Nulle))
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Option<Nullable<T>>, E> {
            Ok(Some(Nullable::Nulle))
        }
    }
    deserializer.deserialize_option(Visiteur {
        fantome: std::marker::PhantomData,
    })
}
