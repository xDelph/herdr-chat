# Direction UX mobile — aperçu à valider

Les quatre images de `docs/ux/` sont des **maquettes à 390×844**, pas des captures de l'application ni une promesse de fonctionnalités déjà implémentées. « Projet Atlas », « Site vitrine » et les messages sont des données fictives. Leur seul rôle est de montrer les zones de l'interface. Les statuts et les actions représentés correspondent aux contrats de `RELEASE_BACKLOG.md`. Aucun nombre de messages non lus, horodatage ou titre calculé n'est inventé.

Rendus : [Conversations](ux/01-conversations.png) · [Projet](ux/02-projet.png) · [Chat](ux/03-chat.png) · [Lancement](ux/04-lancement.png). Sources SVG et générateur reproductible dans le même dossier.

| Écran | Donnée requise | Action principale | État montré |
|---|---|---|---|
| Conversations | Snapshot Herdr et, si disponible, fin de session Pi | Ouvrir le pane choisi | Un pane dans une seule section : bloqué, actif ou récent |
| Projet | Projet Herdr et panes associés | Ouvrir un pane ou « Nouvel agent » | Liste de conversations distinctes |
| Chat | Session Pi structurée ; état Herdr | Répondre dans le pane courant | Message attendu ; accusé d'envoi seulement si Herdr confirme |
| Lancement | Types installés et catalogue vérifié | Lancer un agent dans ce projet | Modèle et raisonnement laissés au choix de Pi |

## Parcours à implémenter

1. **Reprendre :** Conversations → toucher une ligne → Chat du `paneId` choisi → retour à Conversations avec brouillon et position conservés.
2. **Répondre à un blocage :** Conversations/À traiter → Chat → rédiger → attente de confirmation → confirmation, erreur ou état inconnu exact → retour.
3. **Ouvrir un projet :** Projets → détail → choisir une conversation → Chat → retour au détail du même projet.
4. **Lancer :** détail du projet → « Nouvel agent » → choisir un type réellement installé ; modèle/raisonnement seulement s'ils existent dans le catalogue → valider → afficher chaque étape de lancement → ouvrir le pane créé ou afficher l'échec et le pane récupérable.

## États à dessiner avant implémentation

- **Bloqué :** dans À traiter et dans Chat, seulement si Herdr donne `blocked`.
- **Chargement :** squelette de liste ou de chat, sans succès d'action anticipé.
- **Vide :** aucune conversation, projet sans agent, session Pi absente : trois textes et actions distincts.
- **Erreur :** cause fournie par l'API et action de nouvelle tentative ; les autres conversations restent visibles si une session échoue.
- **Hors ligne :** historique et brouillon conservés ; envoi désactivé tant que le serveur n'est pas joignable ; reconnexion et rattrapage explicites.

Ces états, les rendus **320×568**, le clavier ouvert et les mesures tactiles/contraste sont encore à produire pour terminer U01/U02 et faire valider D03. Les images présentes fixent uniquement la direction des quatre écrans principaux.
