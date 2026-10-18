//! Le réducteur de métadonnées (T026/D18–D22) : cohérent pour les cinq
//! profils, la fusion préserve, les placeholders exclus, l'isolement.

use serde_json::{Value, json};
use sessions::agents::opencode::moteur::EntreeBrute;
use sessions::metadata::{CAPACITE_CACHE, CacheResumes, iso_vers_ms, reduis};

fn entree(genre: &str, brut: Value, timestamp: Option<&str>) -> EntreeBrute {
    EntreeBrute {
        id: None,
        parent_id: None,
        brut: brut.to_string(),
        timestamp: timestamp.map(str::to_string),
        genre: genre.to_string(),
    }
}

#[test]
fn le_resume_porte_les_dernieres_valeurs() {
    // La demande de l'utilisateur (pas la réponse), l'aperçu assistant,
    // le dernier horodatage — remontées du fil.
    let entrees = [
        entree(
            "message",
            json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "première demande" }] } }),
            Some("2026-10-16T12:00:00.000Z"),
        ),
        entree(
            "message",
            json!({ "message": { "role": "assistant", "content": [{ "type": "text", "text": "je regarde" }] } }),
            Some("2026-10-16T12:00:05.000Z"),
        ),
        entree(
            "message",
            json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "la demande FINALE" }] } }),
            Some("2026-10-16T12:00:10.000Z"),
        ),
    ];
    let resume = reduis(&entrees);
    assert!(
        resume.dernier_prompt.as_deref() == Some("la demande FINALE"),
        "la DEMANDE, pas la réponse : {:?}",
        resume.dernier_prompt
    );
    assert!(
        resume.apercu.as_deref() == Some("je regarde"),
        "l'aperçu = le dernier texte assistant : {:?}",
        resume.apercu
    );
    assert!(
        resume.horodatage_ms == iso_vers_ms("2026-10-16T12:00:10.000Z"),
        "le dernier horodatage connu : {:?}",
        resume.horodatage_ms
    );
}

#[test]
fn un_agent_bloque_montre_son_outil() {
    // Un agent bloqué n'a souvent rien DIT : l'aperçu retombe sur le
    // dernier appel d'outil — nom + indice (mesuré sur codex en attente).
    let entrees = [entree(
        "message",
        json!({ "message": { "role": "assistant", "content": [
                { "type": "toolCall", "id": "c1", "name": "edit", "arguments": { "path": "src/x.ts" } },
            ] } }),
        Some("2026-10-16T12:00:05.000Z"),
    )];
    let resume = reduis(&entrees);
    assert!(
        resume.apercu.as_deref() == Some("edit · src/x.ts"),
        "le repli outil : {:?}",
        resume.apercu
    );
    // Sans indice lisible : le nom seul.
    let entrees = [entree(
        "message",
        json!({ "message": { "role": "assistant", "content": [
            { "type": "toolCall", "id": "c1", "name": "bash", "arguments": {} },
        ] } }),
        None,
    )];
    let resume = reduis(&entrees);
    assert!(
        resume.apercu.as_deref() == Some("bash"),
        "le nom seul : {:?}",
        resume.apercu
    );
    // Le JSON ne se déverse JAMAIS dans l'aperçu (80 caractères max, la
    // première ligne).
    let entrees = [entree(
        "message",
        json!({ "message": { "role": "assistant", "content": [
            { "type": "toolCall", "id": "c1", "name": "edit", "arguments": "ligne une\nligne deux" },
        ] } }),
        None,
    )];
    let resume = reduis(&entrees);
    assert!(
        resume.apercu.as_deref() == Some("edit · ligne une"),
        "la première ligne seule : {:?}",
        resume.apercu
    );
}

#[test]
fn la_paire_modele_fournisseur_est_une_paire() {
    // D22 : le fournisseur d'un changement plus ancien ne décrirait pas le
    // modèle du message — la paire vient du MÊME endroit.
    let entrees = [
        entree(
            "model_change",
            json!({ "modelId": "ancien", "provider": "vieux-fournisseur" }),
            None,
        ),
        entree(
            "message",
            json!({ "message": { "role": "assistant", "model": "nouveau", "content": [] } }),
            None,
        ),
    ];
    let (modele, fournisseur, _) = sessions::metadata::reglages_de(&entrees);
    assert!(
        modele.as_deref() == Some("nouveau"),
        "le plus récent gagne : {modele:?}"
    );
    assert!(
        fournisseur.is_none(),
        "le vieux fournisseur ne colle pas au nouveau modèle : {fournisseur:?}"
    );
    // Le message qui donne LES DEUX : la paire complète.
    let entrees = [entree(
        "message",
        json!({ "message": { "role": "assistant", "model": "m-1", "provider": "p-1", "content": [] } }),
        None,
    )];
    let (modele, fournisseur, _) = sessions::metadata::reglages_de(&entrees);
    assert!(modele.as_deref() == Some("m-1") && fournisseur.as_deref() == Some("p-1"));
    // Le changement porte SA paire.
    let entrees = [entree(
        "model_change",
        json!({ "modelId": "m-2", "provider": "p-2" }),
        None,
    )];
    let (modele, fournisseur, _) = sessions::metadata::reglages_de(&entrees);
    assert!(modele.as_deref() == Some("m-2") && fournisseur.as_deref() == Some("p-2"));
}

#[test]
fn les_placeholders_et_les_horodatages_sont_conservateurs() {
    // D22 : <synthetic> n'annonce pas un modèle ; les horodatages ne se
    // fabriquent pas (aucune entrée datée → aucun horodatage).
    let entrees = [entree(
        "message",
        json!({ "message": { "role": "assistant", "model": "<synthetic>", "content": [{ "type": "text", "text": "x" }] } }),
        None,
    )];
    let resume = reduis(&entrees);
    assert!(
        resume.modele.is_none(),
        "un substitut n'est pas un modèle : {:?}",
        resume.modele
    );
    assert!(resume.horodatage_ms.is_none(), "pas d'horodatage fabriqué");
    // Le niveau de raisonnement porte.
    let entrees = [entree(
        "message",
        json!({ "message": { "role": "assistant", "thinkingLevel": "high", "content": [] } }),
        None,
    )];
    let (modele, _, raisonnement) = sessions::metadata::reglages_de(&entrees);
    assert!(modele.is_none() && raisonnement.as_deref() == Some("high"));
}

#[test]
fn les_cinq_profils_reduisent_de_la_meme_facon() {
    // Les cinq profils produisent des lignes pi : le MÊME réducteur lit les
    // cinq — cohérent par construction (les codecs ont traduit).
    let pi = [entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "demande pi" }] } }),
        Some("2024-03-05T08:00:00.000Z"),
    )];
    let codex = [entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "demande codex" }] } }),
        Some("2025-10-15T12:40:00.000Z"),
    )];
    let claude = [entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "demande claude" }] } }),
        Some("2026-10-16T12:00:00.000Z"),
    )];
    let opencode = [entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "demande opencode" }] } }),
        Some("2026-10-16T13:00:00.000Z"),
    )];
    let devin = [entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "demande devin" }] } }),
        Some("2026-06-14T17:18:50.653358Z"),
    )];
    for (nom, entrees) in [
        ("pi", pi.as_slice()),
        ("codex", codex.as_slice()),
        ("claude", claude.as_slice()),
        ("opencode", opencode.as_slice()),
        ("devin", devin.as_slice()),
    ] {
        let resume = reduis(entrees);
        let attendu = format!("demande {nom}");
        assert!(
            resume.dernier_prompt.as_deref() == Some(attendu.as_str()),
            "{nom} : le réducteur lit la forme pi commune : {:?}",
            resume.dernier_prompt
        );
        assert!(
            resume.horodatage_ms.is_some(),
            "{nom} : un horodatage connu"
        );
    }
}

#[test]
fn la_fusion_préserve_les_déclarations_précédentes() {
    // D19 : une fenêtre muette n'efface pas ce que les précédentes avaient
    // déclaré (le modèle d'une vieille fenêtre survit).
    let vieille = [entree(
        "message",
        json!({ "message": { "role": "assistant", "model": "m-ancien", "provider": "p-ancien", "content": [{ "type": "text", "text": "ancien aperçu" }] } }),
        Some("2026-10-16T12:00:00.000Z"),
    )];
    let nouvelle_muette = [entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "nouvelle demande" }] } }),
        Some("2026-10-16T12:01:00.000Z"),
    )];
    let mut cache = CacheResumes::nouveau();
    cache.met_a_jour("source-1", &vieille);
    cache.met_a_jour("source-1", &nouvelle_muette);
    let resume = match cache.resume("source-1") {
        Some(resume) => resume,
        None => panic!("la source reste au cache"),
    };
    assert!(
        resume.modele.as_deref() == Some("m-ancien"),
        "le modèle PRÉCÉDENT préservé : {:?}",
        resume.modele
    );
    assert!(
        resume.fournisseur.as_deref() == Some("p-ancien"),
        "le fournisseur aussi"
    );
    assert!(
        resume.dernier_prompt.as_deref() == Some("nouvelle demande"),
        "la nouvelle demande gagne"
    );
    assert!(
        resume.horodatage_ms == iso_vers_ms("2026-10-16T12:01:00.000Z"),
        "l'horodatage nouveau gagne"
    );
}

#[test]
fn le_cache_borne_et_évince_la_plus_ancienne() {
    let mut cache = CacheResumes::nouveau();
    // Remplir 256 + une : la PLUS ANCIENNE évincée.
    for n in 0..=CAPACITE_CACHE {
        let cle = format!("source-{n}");
        cache.met_a_jour(&cle, &[entree(
            "message",
            json!({ "message": { "role": "user", "content": [{ "type": "text", "text": format!("demande {n}") }] } }),
            None,
        )]);
    }
    assert!(
        cache.resume("source-0").is_none(),
        "la plus ancienne est évincée"
    );
    assert!(
        cache.resume(&format!("source-{CAPACITE_CACHE}")).is_some(),
        "la récente reste"
    );
    // L'invalidation explicite.
    cache.invalide(&format!("source-{CAPACITE_CACHE}"));
    assert!(cache.resume(&format!("source-{CAPACITE_CACHE}")).is_none());
}

#[test]
fn une_source_invalide_n_efface_pas_les_autres() {
    // D20 : une entrée illisible ne touche PAS les autres du cache.
    let mut cache = CacheResumes::nouveau();
    cache.met_a_jour("source-bonne", &[entree(
        "message",
        json!({ "message": { "role": "user", "content": [{ "type": "text", "text": "bonne" }] } }),
        None,
    )]);
    // Une source INVALIDE (une ligne de travers) : elle entre vide mais
    // n'EFFACE rien d'autre.
    cache.met_a_jour(
        "source-cassée",
        &[entree("message", json!("pas un objet"), None)],
    );
    cache.met_a_jour("source-vide", &[]);
    match cache.resume("source-bonne") {
        Some(resume) => assert!(
            resume.dernier_prompt.as_deref() == Some("bonne"),
            "l'autre source reste"
        ),
        None => panic!("une source cassée ne doit pas effacer les autres"),
    }
    // Les sources invalides rendent un résumé VIDE (pas une panne) — leur
    // vrai contenu (brut) reste porté par les lecteurs.
    match cache.resume("source-cassée") {
        Some(resume) => assert!(resume.dernier_prompt.is_none()),
        None => panic!("une source cassée reste une entrée (vide), pas une disparition"),
    }
}

#[test]
fn iso_vers_ms_repare_le_défaut_number() {
    // Le défaut mesuré : Number("2026-10-09T15:08:21.784Z") = NaN — le
    // parser propre rend les ms exactes.
    let ms = iso_vers_ms("2026-10-09T15:08:21.784Z").unwrap_or_default();
    let aller_retour = sessions::families::codecs::opencode::horodatage_iso(ms).unwrap_or_default();
    assert!(
        aller_retour == "2026-10-09T15:08:21.784Z",
        "aller-retour ISO : {aller_retour}"
    );
    // Sans millisecondes.
    assert!(iso_vers_ms("2026-10-09T15:08:21Z").is_some());
    // Du bruit : rien.
    assert!(iso_vers_ms("pas une date").is_none());
    assert!(
        iso_vers_ms("2026-13-45T99:99:99Z").is_some(),
        "le parseur civil accepte les nombres — la borne reste au fil"
    );
}
