# fivem-safe

**FR** · [English below](#english)

Deux outils gratuits et open source pour les serveurs FiveM qui ne veulent plus distribuer d'argent aux tricheurs.

Un client modifié peut déclencher n'importe quel event réseau avec les arguments de son choix. Tout handler serveur qui croit ce que le client envoie (un montant, un item, un joueur cible, un bout de SQL) est une faille.

- **[safe_events](#safe_events)** : une ressource qui déclare, pour chaque event, ce que le serveur accepte. Les appels invalides n'atteignent jamais votre handler.
- **[fxaudit](#fxaudit)** : un analyseur qui lit vos ressources sans les exécuter et trouve les handlers qui font confiance au client.

Les deux se répondent : chaque alerte de fxaudit propose la correction avec safe_events.

```
$ fxaudit resources

CRIT  FX001  [jobs]/pizza/server.lua:6:13
       Montant d'argent contrôlé par le client : amount → addMoney  [pizza:pay]
       Correction : Calculer le montant côté serveur (table de Config indexée par un id) ou le borner
       avant de payer. Avec safe_events : args = { { name = 'amount', type = 'integer', max = ... } }.

1 critique, 0 avertissement dans 1 fichier sur 87 (143 handlers serveur).
```

---

## safe_events

Testé sur ESX Legacy avec ox_lib, dans un vrai serveur FXServer.

### Installation

1. Copiez le dossier `safe_events` dans vos ressources.
2. Dans `server.cfg`, démarrez-le après ESX et avant les ressources qui l'utilisent :

   ```cfg
   ensure es_extended
   ensure safe_events
   set safe_events:mode "enforce"   # "audit" : journalise sans bloquer
   set safe_events:webhook "https://discord.com/api/webhooks/..."   # optionnel
   ```

   Gardez le webhook en `set`, jamais en `setr` : `setr` l'enverrait aux clients.
3. Dans le `fxmanifest.lua` de chaque ressource qui l'utilise :

   ```lua
   server_script '@safe_events/import.lua'
   -- pour SafeEvents.callback, ox_lib doit être chargé avant :
   shared_script '@ox_lib/init.lua'
   ```

### Exemple

```lua
SafeEvents.register('pizza:pay', {
    args     = { { name = 'deliveryId', type = 'integer', min = 1, max = #Config.Rewards } },
    job      = { name = 'pizza', minGrade = 0 },
    distance = { coords = vec3(538.4, 101.9, 96.5), max = 8.0 },
    rate     = { calls = 1, per = 30 },
    onReject = 'log+kick',
}, function(xPlayer, args, source)
    -- le montant vient du serveur, le client ne choisit que la livraison
    xPlayer.addAccountMoney('money', Config.Rewards[args.deliveryId], 'pizza:pay')
end)
```

Le handler reçoit le joueur ESX, les arguments validés rangés par nom, et `source`. Ce `source` reste valide après un `Wait`, contrairement à la variable globale, que FiveM remet à `nil`.

### API

`SafeEvents.register(nom, spec, handler)` enregistre un event réseau.

`SafeEvents.callback(nom, spec, handler)` enregistre un callback `lib.callback` d'ox_lib. Ce que le handler renvoie part au client ; un appel refusé ne renvoie rien.

Options de `spec` (toutes facultatives) :

| Option | Forme | Effet |
|---|---|---|
| `args` | liste ordonnée `{ { name = 'x', type = '...', ... } }` | types et bornes des arguments, dans l'ordre où le client les envoie ; un argument en trop est refusé |
| `job` | `'police'`, `{ 'police', 'sheriff' }` ou `{ name = 'police', minGrade = 2 }` | job requis |
| `distance` | `{ coords = vec3(...) ou liste de vec3, max = 8.0 }` ou `{ netIdArg = 'vehicle', max = 5.0 }` | distance maximale en mètres à un point, au plus proche d'une liste, ou à l'entité dont le client donne le netId |
| `rate` | `{ calls = 1, per = 30 }` | appels autorisés par joueur sur la période, en secondes |
| `onReject` | `'log+kick'` (défaut), `'log'`, `'drop'` ou `function(source, raison)` | que faire d'un appel refusé |

Types d'arguments :

| Type | Options | Refusé |
|---|---|---|
| `integer` | `min`, `max`, `enum` | tout nombre non entier, NaN, l'infini |
| `number` | `min`, `max`, `enum` | NaN, l'infini |
| `string` | `maxLen` (256 par défaut), `pattern` (motif Lua), `enum` | plus long que `maxLen` |
| `boolean` | | tout le reste, y compris `1` |
| `vector3` | | une composante NaN ou infinie |
| `table` | `maxItems` (64 par défaut), `items` (spec de chaque élément) | trop d'éléments, clés non séquentielles quand `items` est donné |

Tout argument peut être `optional = true`. **`maxLen` compte des octets, pas des caractères** : en UTF-8, une lettre accentuée en vaut 2. Prévoyez de la marge pour du texte en français.

Une spec mal écrite (option inconnue, type inconnu, `min` plus grand que `max`, `netIdArg` absent des arguments) lève une erreur au démarrage de la ressource, pas au premier appel.

### Refus, alertes et mode audit

Un appel refusé n'appelle pas le handler. Selon `onReject`, il est journalisé dans la console (`[safe_events] [ressource] event · joueur · règle · argument · valeur reçue`), envoyé au webhook Discord (une alerte par joueur et par event et par minute au plus) et le joueur est expulsé.

Règles possibles dans un refus : `player` (joueur ESX pas encore chargé), `too_many_args`, `required`, `type`, `min`, `max`, `maxLen`, `pattern`, `enum`, `maxItems`, `items`, `job`, `distance`, `rate`.

Avec `set safe_events:mode "audit"`, les violations sont journalisées mais les appels passent, sans expulsion. C'est la façon d'installer safe_events sur un serveur en production : on regarde ce qui serait bloqué pendant quelques jours, puis on passe en `enforce`.

### Statistiques

`SafeEvents.stats()` renvoie, pour chaque event de la ressource : `event`, `calls`, `accepted`, `refused`, `rules` (nombre de violations par règle) et `avgMicros` (coût moyen d'un appel). En mode audit, une violation compte dans `rules` mais l'appel compte comme accepté.

Dans la console serveur, `safe_events stats` affiche ces chiffres pour toutes les ressources qui utilisent safe_events. La commande est restreinte (ace `command.safe_events`).

### Joueur ESX complet ou statique

Mesuré en jeu, `ESX.GetPlayerFromId` coûte environ **300 µs par appel** : ESX copie tout l'objet joueur vers la ressource qui le demande. N'importe quel handler ESX qui l'appelle paie ce prix.

```cfg
set safe_events:esxPlayer "full"     # par défaut : le handler reçoit le xPlayer habituel
set safe_events:esxPlayer "static"   # vérifications et joueur légers
```

En mode `static`, safe_events vérifie le joueur avec `ESX.IsPlayerLoaded` et lit son métier sans récupérer l'objet complet (environ 20 µs mesurés pour ces deux appels). Le handler reçoit un joueur statique, comme `ESX.Player(src)` : toutes les méthodes marchent (`xPlayer.addAccountMoney(...)`, `xPlayer.getJob()`), mais pas les champs directs (`xPlayer.job`, `xPlayer.name`). `xPlayer.src` et `xPlayer.source` sont renseignés.

### Limites

- ESX Legacy seulement pour l'instant (adaptateur dans `safe_events/adapters/`). QBox et ox_core sont prévus.
- safe_events valide ce que le client envoie. Il ne remplace ni un anticheat ni la logique métier : le montant payé doit toujours venir du serveur.

---

## fxaudit

### Lancer

Avec Docker, sans rien installer :

```sh
docker build -t fxaudit https://github.com/Endeau/fivem-safe.git#main:fxaudit
docker run --rm -v "$PWD/resources:/src" fxaudit /src
```

Avec Node 20 ou plus (une fois le paquet publié sur npm) :

```sh
npx fxaudit resources
```

Options :

| Option | Effet |
|---|---|
| `--html rapport.html` | rapport HTML autonome en français, à remettre au propriétaire du serveur |
| `--sarif fxaudit.sarif` | SARIF 2.1.0 pour GitHub code scanning |
| `--json` | sortie JSON |
| `--no-color` | pas de couleurs |

Code de sortie : 0 sans problème critique, 1 s'il y en a au moins un, 2 si fxaudit n'a pas pu tourner.

### Règles

| Règle | Gravité | Ce qu'elle détecte |
|---|---|---|
| FX001 | critique | argent dont le montant vient du client (`addMoney`, `addAccountMoney`, `Functions.AddMoney`, `ox_inventory` `AddItem('money')`…) |
| FX002 | critique | item ou quantité venant du client (`addInventoryItem`, `addWeapon`, `ox_inventory:AddItem`) |
| FX003 | critique | action sur un joueur cible choisi par le client, sans contrôle de job, de droits ou de distance |
| FX004 | critique | requête SQL construite par concaténation avec une valeur du client |
| FX007 | avertissement | `source` lu après un `Wait`, un `await` ou dans un rappel, où il ne vaut plus le joueur |
| FX101 | critique | réponse de `PerformHttpRequest` passée à `load` : le motif des backdoors |

Un montant borné par un test que NaN traverse (`if amount > 500 then return end`) est signalé en confiance moyenne : un client modifié peut envoyer 0/0, et toute comparaison avec NaN est fausse. Les fonctions d'argent d'ESX refusent NaN d'elles-mêmes et ne sont pas concernées.

Pour ignorer une alerte vérifiée à la main, commentez la ligne ou celle du dessus : `-- fxaudit-ignore FX001`.

fxaudit lit la syntaxe propre à FiveM (`+=`, `?.`, les hash entre backticks, `<const>`), ignore les scripts client déclarés dans les `fxmanifest.lua` et comprend les handlers ESX, QBCore et ox_lib.

### Dans une CI

GitHub, avec l'action de ce dépôt (les alertes arrivent dans l'onglet Security) :

```yaml
# .github/workflows/fxaudit.yml
name: fxaudit
on: [push, pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  fxaudit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Endeau/fivem-safe@main
        with:
          path: resources
          html-file: fxaudit.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: fxaudit-report
          path: fxaudit.html
```

GitLab CI :

```yaml
fxaudit:
  image: node:22-alpine
  script:
    - npx --yes fxaudit resources --html fxaudit.html
  artifacts:
    when: always
    paths: [fxaudit.html]
```

### Limites

- L'analyse s'arrête au fichier : un event déclaré dans un fichier et traité dans un autre n'est pas suivi.
- Les bornes basses ne sont pas suivies : un montant négatif n'est pas signalé.
- Les API internes de QBox et d'ox_inventory (`Inventory.AddItem`…) ne sont pas encore modélisées. Zéro alerte sur ces ressources ne prouve rien.
- FX003 est une heuristique : toute condition sur le job ou la cible la fait taire.
- Aucune alerte ne veut pas dire aucune faille.

Mesure sur le code officiel d'ESX (esx_core et esx-legacy-addons, 617 fichiers) : 3 alertes, toutes vraies, aucun faux positif ; les 2 alertes FX007 ont été confirmées en jeu. Le détail est dans [fxaudit/CORPUS.md](fxaudit/CORPUS.md).

---

## Développement

Rien n'est installé sur la machine : tout tourne dans Docker.

```sh
docker compose run --rm busted                 # tests de safe_events
docker compose run --rm node npm ci            # fxaudit, une fois
docker compose run --rm node npm test          # tests de fxaudit
```

`devserver/` monte un FXServer avec ESX Legacy et une ressource de démo (`/se_all`) pour essayer safe_events en jeu. Il faut une clé de licence Cfx : voir `devserver/.env.example`.

## Sécurité

Vous avez trouvé une faille dans safe_events ou fxaudit ? Ouvrez un signalement privé (onglet Security → Report a vulnerability), pas une issue publique. Voir [SECURITY.md](SECURITY.md).

## Licence

MIT, © 2026 Enzo Grassi ([endeau.fr](https://endeau.fr)).

---

<a id="english"></a>

## English

Two free, open-source tools for FiveM servers that are done paying cheaters.

A modified client can trigger any net event with any arguments. Every server handler that trusts what the client sends (an amount, an item, a target player, a piece of SQL) is an exploit.

- **safe_events**: a resource where each event declares what the server accepts. Invalid calls never reach your handler.
- **fxaudit**: a static analyzer that reads your resources without running them and finds the handlers that trust the client.

Each fxaudit finding suggests the fix with safe_events. Messages and reports are in French for now.

### safe_events

Tested on ESX Legacy with ox_lib, on a real FXServer.

```cfg
ensure es_extended
ensure safe_events
set safe_events:mode "enforce"   # "audit" logs without blocking
set safe_events:webhook "https://discord.com/api/webhooks/..."   # optional, keep it `set`, never `setr`
```

```lua
-- fxmanifest.lua
server_script '@safe_events/import.lua'
```

```lua
SafeEvents.register('pizza:pay', {
    args     = { { name = 'deliveryId', type = 'integer', min = 1, max = #Config.Rewards } },
    job      = { name = 'pizza', minGrade = 0 },
    distance = { coords = vec3(538.4, 101.9, 96.5), max = 8.0 },
    rate     = { calls = 1, per = 30 },
    onReject = 'log+kick',
}, function(xPlayer, args, source)
    xPlayer.addAccountMoney('money', Config.Rewards[args.deliveryId], 'pizza:pay')
end)
```

- `args` is an ordered list; types are `integer`, `number`, `string`, `boolean`, `vector3`, `table`, with `min`, `max`, `maxLen`, `pattern`, `enum`, `maxItems`, `items`, `optional`. NaN and infinity are always refused. **`maxLen` counts bytes**: an accented letter is 2 bytes in UTF-8.
- `job`, `distance` (to a point, the closest of a list, or an entity given by netId), `rate` per player, `onReject` (`'log+kick'` by default, `'log'`, `'drop'` or a function).
- The handler gets the ESX player, the validated arguments by name, and a `source` that stays valid after a `Wait`.
- `SafeEvents.callback` does the same for ox_lib callbacks.
- Audit mode logs violations and lets calls through, to roll safe_events out on a live server.
- `SafeEvents.stats()` and the `safe_events stats` console command show calls, accepted, refused, violations per rule and average cost per event.
- `set safe_events:esxPlayer "static"` avoids `ESX.GetPlayerFromId`, measured in game at about 300 µs per call: the checks use `ESX.IsPlayerLoaded` and the job through the static player (about 20 µs), and the handler gets a static player like `ESX.Player(src)` (methods work, fields like `xPlayer.job` do not). The default, `"full"`, keeps the usual xPlayer.
- Limits: ESX Legacy only for now; safe_events validates input, it does not replace an anticheat or server-side business logic.

### fxaudit

```sh
docker build -t fxaudit https://github.com/Endeau/fivem-safe.git#main:fxaudit
docker run --rm -v "$PWD/resources:/src" fxaudit /src --html report.html --sarif fxaudit.sarif
# or, once published: npx fxaudit resources
```

Rules: FX001 client-controlled money, FX002 client-controlled items or counts, FX003 client-chosen target player without checks, FX004 SQL built from client data, FX007 `source` read after a wait, FX101 HTTP response passed to `load` (backdoor pattern). Bounds that NaN goes through are reported with medium confidence. Silence a reviewed line with `-- fxaudit-ignore FX001`. Exit code 1 on critical findings.

GitHub Action: `uses: Endeau/fivem-safe@main` with `path`, `sarif-file`, `html-file`, `upload`, `fail-on-critical` (see the workflow above).

Limits: per-file analysis, no lower bounds, QBox and ox_inventory internals not modeled yet, and no findings does not mean no exploit. On official ESX code (617 files): 3 findings, all true, no false positive; both FX007 findings were confirmed in game.

### Security

Found a vulnerability in safe_events or fxaudit? Open a private advisory (Security tab → Report a vulnerability), not a public issue.

### License

MIT, © 2026 Enzo Grassi ([endeau.fr](https://endeau.fr)).
