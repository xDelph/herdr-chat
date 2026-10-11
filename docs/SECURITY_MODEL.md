# Modèle d'accès — release personnelle

**Décision du 11/10/2026.** Herdr Remote est utilisé par une seule personne, sur ses appareils dans son tailnet personnel. **Aucun compte, mot de passe, session de connexion, jeton ou rôle applicatif** n'est prévu pour cette release. Le service n'identifie pas l'utilisateur HTTP et ne distingue pas les appareils autorisés par Tailscale.

## Frontière de confiance

```text
iPhone personnel ── tailnet Tailscale ── Serve HTTPS ── 127.0.0.1:8790 ── Herdr Remote
                                                            │
                                                            └── socket Herdr + sessions Pi
```

- Le serveur de release écoute exclusivement sur `127.0.0.1` ; Tailscale Serve est le seul chemin distant pris en charge. `tailscale funnel` et toute exposition sur le LAN ou Internet sont exclus.
- L'accès distant dépend des appareils et règles d'accès du tailnet. Avant la release, vérifier qu'un appareil personnel autorisé atteint la PWA et qu'un appareil exclu par les grants/ACL n'atteint pas le port Serve. Ne pas déduire cette restriction du seul fait que Serve est activé.
- **Toute personne ou tout processus pouvant joindre le service peut lire les sessions exposées et appeler les routes mutantes.** Cela comprend les processus locaux du Mac et tout appareil auquel la politique Tailscale accorde l'accès. C'est une limite assumée du mode personnel, pas une authentification implicite.
- Le chemin alternatif actuel `HERDR_REMOTE_BIND=<IP Tailscale>` existe dans le dépôt, mais n'est pas la configuration publiée pour la release PWA. Son sort doit être tranché dans S01 et la documentation d'installation doit décrire le chemin effectivement vérifié.

## Surface HTTP

| Méthode | Routes actuelles / prévues | Effet |
|---|---|---|
| `GET` | `/api/health`, `/api/overview`, `/api/events`, `/api/agents/kinds`, `/api/agents/:kind/models` | État, liste, catalogue et événements |
| `GET` | `/api/agents/:paneId/session`, `/api/file`, `/api/images` ; `/api/conversations` après B11 | Contenu de session, fichiers ou aperçus : données potentiellement sensibles |
| `POST` | `/api/agents/:paneId/prompt`, `/api/workspaces/:workspaceId/agents`, `/api/agents/:paneId/trust`, `/api/log` | Envoi, lancement, décision de confiance ou journal client |
| À retirer | `/api/agents/:paneId/terminal` | Route héritée, supprimée par U13 avant la release |

Il n'y a **pas de distinction d'autorisation par route**. Les protections de chemins, tailles, types et capacités du backlog s'appliquent même aux clients du tailnet.

## Protection des requêtes navigateur

Ces contrôles ne sont **pas** une authentification : un programme local ou un pair Tailscale autorisé peut envoyer lui-même des requêtes HTTP.

1. S01 définit une liste exacte d'origines HTTP acceptées : `http://127.0.0.1:<port>` et l'URL HTTPS affichée par Tailscale Serve. Cette dernière est configurée explicitement, par exemple dans `HERDR_REMOTE_PUBLIC_ORIGIN` ; aucune correspondance par suffixe `.ts.net` ni confiance dans un `Host` arbitraire. Une origine de développement Vite éventuelle est configurée séparément et n'entre pas dans le paquet de release.
2. Le serveur rejette un `Host` hors de cette liste avec **421**, avant de servir la PWA ou l'API. Il ne reflète pas une origine arbitraire dans les en-têtes CORS.
3. S02 impose, sur les quatre routes mutantes, la méthode `POST`, `Content-Type: application/json` et un `Origin` égal à l'origine configurée correspondant au `Host` demandé. Origine absente ou différente : **403** avant tout effet ; autre méthode : **405** ; autre type de contenu : **415**. Les prérequêtes intersites ne reçoivent pas d'autorisation CORS.
4. Toutes les routes `GET` doivent rester sans effet de mutation. Les réponses de session, fichiers et aperçus ne sont jamais rendues accessibles à un site tiers par CORS.

## Critères d'échec visibles

- Serve désactivé, Mac hors ligne ou appareil non autorisé par la politique Tailscale : connexion impossible ; la PWA déjà ouverte conserve historique et brouillon, puis signale la coupure.
- Hôte ou origine HTTP non autorisé : refus explicite sans appel Herdr ni lecture de session.
- Herdr ou session indisponible : erreur propre à cette source ; ne pas prétendre que la requête a réussi.

**Déclencheur de révision :** si le tailnet devient partagé, si un accès invité/public est souhaité, ou si une autre application relaie des requêtes vers Herdr Remote, il faut redéfinir l'identité et l'autorisation applicatives avant d'ouvrir cet accès.

Références : [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [grants Tailscale](https://tailscale.com/docs/reference/syntax/grants).
