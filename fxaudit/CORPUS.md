# fxaudit sur le code officiel d'ESX

Mesure du 25 septembre 2026, fxaudit 0.1.0. Pour reproduire :

```sh
sh corpus/fetch.sh
docker compose run --rm node node src/cli.ts ../corpus/cache
```

## Corpus

| Dépôt | Commit | Fichiers Lua analysés | Handlers serveur | Alertes |
|---|---|---|---|---|
| esx-framework/esx_core | `fe59ca0` | 170 | 30 | 0 |
| esx-framework/esx-legacy-addons | `ccda737` | 447 | 108 | 1 critique, 2 avertissements |

133 scripts client ignorés (déclarés `client_script(s)` dans leur fxmanifest), 0 fichier illisible, moins d'une seconde pour l'ensemble.

Contrôle complémentaire, hors ESX (corpus du spike : ox_inventory, ox_lib, qbx_core) : 172 fichiers, 81 handlers, 0 alerte. Ces ressources utilisent surtout leurs propres API internes (`Inventory.AddItem`…), que la v0.1 ne connaît pas : ce zéro ne prouve donc rien sur elles.

## Tri des alertes

| Règle | Emplacement | Verdict |
|---|---|---|
| FX002 | un addon officiel d'ESX | **Vrai positif, impact faible.** À signaler en privé aux mainteneurs ; les détails seront publiés après correction. |
| FX007 | `esx_vehicleshop/server/main.lua:380` (`esx_vehicleshop:returnProvider`) | **Vrai positif, bug mineur, confirmé en jeu.** `source` lu dans le rappel asynchrone de `MySQL.single`, seulement dans un `print` d'avertissement : le log n'indique pas le bon joueur. |
| FX007 | `esx_vehicleshop/server/main.lua:545` (`esx_vehicleshop:setJobVehicleState`) | **Vrai positif, bug mineur, confirmé en jeu.** Même cas dans le rappel de `MySQL.update`. |

Bilan : 3 alertes, 3 vraies, 0 faux positif. Une seule concerne la sécurité, et son impact est faible.

## Vérifié en jeu (26 septembre 2026)

Sur le serveur de dev, avec un vrai client et ESX tel que distribué, puis avec le correctif (`xPlayer.src` à la place de `source`) :

| Alerte | Avant correctif | Après correctif | Verdict |
|---|---|---|---|
| FX007 `esx_vehicleshop:returnProvider` | le log affiche `Player nil` | `Player 1` | confirmée |
| FX007 `esx_vehicleshop:setJobVehicleState` | le log affiche `Player nil` | `Player 1` | confirmée |
| FX007 `esx_jobs:caution` (rappel de `TriggerEvent`) | une sonde dans le rappel affiche `source = 1` | - | **faux positif**, corrigé |

La v0.1 supposait que `source` change pendant un `TriggerEvent` local, dont le rappel s'exécute tout de suite. Le test en jeu montre que `source` y reste celui de l'appelant : fxaudit traite maintenant ces rappels comme synchrones. Un rappel de `TriggerEvent` placé après un `Wait` reste signalé, comme tout code qui suit un `Wait`.

## Faux positifs corrigés pendant la mise au point

Le premier passage donnait 12 alertes, dont 8 FX002 fausses. Chaque fois, le handler validait le nom de l'item par une recherche côté serveur : `xPlayer.getInventoryItem(name)`, `inventory.getItem(name)` ou `xPlayer.hasWeapon(name)`, puis `if not item then return end`. Il bornait aussi la quantité par une comparaison avec le stock (`item.count >= count`) ou par `canCarryItem`.

fxaudit reconnaît maintenant ces validations :
- le résultat d'un appel de méthode sur un objet serveur, testé ensuite, valide les valeurs du client passées à cet appel ;
- `a and b` négatif ou `a or b` positif gardent ce que les deux côtés prouvent, par exemple `(item ~= 'medikit' and item ~= 'bandage')` suivi de `return`.

Les recherches de joueur (`ESX.GetPlayerFromId`…) ne comptent pas comme validation : n'importe quel id connecté trouve un joueur.

## Paiements non signalés, vérifiés à la main

Les paiements d'ESX (`addMoney`, `addAccountMoney`) ont été relus : montants tirés de `Config` ou de `math.random`, montants bornés par le solde d'un autre joueur, commandes admin. Aucun ne reçoit un montant du client sans contrôle.

## v0.2 : bornes que NaN traverse

Un client modifié peut envoyer NaN (0/0). Toute comparaison avec NaN est fausse, donc `if amount > 500 then return end` le laisse passer. fxaudit signale maintenant ces bornes en confiance moyenne, sauf si le code exclut NaN (`amount ~= amount`, ou un test écrit à l'endroit comme `if amount >= 1 and amount <= 500 then`).

Premier passage sur le corpus : 1 alerte NaN dans `es_extended` (`esx:giveInventoryItem`, branche argent). Vérifiée à la main, elle n'est pas exploitable : `addAccountMoney` et `setAccountMoney` d'ESX testent `money > 0` (ou `>= 0`), que NaN ne passe pas. fxaudit connaît maintenant ce comportement et ne signale plus NaN sur les fonctions d'argent d'ESX. Il le signale toujours sur `addInventoryItem` (ESX fait `item.count + count`), sur `AddMoney` de l'ancien qb-core (qui ne teste que `amount < 0`) et sur `AddItem` d'ox_inventory (`count <= 0` ne rejette pas NaN).

Bilan après ce changement : les mêmes 4 alertes qu'en v0.1 sur ESX (3 depuis la correction du faux positif `esx_jobs`, voir « Vérifié en jeu »), 0 alerte sur ox_inventory, ox_lib et qbx_core (`qbx_core` refuse NaN avec `isFinite`).
