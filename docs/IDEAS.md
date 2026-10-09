# Idées d'évolution — Herdr Remote

> Relevé du **2026-10-09**. Chaque proposition est **adossée à une mesure** sur les
> sessions réelles, pas à une intuition. Les mesures sont reproductibles avec les
> commandes données en fin de document.
>
> Rien ici n'est engagé. Ce document sert à choisir plus tard, en connaissance
> de ce que les données permettent réellement.

---

## 1. Ce que les données permettent — mesuré

| Mesure | Résultat | Source |
|---|---|---|
| Messages avec un coût chiffré | **5 466** | `message.usage.cost.total` |
| Coût cumulé sur les sessions locales | **$10,23** | idem |
| Fichiers distincts édités | **256** | `toolCall.name == "edit"` → `arguments.path` |
| Blocs image | 49 | `content[].type == "image"` |
| Entrées `context_edit` / `compaction` | 60 / 4 | `entry.type` |

Répartition des blocs et des outils (census de 12 107 lignes) :

| Bloc | | Outil | |
|---|---|---|---|
| `text` | 8 343 | `bash` | 3 964 |
| `toolCall` | 5 663 | `edit` | 801 |
| `thinking` | 3 218 | `read` | 499 |
| `image` | 49 | `write` | 372 |

---

## 2. Correction d'une conclusion précédente : les sous-agents SONT récupérables

**Ce que j'avais écrit** (`docs/PROTOCOL.md`, `docs/TASKS.md`) : *« arborescence des
sous-agents : aucune source identifiée »*.

**C'était faux.** J'avais cherché dans `parentId`, qui est un **branchement de
conversation** dans le fichier de session. Je n'avais pas regardé les `details`
des résultats d'outil.

**La source existe** : `message.details` d'un `toolResult` de l'outil `subagent`.

```json
{
  "mode": "parallel",
  "results": [
    {
      "id": "sa1",
      "agent": "worker",
      "status": "failed",
      "exitCode": 0,
      "stopReason": "stop",
      "model": "deepseek/deepseek-v4.1-flash",
      "digest": {
        "status": "ok",
        "filesChanged": ["test-sub-agent/macos.html"],
        "summary": "Created a single-file macOS-style homepage…",
        "verified": "Re-read start, render block… 731 lines on disk.",
        "questions": "none"
      },
      "output": "Progress: 100/100 — done…",
      "usage": { },
      "warnings": [],
      "errorMessage": null
    }
  ]
}
```

Les arguments de l'appel portent la demande :

```json
{"agent":"scout","model":"opencode-go/deepseek-v4-flash-vision-exp",
 "cwd":"/Users/…/devcli-private","ownership":"read",
 "files":[".tmp_blockview.png"],"task":"Read the image file…"}
```

### Ce qu'on peut afficher

| Donnée | Disponible |
|---|---|
| Agent, modèle, statut, code de sortie, raison d'arrêt | ✅ |
| Fichiers modifiés (`digest.filesChanged`) | ✅ |
| Résumé et **auto-vérification** (`digest.verified`) | ✅ |
| Questions ouvertes (`digest.questions`) | ✅ |
| Sortie complète, `usage`, avertissements, erreur | ✅ |
| Demande initiale (agent, `cwd`, fichiers, tâche) | ✅ |

### Limite honnête, vérifiée

J'ai relevé les **8 identifiants `sa-<uuid>`** présents dans les sessions :
**aucun ne correspond à un fichier de session local.** Le transcript complet d'un
sous-agent **n'est pas disponible**. On affiche donc un **résumé structuré**, et on
ne promet pas d'ouvrir sa conversation.

### Détail à afficher tel quel

Dans l'exemple, `status: "failed"` **et** `digest.status: "ok"` sont tous les deux
vrais. Masquer l'un des deux serait mentir sur l'état réel. L'interface doit
montrer les deux.

---

## 3. Propositions, par ordre de valeur

### 3.1 — La file d'attention comme écran d'accueil ⭐

**Le problème.** L'accueil liste des projets. En mobilité, la vraie question est
**« qu'est-ce qui m'attend ? »**.

**Ce qu'on peut faire, avec ce qui existe déjà.** Quand un agent passe en
`blocked`, il attend une réponse. Le **dernier message assistant** avant le
blocage dit ce qu'il demande — lisible depuis le JSONL. On affiche donc :

- **ce qu'il demande**, en clair ;
- des **réponses rapides** (`oui` / `non` / `continue`) ;
- un champ libre.

Techniquement : `agent.prompt` (déjà utilisé) + lecture du dernier message
(backend déjà en place). Rien de nouveau à construire côté Herdr.

**Pourquoi c'est la priorité.** C'est la différence entre *consulter* et
*piloter*. Sans ça, l'application est un lecteur.

**Effort** : faible. Aucune dépendance nouvelle.

### 3.2 — Les sous-agents rendus visibles ⭐

**Le problème.** Un agent qui délègue à 4 sous-agents en parallèle est
**invisible** dans l'interface actuelle.

**Ce qu'on affiche.** Une carte par sous-agent : agent, modèle, statut, fichiers
modifiés, résumé, auto-vérification, questions ouvertes. Les deux statuts
divergents affichés **tels quels**.

**Effort** : moyen — il faut analyser `details`, et gérer les modes `single` et
`parallel`.

### 3.3 — Fichiers touchés

**256 fichiers distincts** sur les sessions locales. Agrégation depuis
`edit` / `write` / `digest.filesChanged`, par agent et par projet.

Répond à « où en est le travail » **sans lire 2 000 messages**.

**Effort** : faible. La donnée est déjà analysée dans `blocks.ts`.

### 3.4 — Coûts et tokens

$10,23 cumulés, chiffrés **message par message**, avec le modèle et le projet.
Une vue par projet, par agent, par modèle, par jour.

**Pourquoi maintenant.** La donnée est complète et personne ne l'affiche.
C'est aussi le premier signal qui manque quand on fait tourner plusieurs agents.

**Effort** : faible à moyen.

### 3.5 — « Depuis ta dernière visite »

Un marqueur de lecture par session. Au retour sur le téléphone : **seulement ce
qui a bougé**.

Complément naturel de la file d'attention : elle dit ce qui demande une action,
celui-ci dit ce qui a simplement avancé.

**Effort** : faible, si on stocke le marqueur localement.

### 3.6 — Reprendre ailleurs

Herdr expose **`resume_argv`** — *« Command that resumes this agent's session
after a Herdr restart »*, fourni par Herdr lui-même. Je ne l'utilise pas
aujourd'hui.

Bouton « reprendre sur le Mac » : affiche la commande native, la copie, ou
l'exécute après confirmation.

Répond à la quatrième question du spec : **« comment continuer ? »**

**Effort** : faible.

### 3.7 — Compaction et points de reprise

60 `context_edit`, 4 `compaction`. Sur une session longue, savoir **où le
contexte a été résumé** évite de relire dans le vide — et explique pourquoi un
agent a « oublié » quelque chose.

**Effort** : faible.

### 3.8 — Recherche dans toutes les sessions

Était prévu en V2 dans le spec. Peu de travail — les fichiers sont locaux et
linéaires — et énorme à l'usage.

À faire **côté serveur**, pas côté client : les sessions font jusqu'à 12 Mo.

**Effort** : moyen.

---

## 4. Affichage et communication

| Idée | Bénéfice |
|---|---|
| **Réponses rapides** contextuelles | répondre en un geste plutôt qu'en tapant |
| **Brouillon persistant** | le réseau tombe en mobilité ; perdre un message est rageant |
| **Regrouper les appels d'outils consécutifs** — « 12 lectures de fichiers » | divise la longueur d'une session par un facteur réel |
| **Replier les sorties d'outil par défaut** | garder les décisions visibles, le bruit replié |
| **Vue worktrees** (`jarvis-worktrees/t-001…t-101`) | aujourd'hui invisible |
| **Densité réglable** | lecture rapide sur téléphone vs analyse fine |
| **Recherche dans la conversation**, avec saut au message | naviguer dans 2 000 messages |

---

## 5. Ce qui est bloqué, et pourquoi on ne le promet pas

**Les notifications iOS.** Sans HTTPS, iOS refuse d'enregistrer le service
worker : **pas de Web Push, pas d'installation**. `tailscale serve` est
désactivé sur le tailnet (`docs/DECISIONS.md` D010).

Contournements possibles **sans HTTPS** :

- un **badge** « N agents t'attendent » dans l'interface ;
- la **file d'attention** (§3.1), qui joue le même rôle à l'ouverture ;
- le titre de l'onglet, qui peut porter le compteur.

Le jour où Serve est activé, le Web Push devient possible **sans réécriture** —
la structure est déjà en place (service worker précaché, flux SSE).

---

## 6. Ce qu'on ne fera pas

- **Reproduire le terminal** : on lit, on ne réimplémente pas un émulateur.
- **Inventer un état** : Herdr n'a pas de statut `error`, on n'en fabrique pas.
- **Promettre une reprise universelle** : chaque connecteur déclare ce qu'il sait
  faire, et l'absence est affichée comme telle.
- **Ouvrir le transcript d'un sous-agent** : il n'existe pas localement (§2).

---

## 7. Ordre recommandé

1. **File d'attention** (§3.1) — transforme l'outil
2. **Sous-agents** (§3.2) — révèle l'angle mort, et corrige une erreur de ma part
3. **Fichiers touchés** (§3.3) + **coûts** (§3.4) — le tableau de bord minimal
4. **Depuis ta dernière visite** (§3.5)
5. Le reste selon l'usage

---

## 8. Reproductibilité des mesures

```bash
# Coûts, fichiers édités, entrées particulières
#   (script d'analyse, lecture seule)
bun /tmp/spike/ideas.ts

# Structure d'un résultat de sous-agent
bun /tmp/spike/sub.ts

# Les identifiants de sous-agent correspondent-ils à des sessions ?
bun /tmp/spike/link.ts
```

Ces scripts lisent `~/.pi/agent/sessions/**/*.jsonl` **en lecture seule**. Aucun
agent n'est lancé, aucun fichier de session n'est modifié (voir `AGENTS.md`).
