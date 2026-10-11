# Choix de publication et de distribution

> Mise à jour du 11/10/2026 : le tap Homebrew personnel et l'absence d'authentification applicative pour l'usage personnel sont décidés dans [D018](DECISIONS.md). La variante précise PolyForm et le titulaire des droits restent à confirmer.

## Licence

Le souhait exprimé est de publier le code tout en réservant une possible exploitation commerciale. La proposition précise est **PolyForm Noncommercial 1.0.0**, identifiant SPDX `PolyForm-Noncommercial-1.0.0`. Elle permet l'utilisation, la modification et la distribution dans le cadre non commercial ; une licence commerciale distincte peut être proposée par le titulaire des droits. Le texte exact de la licence et le titulaire restent à confirmer avant d'ajouter `LICENSE`.

Ce choix rend le code **source-available / à code source public**, et non « open source » au sens de l'Open Source Definition, qui interdit de restreindre un domaine d'activité comme l'usage commercial. Les contributions devront donc prévoir explicitement les droits nécessaires pour que le titulaire puisse continuer à proposer une licence commerciale. Rédiger cette politique dans `CONTRIBUTING.md` avant d'accepter des contributions externes.

Sources : [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0), [identifiant SPDX](https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0.html), [Open Source Definition §6](https://opensource.org/osd).

## Distribution

**Décision :** publier Herdr Remote comme service autonome via une **formule dans un tap Homebrew personnel**. Le serveur Bun et la PWA restent un seul produit, sans dépendance au cycle de vie d'un plugin. `brew services` peut gérer le lancement du serveur local. Un plugin Herdr, si utile, sera une intégration facultative, après une preuve isolée de son installation et de son comportement lors d'un redémarrage d'Herdr.

Une formule à licence PolyForm Noncommercial ne doit pas être proposée à `homebrew/core`, dont les critères demandent une licence compatible avec les principes du logiciel libre. Un tap tiers permet de distribuer sa propre formule. Une application macOS `.app` demanderait un emballage supplémentaire ; elle n'est pas nécessaire pour la PWA et le service local.

Les plugins Herdr documentés utilisent un manifeste et des commandes externes. Leur hook de démarrage est un **initialiseur exécuté une fois**, sans supervision durable du processus. Un plugin peut donc faciliter l'intégration, mais la stabilité d'un serveur permanent doit être prouvée séparément.

Sources : [Herdr — plugins](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx), [critères Homebrew](https://docs.brew.sh/Acceptable-Formulae), [politique des paquets Homebrew](https://docs.brew.sh/Package-Acceptance-Policy), [brew services](https://docs.brew.sh/Manpage).

## Accès

**Décision :** pas de compte ni de jeton applicatif pour la release personnelle. Le service écoute sur loopback et Tailscale Serve l'expose au tailnet personnel selon les grants/ACL configurés. Tout appareil qui peut atteindre le service peut lire les données et appeler les actions ; l'application ne distingue pas ces appareils. Les contrôles HTTP prévus dans [SECURITY_MODEL.md](SECURITY_MODEL.md) réduisent les requêtes intersites et les mauvaises configurations, sans constituer une authentification. Le passage à un usage d'équipe ou public exige une nouvelle décision d'accès.
