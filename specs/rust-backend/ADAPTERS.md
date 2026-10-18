# Socles communs et adaptations par agent

Décisions de conception du 2026-10-18. Ce document complète TECH.md et contraint TASKS.md. La composition s'applique aux sessions, interactions, catalogues, lancements et notifications. Aucun développement n'est commencé.

## 1. Séparer les axes

```text
Source réelle
  → lecteur de stockage commun (JSONL / SQLite)
  → extraction de l'enveloppe propre à l'agent
  → codec de famille explicitement sélectionné
  → politique propre à l'agent
  → message/observation normalisé
  → contrats HTTP existants
```

Le stockage ne dépend jamais du fournisseur de modèle. Une ressemblance de message ne suffit pas pour partager un lecteur de disque, un schéma SQL ou une procédure d'interaction. Aucun adaptateur ne dérive d'un autre agent : les deux composent les mêmes primitives lorsqu'elles s'appliquent.

| Agent | Stockage commun | Enveloppe / famille | Adaptation conservée isolée |
|---|---|---|---|
| Pi | `storage::jsonl` | `codecs::pi` | Header, rôles, changements de réglages, parentSession |
| Codex | `storage::jsonl` + index SQLite de découverte | `families::openai::responses` et événements Codex | response_item/event_msg, contexte injecté, outils custom, commandes/diffs, réglages, réflexion chiffrée, IDs |
| Claude | `storage::jsonl` | `families::anthropic::messages` | user/assistant, UUID, tool_result, marqueurs du harnais, commandes XML, comptabilité exclue |
| opencode | `storage::sqlite` | `codecs::opencode` | Tables session_v2/session_message, seq, parties text/reasoning/tool/file, variantes |
| Devin | `storage::sqlite` | `families::openai::chat` | Tables sessions/message_nodes, row_id, chat_message, metadata, thinking, IDs |

**Codex et Devin ne partagent pas leur stockage actuel.** Ils peuvent partager des primitives de valeur OpenAI, mais Responses et Chat restent deux codecs distincts. **Devin et opencode partagent le moteur de pagination SQLite**, avec requêtes et décodages propres à chacun.

La découverte Codex conserve également la correction de [BASELINE-DELTA.md](BASELINE-DELTA.md) : essayer le titre brut, puis le candidat sans décoration de travail ; seule une correspondance exacte nom + cwd dans l’index autorise le choix. Cette règle reste dans le profil Codex, sans nettoyage global des titres.

## 2. Structure cible dans `sessions`

```text
src/
  storage/
    jsonl/{reader,framing,history,identity}.rs
    sqlite/{worker,paging,row}.rs
  families/
    openai/{arguments,text,chat,responses}.rs
    anthropic/messages.rs
  codecs/{pi,opencode}.rs
  agents/
    pi/{profile,decode}.rs
    codex/{profile,envelope,events,policy,discovery}.rs
    claude/{profile,envelope,policy}.rs
    opencode/{profile,queries,decode,policy}.rs
    devin/{profile,queries,envelope,policy}.rs
  {pipeline,registry,resolver,index,cursor,metadata,path_policy}.rs
tests/
  unit_tests.rs
  unit/{mod,jsonl,sqlite,openai_arguments,openai_chat,openai_responses}.rs
  integration_tests.rs
  integration/{mod,pipeline,discovery,mutable_rows,cursors}.rs
  contract_tests.rs
  contracts/{mod,agent_matrix,normalization}.rs
```

Chaque répertoire avec sous-modules a son `mod.rs`; les accolades décrivent des fichiers séparés. Les noms sont des destinations de conception, pas des fichiers déjà créés.

### Responsabilités fixes

| Couche | Fournit | Ne décide jamais |
|---|---|---|
| JSONL | Octets, lignes complètes, offsets, identité, lecture avant/après, suffixe incomplet | Rôle, outil, filtre système, modèle, état agent |
| SQLite | Worker lecture seule, paramètres liés, page ordonnée, borne inclusive configurable, limites | Nom de table deviné, rôle, modèle, équivalence node_id/row_id |
| Famille | Décodage d'une forme de valeur explicite, arguments JSON conservés bruts si invalides, blocs texte/outils connus | Découverte de fichiers, filtres de harnais, preuve de réception, confiance |
| Agent | Enveloppe, schéma/version, IDs source, filtres de contexte, métadonnées, sélection du codec | Réimplémentation du framing, files d'attente, retries génériques |
| Pipeline | Compose profil + lecteur + codec + politique, produit message/réglages/inconnu/filtré | Fallback vers un autre agent quand le décodeur échoue |

`SqliteProfile` contient les requêtes statiques d'existence/dernière page/depuis/avant, la colonne de séquence, le décodeur de ligne et la borne de replay. Les identifiants SQL proviennent du code du profil, les valeurs de session/curseur sont liées. Le moteur n'interpole jamais un nom de table provenant du réseau.

`OpenAiChatCodec` et `OpenAiResponsesCodec` partagent uniquement les primitives dont l'identité est démontrée par les fixtures. Le premier ne cherche pas une enveloppe `response_item`; le second ne suppose pas `metadata.generation_model`. `thinking.thinking` de Devin et le raisonnement chiffré de Codex restent des politiques distinctes. Une nouvelle version Devin se traite dans `agents/devin`; un changement de Chat commun nécessite des preuves indépendantes du seul Devin.

Les schémas non reconnus produisent un inconnu conservé ou une erreur explicite, selon la frontière concernée. La prise en charge des tool_calls Devin reste marquée **non vérifiée sur une forme réelle** jusqu'à preuve dédiée ; un exemple synthétique OpenAI valide le codec, pas cette capacité de Devin. Aucune mesure en envoyant un prompt à un agent de l'utilisateur.

## 3. Interactions : un moteur, des profils

Créer une crate `interactions`, distincte d'`application`. Elle dépend seulement des ports/types de `domain`. Elle possède le moteur commun ; `application` possède l'admission et la file par pane ; `herdr-client` exécute les opérations de transport.

```text
src/
  {engine,recognize,plan,verify,error,registry}.rs
  families/{numbered,selection,free_text}.rs
  agents/{pi,codex,claude,opencode,devin}.rs
tests/
  unit_tests.rs
  unit/{mod,recognition,planning,verification}.rs
  integration_tests.rs
  integration/{mod,stale_prompt,interleaving,partial_send}.rs
  contract_tests.rs
  contracts/{mod,agent_profiles}.rs
```

Moteur fixe : **lire → reconnaître → vérifier la décision offerte → construire un plan → exécuter séquentiellement → relire → qualifier la preuve**. Un plan comporte seulement `SendText`, `SendKeys`, `ReadScreen`, `GetAgent`, avec cible/session fixes, limite de durée et progression d'exécution. Une étape échouée conserve l'information « les étapes précédentes ont peut-être eu un effet ».

| Profil | Commun | Adaptation d'agent |
|---|---|---|
| Question numérotée | Cohérence 1..N, choix offert, contexte/détail, lecture avant/après | Marqueurs/gouttières/invite supportés, validation de numéro puis Enter selon le profil |
| Sélection | Choix et position courante observés, déplacement borné, validation | Libellés de confiance Claude et ordre réellement reconnu ; ne pas toujours envoyer Down aveuglément |
| Saisie libre | Texte littéral, ordre du plan, taille, résultat partiel | opencode sélection→Enter→texte→Enter ; pas de séquence héritée pour un autre agent |
| Confiance | Décision explicite, présence/identité de l'agent, preuve après action | Marqueurs et touches mesurés Codex/Claude ; aucun profil implicite pour famille inconnue |
| Attente non reconnue | Retour d'observation sans action | Conserver `waiting` pour agent blocked, sans fabriquer des choix |

Un fingerprint de question comprend identité agent/session et contenu sémantique question+choix, pas les couleurs ANSI. Le relire immédiatement avant la première étape mutante. Si la question change, refuser sans frappe. Si elle change après une frappe, classer le résultat comme transmis/non prouvé, jamais comme application certaine. Les positions d'une sélection sont validées sur l'écran observé, pas sur une constante supposée.

Les profils contiennent des règles déclaratives et de petites fonctions de reconnaissance/décodage ; pas de moteur parallèle par agent. Un format qui n'est pas reconnu ne reçoit aucune touche. Arrêt Ctrl+C et focus restent des commandes explicites distinctes, utilisant la même admission par pane.

## 4. Même principe dans les autres sous-systèmes

| Sous-système | Socle commun | Profil / adaptation |
|---|---|---|
| Catalogues | Processus argv fixe, capture bornée, deadline, single-flight, TTL, erreur/provenance | Commande et sortie Pi/Codex/Claude/Cursor/Devin |
| Lancement | Validation, réservation du nom, état de lancement, retry de shell, preuve, nettoyage des seules ressources possédées | Argv modèle/raisonnement et capacités réellement supportées |
| Prompt | Cible immuable, file, déduplication, classification partielle/inconnue | Sélection prompt/saisie et reconnaissance explicite du refus interactif |
| Résumés | Réducteur des métadonnées normalisées, cache/identité, budget | Extraction des champs uniquement dans les adaptateurs d'entrée |
| Notifications | File, store/VAPID, envoi borné, expiration | Texte/tag selon événement métier ; pas de requête fournisseur dans la livraison |
| HTTP | Route typée, limites, origine, sérialisation, cause | Mapping déclaré propre à chaque opération ; pas de mini-framework par endpoint |

Un registre de capacités assemble les profils disponibles. Être installé, être lisible, avoir un catalogue, savoir lancer avec modèle et savoir répondre à une confiance sont cinq propriétés distinctes. La disponibilité de l'une n'active aucune autre par déduction.

## 5. Contrat d'évolution et tests

1. Chaque profil indique famille, formes supportées, provenance des fixtures et limites connues ; aucun « format OpenAI » générique sans variante.
2. Les fixtures de chaque agent ont un jeu dédié, distinct des fixtures du codec commun. Une fixture référence le comportement source et sa version, sans contenu de session utilisateur.
3. Changer une adaptation exige son jeu de tests plus le contrat commun de composition. Changer une base exige les tests de **tous** ses profils consommateurs ; un test démontre qu'une surcharge Devin n'altère pas le résultat Codex.
4. Un test vérifie que les bases ne dépendent pas des modules `agents/*` et ne dispatchent pas sur AgentKind. Le registre sélectionne les profils ; le socle n'a pas de `if kind == ...`.
5. Les erreurs et les formes inconnues ne basculent jamais vers un profil générique supposé compatible. Le raw est conservé là où le contrat l'exige.
6. Tous les tests résident sous `tests/`, y compris les tests unitaires ; aucune inclusion ni module de test sous `src/`. Les fichiers historiques TypeScript sont déplacés avant la migration des fonctionnalités.
