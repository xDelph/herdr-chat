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
//! `Option<T>` de Rust ne porte que deux états — et son schéma JSON inclut
//! null, ce que le schéma TS refuse pour l'omissible. D'où :
//!
//! - [`Field<T>`] — le champ **omissible** : un newtype sur `Option<T>` dont
//!   le schéma JSON est **celui de `T` sans null** (l'absence s'écrit par
//!   clé omise, jamais par null) — décodeur et sérialiseur manuels ;
//! - [`Nullable<T>`] — le champ **présent-nullable** : schéma
//!   `anyOf [T, null]`, et **non listé dans `required`** seulement s'il est
//!   composé — seul, un champ `Nullable` absent reste une erreur ;
//! - le quatrième cas se compose : `Option<Nullable<T>>` (absent, null, ou
//!   valeur) avec [`optionnel_nullable`].

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Une valeur **présente** qui peut valoir null — l'homologue exact de
/// `Schema.NullOr(Schema.X)`.
///
/// ⚠️ Distinction portée jusqu'au fil : [`Nullable::Nulle`] se sérialise en
/// `null` (jamais en absence) et se décode depuis `null` (jamais depuis un
/// champ manquant — sans `default` serde, un champ absent est une erreur).
///
/// ⚠️ Le décodage passe par `serde_json::Value` (deserialize_any), PAS par
/// `deserialize_option` : le `missing_field` de serde délègue à
/// `deserialize_option` — un champ absent deviendrait silencieusement
/// `Nulle`. Via `Value`, un champ absent reste une erreur (obligatoire),
/// un null explicite devient `Nulle`, une valeur délègue à `T`.
///
/// ⚠️ `#[serde(untagged)]` est là pour **schemars** uniquement (les impls
/// serde sont manuels) : le schéma exporté est `anyOf [T, null]` — la
/// représentation réelle, pas la représentation par défaut étiquetée.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, schemars::JsonSchema)]
#[serde(untagged)]
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

/// Un champ **omissible** : absent ou valeur, **null refusé** — l'homologue
/// exact de `Schema.optional(Schema.X)`.
///
/// ⚠️ Newtype (pas un alias d'`Option`) précisément pour que le **schéma
/// JSON soit celui de `T`, sans null** : sur le fil, l'absence s'écrit par
/// clé omise ([`est_absente`] est le prédicat de `skip_serializing_if`), et
/// un null explicite est un refus de décodage. Composez avec [`Nullable`]
/// pour l'omissible-et-nullable.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Field<T>(pub Option<T>);
impl<T> Field<T> {
    /// Absent — pour le `skip_serializing_if`.
    pub fn est_absente(&self) -> bool {
        self.0.is_none()
    }

    /// La valeur, s'il y en a une.
    #[must_use]
    pub fn as_option(&self) -> Option<&T> {
        self.0.as_ref()
    }

    /// La valeur par valeur.
    #[must_use]
    pub fn en_option(self) -> Option<T> {
        self.0
    }

    /// Depuis l'`Option` du domaine — absent reste absent.
    #[must_use]
    pub fn de_option(valeur: Option<T>) -> Self {
        Self(valeur)
    }
}

impl<T> Default for Field<T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<T: Serialize> Serialize for Field<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match &self.0 {
            Some(valeur) => serializer.serialize_some(valeur),
            // Inatteignable quand la clé est sautée ; sinon : null explicite,
            // refusé à la lecture — on ne l'écrit jamais nous-mêmes.
            None => serializer.serialize_none(),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visiteur<T> {
            fantome: std::marker::PhantomData<T>,
        }
        impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visiteur<T> {
            type Value = Field<T>;
            fn expecting(&self, formateur: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formateur.write_str("a value or an absence — null refused for an optional field")
            }
            fn visit_some<D: Deserializer<'de>>(
                self,
                deserializer: D,
            ) -> Result<Field<T>, D::Error> {
                T::deserialize(deserializer).map(|valeur| Field(Some(valeur)))
            }
            fn visit_none<E: serde::de::Error>(self) -> Result<Field<T>, E> {
                Err(E::custom(
                    "explicit null refused: an optional field is absent or has a value",
                ))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Field<T>, E> {
                Err(E::custom(
                    "explicit null refused: an optional field is absent or has a value",
                ))
            }
        }
        deserializer.deserialize_option(Visiteur {
            fantome: std::marker::PhantomData,
        })
    }
}

impl<T: schemars::JsonSchema> schemars::JsonSchema for Field<T> {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        T::schema_name()
    }

    fn json_schema(generateur: &mut schemars::generate::SchemaGenerator) -> schemars::Schema {
        // L'absence s'écrit par clé omise : le schéma d'un champ omissible
        // est **exactement** celui de sa valeur — sans null.
        T::json_schema(generateur)
    }
}

/// Décodeur de champ **omissible et nullable** : absent → `Field::default()`
/// (avec `default`), null → `Some(Nullable::Nulle)`, valeur →
/// `Some(Nullable::Valeur)`. ⚠️ Le `Option` de serde par défaut confond null
/// et absence — c'est précisément ce que ce décodeur refuse de faire.
pub fn optionnel_nullable<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Nullable<T>>, D::Error> {
    struct Visiteur<T> {
        fantome: std::marker::PhantomData<T>,
    }
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visiteur<T> {
        type Value = Option<Nullable<T>>;
        fn expecting(&self, formateur: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formateur.write_str("a value, null, or an absence — three distinct cases")
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
