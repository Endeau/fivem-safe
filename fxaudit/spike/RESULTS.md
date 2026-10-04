# Spike : quel parseur pour le Lua de FiveM ?

Date : 25 septembre 2026. Reproduire : `./run.sh` (tout tourne dans Docker, sortie brute dans `results.json`).

## Ce que FiveM ajoute au Lua 5.4

Source : README de [citizenfx/lua, branche luaglm-dev/cfx](https://github.com/citizenfx/lua/blob/luaglm-dev/cfx/README.md), section « Power Patches ».

| Extension | Exemple | Géré par la réécriture |
|---|---|---|
| Opérateurs composés | `total += 5`, `flags <<= 1` (`+= -= *= /= <<= >>= &= \|= ^=`) | oui, `+=` devient ` =` et l'opérateur est noté |
| Navigation sûre | `xPlayer?.job?.name`, `rows?[1]` | oui, `?` devient une espace |
| Hash à la compilation | `` `WEAPON_PISTOL` `` | oui, devient `"WEAPON_PISTOL"` et le hash est noté |
| Déballage `in` | `local name, grade in xPlayer.job` | oui, `in` devient `= ` et c'est noté |
| Constructeur d'ensemble | `{ .police, .sheriff }` | oui, `.` devient une espace et le champ est noté |
| Commentaires C | `/* ... */` | oui, remplacés par des espaces |
| Attributs Lua 5.4 (standard, mais absents de luaparse) | `local x <const> = 1` | oui, remplacés par des espaces |
| `defer` | `defer ... end` | **non** : désactivé dans FiveM (voir plus bas) |

`defer` existe dans citizenfx/lua (`GRIT_POWER_DEFER`) mais n'est pas activé dans FiveM : es_extended appelle `deferrals.defer()` et ox_lib définit une fonction `defer(...)`. Ces fichiers ne compileraient pas si `defer` était un mot-clé. La fixture `nofivem_defer.lua` le documente et échoue volontairement.

Les vecteurs (`vec3(...)`, `vector3(...)`) sont de simples appels de fonction, rien à faire.

## Candidats

1. **luaparse 0.3.1** tel quel (Lua 5.3).
2. **luaparse + réécriture** (`rewrite.mjs`) : une passe qui transforme le CfxLua en Lua 5.3 **à longueur égale, sans toucher aux retours à la ligne**. Chaque nœud de l'AST garde donc sa ligne, sa colonne et son offset d'origine. Chaque réécriture est notée (`marks`) pour que l'analyseur retrouve le vrai sens.
3. **tree-sitter** (`web-tree-sitter` 0.27.0 + `@tree-sitter-grammars/tree-sitter-lua` 0.4.1 en WASM), avec ou sans la même réécriture.
4. Autres pistes regardées sur le papier : lua-language-server (son parseur accepte `+=`, `` ` `` et `/* */` via `nonstandardSymbol`, la navigation sûre passe par un plugin de réécriture de texte ; il faudrait faire tourner LuaLS et sérialiser son AST, beaucoup plus lourd pour le même résultat). Aucun parseur JavaScript, Rust ou Python ne gère CfxLua nativement d'après la recherche. `tree-sitter-wasms` 0.1.13 embarque une grammaire Lua trop ancienne pour web-tree-sitter ≥ 0.25 (ABI refusée).

## Résultats

### Fixtures (`fixtures/`)

| Fichier | luaparse seul | luaparse + réécriture | tree-sitter seul |
|---|---|---|---|
| `esx_job_server.lua` (ESX réaliste, Lua 5.4 standard) | échec `<close>` | ok, 0 position fausse sur 106 identifiants | ok |
| `cfx_compound.lua` | échec | ok | 10 nœuds ERROR |
| `cfx_safenav.lua` | échec | ok | 1 nœud MISSING (`f?.()`) |
| `cfx_backtick.lua` | échec | ok | ok (tolère le backtick) |
| `cfx_in_unpack.lua` | échec | ok | 2 ERROR |
| `cfx_set_ctor.lua` | échec | ok | 4 ERROR |
| `cfx_ccomment.lua` | échec | ok | 2 ERROR |
| `cfx_mixed_real.lua` (plusieurs extensions dans un vrai handler) | échec | ok, 9 réécritures | 6 ERROR, mais les appels sensibles sont retrouvés |
| `nofivem_defer.lua` | échec attendu | échec attendu | échec attendu |

Les deux parseurs trouvent exactement les mêmes appels sensibles, aux mêmes positions : `.addMoney@16:12`, `:addAccountMoney@17:12`, `.addInventoryItem@23:12`, `:AddItem@24:25`, `.addMoney@43:24`, puis `.removeAccountMoney@11:12` et `.addAccountMoney@13:16` dans le fichier mixte.

### Corpus réel

1 003 fichiers `.lua` (4,7 Mo) : esx_core, esx-legacy-addons, ox_lib, ox_inventory, qbx_core. Meilleur temps sur 3 passes, Node 22 dans Docker.

| Parseur | Fichiers en échec | Temps total |
|---|---|---|
| luaparse seul | **144 / 1 003** | 77 ms |
| **luaparse + réécriture** | **0 / 1 003** | 289 ms |
| tree-sitter seul | 73 / 1 003 | 610 ms |
| tree-sitter + réécriture | 0 / 1 003 | 745 ms |

Positions : sur tout le corpus réécrit, **168 324 identifiants** ont été relus dans le fichier d'origine à l'offset donné par luaparse. **0 écart.**

Ce que montrent les 144 échecs de luaparse seul : le CfxLua est partout, y compris dans les addons officiels ESX. Exemples : `society?.` (esx_addonaccount), `+=` (esx_ambulancejob, esx_cruisecontrol, esx_dmvschool), `` ` `` (esx_banking), `<const>` (esx_garage). Un analyseur sans réécriture raterait un fichier sur sept.

## Recommandation : luaparse + réécriture

- **Zéro échec** sur le corpus et **positions exactes** vérifiées sur 168 000 identifiants.
- **AST typé et simple** (style ESTree) : `FunctionDeclaration.parameters`, `LocalStatement`, `AssignmentStatement`, `CallExpression` dont la base `MemberExpression` porte `indexer: '.'` ou `':'`. C'est exactement ce qu'il faut pour suivre une valeur d'un paramètre de handler jusqu'à `addMoney`. Le CST de tree-sitter demande plus de code pour le même parcours.
- **Rapide** : environ 0,3 ms par fichier, soit ~150 ms pour 500 fichiers. La réécriture en représente les trois quarts et reste optimisable.
- **Léger** : un fichier JS, licence MIT, aucune dépendance native ni WASM.

tree-sitter + réécriture reste le **plan B** documenté. Il fonctionne aussi (0 échec) et sa récupération d'erreur donne un arbre partiel sur un fichier cassé ou obfusqué, ce qui peut servir aux règles de backdoor (FX101/FX102). À n'ajouter que si un cas réel le demande.

## Risques restants

1. **luaparse n'est plus maintenu** (0.3.1, dernière publication juin 2022). Parade : le vendorer dans `fxaudit/vendor/` (un seul fichier, MIT) pour pouvoir le corriger. Le Lua 5.3 ne bouge plus, et ce qui manque est couvert par la réécriture.
2. **La réécriture change le sens de certains nœuds** : l'analyseur doit lire `marks` pour les rétablir.
   - `total += amount` apparaît comme `total = amount` : c'est en fait `total = total + amount`.
   - `local a, b in t` apparaît comme `local a, b = t` : c'est en fait `t.a, t.b`.
   - `{ .police }` apparaît comme `{ police }` (lecture d'une globale) : c'est une clé `police = true`.
   - `` `adder` `` apparaît comme une chaîne : c'est un nombre.
   - `a?.b` apparaît comme `a.b` : un accès protégé.
   Il faut une fonction `markAt(range)` et des tests par extension.
3. **Le scanner est écrit à la main.** Il gère chaînes courtes et longues, commentaires, nombres (`.5`, `0x1p4`) et `..`. Il reste à couvrir par des tests unitaires dédiés : backtick ou `?` à l'intérieur de chaînes et de commentaires longs imbriqués, `{ ... }` avec varargs, `local a <const>, b <close>`.
4. **Colonnes en UTF-16** : luaparse compte en unités JS (UTF-16), tree-sitter en octets. Sans conséquence pour l'affichage ligne:colonne ; à garder en tête pour le SARIF (colonnes en unités UTF-16 par défaut, ça tombe bien).
5. **`^=`** est ambigu dans la doc Cfx (XOR ou puissance). Sans effet sur une analyse de propagation, qui ne regarde que le flux de données.
6. **Commentaires C** : présents dans citizenfx/lua, activation dans FiveM non confirmée. Les accepter ne coûte rien.

## Fichiers

- `fixtures/*.lua` : 9 fixtures (ESX réaliste, une par extension, un mélange réel, `defer` hors FiveM).
- `rewrite.mjs` : la réécriture à longueur égale, avec ses `marks`.
- `spike.mjs` : comparaison sur les fixtures, benchmark et contrôle des positions sur le corpus.
- `run.sh` : clone le corpus (une fois), installe les dépendances épinglées et écrit `results.json`, le tout dans Docker.
- `package.json` : versions épinglées. `corpus/`, `node_modules/` et `results.json` sont ignorés par git.
