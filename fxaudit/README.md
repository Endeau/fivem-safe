# fxaudit

Finds FiveM server events that trust what the client sends: money, items, target players, SQL, plus `source` read after a wait and download-and-run backdoors. Reads the Lua without running it, understands FiveM's Lua syntax (`+=`, `?.`, backtick hashes) and skips client scripts declared in `fxmanifest.lua`.

Messages and reports are in French.

```sh
npx fxaudit resources                          # terminal
npx fxaudit resources --html rapport.html      # report for the server owner
npx fxaudit resources --sarif fxaudit.sarif    # GitHub code scanning
```

Exit code 0 without critical problems, 1 with at least one, 2 if fxaudit could not run. Silence a reviewed line with `-- fxaudit-ignore FX001`.

| Rule | Detects |
|---|---|
| FX001 | client-controlled money (`addMoney`, `addAccountMoney`, `Functions.AddMoney`, ox_inventory `AddItem('money')`) |
| FX002 | client-controlled item or count (`addInventoryItem`, `addWeapon`, `ox_inventory:AddItem`) |
| FX003 | action on a target player chosen by the client, without job, rights or distance checks |
| FX004 | SQL built by concatenating client data |
| FX007 | `source` read after `Wait`, an `await` or in a callback |
| FX101 | `PerformHttpRequest` response passed to `load` (backdoor pattern) |

Each finding suggests a fix with [safe_events](https://github.com/Endeau/fivem-safe#safe_events), the companion resource that validates net events on the server.

Documentation, GitHub Action and limits: https://github.com/Endeau/fivem-safe#fxaudit. MIT licence.
