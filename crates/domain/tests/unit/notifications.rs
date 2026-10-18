//! Notifications : pousser des faits, jamais des suppositions.

use domain::ids::{AgentName, PaneId};
use domain::notifications::{
    AgentAttentionEvent, BrowserSubscription, PushEndpoint, PushPayload, PushSubscriptionKeys,
    VapidPublicKey,
};

#[test]
fn un_payload_note_le_filtre_et_la_cible() {
    // {body, tag, title, url} — la composition du texte (étiquettes D04,
    // agent disparu ≠ fini) reste le service (T030) ; la valeur passe telle.
    let charge = PushPayload {
        title: "π - atcrea".to_string(),
        body: "un agent attend".to_string(),
        tag: "wA:p7".to_string(),
        url: "/?agent=wA%3Ap7".to_string(),
    };
    match serde_json::to_string(&charge) {
        Ok(encodé) => {
            assert!(encodé.contains("\"tag\":\"wA:p7\""), "tag perdu : {encodé}");
            assert!(encodé.contains("\"url\":"));
        }
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn un_abonnement_browser_cite_p256dh_et_auth_totalement() {
    let keys = PushSubscriptionKeys {
        p256dh: "clef-p256dh".to_string(),
        auth: "clef-auth".to_string(),
    };
    let subscription = BrowserSubscription {
        endpoint: "https://push.example/249e".to_string(),
        keys,
    };
    match serde_json::to_string(&subscription) {
        Ok(encodé) => {
            assert!(
                encodé.contains("\"p256dh\":\"clef-p256dh\""),
                "clef perdue : {encodé}"
            );
            assert!(encodé.contains("\"auth\":\"clef-auth\""));
        }
        Err(cause) => panic!("encodage impossible : {cause}"),
    }
}

#[test]
fn la_clef_publique_vapid_est_opaque_et_pas_inventée() {
    let clef = VapidPublicKey::from("BElh4...".to_string());
    assert_eq!(clef.as_str(), "BElh4...");
    let endpoint = PushEndpoint::from("https://push.example/1".to_string());
    assert_eq!(endpoint.as_str(), "https://push.example/1");
}

#[test]
fn un_event_d_attention_porte_les_faits_pas_des_mots_d_invention() {
    let événement = AgentAttentionEvent {
        pane: PaneId::from("wB:p3".to_string()),
        name: Some(AgentName::from("spawn-2".to_string())),
        status: Some("gone".to_string()),
    };
    assert_eq!(événement.pane, PaneId::from("wB:p3".to_string()));
    match événement.status {
        Some(statut) => {
            // `gone` n'est pas un AgentStatus : un agent disparu n'a pas
            // « fini », et Herdr n'expose pas de raison. La chaîne passe
            // telle ; la phrase est au service, pas au domaine.
            assert_eq!(statut, "gone");
        }
        None => panic!("le statut publié a été perdu en route"),
    }
}
