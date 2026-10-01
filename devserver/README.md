# Serveur de dev

FXServer, MariaDB et ESX Legacy dans Docker, déployés par la CI. Il sert à tester
safe_events en jeu : `/se_all` joue le scénario complet, `/se_esx` montre des bugs
ESX avant et après correctif. Les résultats se lisent dans les logs du serveur.

## Deux règles, vérifiées par la CI

`scripts/check-resources.sh` fait échouer le pipeline si l'une n'est pas respectée.

1. **Chaque ressource de `resources/` doit être montée dans `docker-compose.yml`.**
   Le compose monte les ressources une par une : une ressource seulement listée dans
   `server.cfg` n'existe pas pour FiveM (« Couldn't find resource »).
2. **Une ressource qui en redémarre une autre ne doit pas en dépendre.** Avant de
   redémarrer une ressource, FiveM arrête celles qui en dépendent : la ressource qui a
   lancé le redémarrage s'arrête au milieu de son propre script et le serveur se bloque.
   Pour redémarrer, une ressource a besoin des aces `command.restart`, `command.stop`
   et `command.start`.

## Modifier une autre ressource

Depuis 2025, FiveM interdit à une ressource d'écrire dans les fichiers d'une autre :
`SaveResourceFile` échoue sans erreur. `/se_esx` ne modifie donc rien pendant le jeu.
Au déploiement, `scripts/make-variants.lua` écrit des copies des ressources ESX
(`[esx_variants]/<ressource>_probe` et `_fixed`) à partir de
`resources/esx_source_check/fixes.lua`, et la commande bascule d'une copie à l'autre
avec `stop` et `start`.
