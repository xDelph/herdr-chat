# Règles de travail sur Herdr Remote

## ⛔ Interdiction : ne jamais utiliser les agents de l'utilisateur comme cibles de test

**Incident réel du 2026-10-09.** En développant, j'ai envoyé **11 prompts de test** dans deux sessions de travail réelles de l'utilisateur :

| Cible | Projet | Prompts injectés |
|---|---|---|
| `w2:p1` | `devcli-private` | 10 |
| `wA:p1` | `pixel` | 1 |

Ces prompts (`« Spike Herdr Remote… »`, `« Test dédup… »`, `« Veille Herdr Remote… »`) sont **définitivement inscrits** dans les fichiers de session. Je n'y touche pas : le format est en lecture seule, et modifier un JSONL de session risque de le corrompre.

### La règle

> **Un agent lancé par l'utilisateur n'est JAMAIS une cible de test. Sans exception.**
> **Un agent de test est lancé par moi, dans un répertoire jetable, et fermé après usage.**

### Pourquoi c'était évitable

- Les tests unitaires utilisent déjà un **transport simulé** (`TransportTag.layerTest`) : aucun Herdr requis, aucune session touchée. **C'était suffisant pour la quasi-totalité des vérifications.**
- `pi --print --no-session` produit un sous-agent **sans fichier de session** : aucune trace.
- Pour le seul chemin qui exige réellement Herdr, il faut un **pane jetable** — pas le pane de quelqu'un d'autre.

### Procédure autorisée

| Besoin | Moyen |
|---|---|
| Vérifier une logique (dédup, décodage, contrats, lecture de session) | **Tests unitaires avec transport simulé** — c'est la voie par défaut |
| Vérifier un comportement de Pi lui-même | `pi --print --no-session` dans un répertoire temporaire |
| Vérifier le chemin **Herdr → pane → prompt** | **Pane de test jetable**, créé par moi, fermé après usage (voir `scripts/test-agent.sh`) |
| Vérifier l'API HTTP | `curl` sur les routes **en lecture** (`/api/overview`, `/api/health`, `/api/agents/.../session`) |

### Avant toute action qui écrit dans le monde de l'utilisateur

Poser la question :

> **Est-ce que ça modifie quelque chose que l'utilisateur n'a pas explicitement mis à ma disposition ?**

Si la réponse n'est pas un « non » franc, **demander avant d'agir**.

---

## Zéro `kill` sur un processus non identifié positivement

**Incident réel du même jour.** Un `lsof` a montré un processus occupant un port ; je l'ai identifié à tort comme un résidu de `tailscale serve` et je l'ai tué. C'était le service `print-cost-report` de l'utilisateur, non géré par `launchd`, donc **ne redémarrant pas tout seul**.

> Un port occupé **n'est pas** un port orphelin. Avant tout `kill` : établir le **chemin complet** de l'exécutable, le **PPID** et le service associé. Si l'identification n'est pas certaine, ne pas tuer.

---

## Le contenu et le rattrapage ne viennent jamais d'Herdr

`sessions Pi` = contenu · `API Herdr` = contrôle et état. Mesuré : `revision` vaut `0` en permanence et `events.wait` n'implémente pas `pane_output_changed`. Voir `docs/PROTOCOL.md` §10.

## Le schéma n'est pas la source de vérité

Toute capacité est **vérifiée par exécution** avant d'être utilisée. Sur Herdr 0.9.3 : 19 variantes d'`EventMatch` déclarées, **1** implémentée ; `agent_status` optionnel au schéma, exigé par le serveur.

## Un contrat dupliqué diverge — toujours

Le contrat d'API vit dans **un seul** endroit : `packages/shared/src/api.ts`. Le serveur valide ses réponses sortantes contre lui. Un test de contrat échoue si l'un des deux s'en écarte.

## Ne pas exposer un état qu'on ne peut pas vérifier

Un envoi non confirmé n'est **jamais** affiché comme « envoyé ». Une capacité absente est affichée comme absente, jamais remplacée par un substitut inventé.

## Ne jamais masquer une erreur

Une cause réelle est affichée, pas un message générique. Une porte de vérification doit être **prouvée capable d'échouer**.
