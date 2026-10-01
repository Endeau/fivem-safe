-- The safe_events resource itself: receives the reports of every resource
-- that uses the import, logs them, alerts Discord and kicks when asked.
--
-- server.cfg:
--   ensure safe_events
--   set safe_events:mode "enforce"            # or "audit" to log without blocking
--   set safe_events:webhook "https://discord.com/api/webhooks/..."  # optional, keep it `set`, never `setr`

local WEBHOOK_COOLDOWN_MS = 60 * 1000
local KICK_MESSAGE = 'Action refusée par le serveur (safe_events).'

local lastAlert = {}

local function identifiers(src)
  local ids = {}
  for _, id in ipairs(GetPlayerIdentifiers(src)) do
    local kind = id:match('^(%w+):')
    if kind == 'license' or kind == 'discord' or kind == 'steam' then ids[#ids + 1] = id end
  end
  return table.concat(ids, ' ')
end

local function describe(resource, reason)
  local parts = {
    ('[%s] %s'):format(resource, reason.event),
    ('joueur %s (%s)'):format(tostring(reason.source), GetPlayerName(reason.source) or '?'),
    ('règle %s'):format(reason.rule),
  }
  if reason.arg then parts[#parts + 1] = ('argument %s'):format(reason.arg) end
  if reason.got ~= nil then parts[#parts + 1] = ('reçu %s'):format(tostring(reason.got)) end
  if reason.audit then parts[#parts + 1] = 'mode audit, non bloqué' end
  if reason.kick then parts[#parts + 1] = 'expulsé' end
  return table.concat(parts, ' · ')
end

local function alertDiscord(line, src, reason)
  local webhook = GetConvar('safe_events:webhook', '')
  if webhook == '' then return end

  -- One alert per player and event per minute, so a cheat looping on an
  -- event cannot get the webhook rate-limited by Discord.
  local key = ('%s|%s'):format(src, reason.event)
  local now = GetGameTimer()
  if lastAlert[key] and now - lastAlert[key] < WEBHOOK_COOLDOWN_MS then return end
  lastAlert[key] = now

  local body = json.encode({
    username = 'safe_events',
    content = ('```%s```%s'):format(line:gsub('`', "'"), identifiers(src)),
  })
  PerformHttpRequest(webhook, function(status)
    if status >= 200 and status < 300 then
      print(('[safe_events] alerte Discord envoyée (%s)'):format(reason.event))
    else
      print(('^3[safe_events] webhook Discord refusé (HTTP %s)^0'):format(tostring(status)))
    end
  end, 'POST', body, { ['Content-Type'] = 'application/json' })
end

exports('report', function(resource, reason)
  local src = reason.source
  local line = describe(resource, reason)
  print(('^1[safe_events]^0 %s'):format(line))
  alertDiscord(line, src, reason)
  if reason.kick and GetPlayerName(src) then
    DropPlayer(src, KICK_MESSAGE)
  end
end)

AddEventHandler('playerDropped', function()
  local prefix = ('%s|'):format(source)
  for key in pairs(lastAlert) do
    if key:sub(1, #prefix) == prefix then lastAlert[key] = nil end
  end
end)

-- `safe_events stats` in the server console: calls, refusals and cost per
-- event, for every resource that loads the import.

local attached = {}

exports('attach', function(resource, getStats)
  attached[resource] = getStats
end)

AddEventHandler('onResourceStop', function(resource)
  attached[resource] = nil
end)

local function formatRules(rules)
  local parts = {}
  for rule, count in pairs(rules) do parts[#parts + 1] = ('%s %d'):format(rule, count) end
  table.sort(parts)
  return #parts > 0 and table.concat(parts, ', ') or '-'
end

local function printStats()
  local resources = {}
  for resource in pairs(attached) do resources[#resources + 1] = resource end
  table.sort(resources)
  if #resources == 0 then return print('[safe_events] aucune ressource n\'utilise safe_events') end

  print(('[safe_events] mode %s'):format(GetConvar('safe_events:mode', 'enforce')))
  for _, resource in ipairs(resources) do
    local ok, stats = pcall(attached[resource])
    if ok then
      print(('[safe_events] %s'):format(resource))
      for _, s in ipairs(stats) do
        print(('[safe_events]   %-28s appels %6d  acceptés %6d  bloqués %6d  coût %s  règles : %s'):format(
          s.event, s.calls, s.accepted, s.refused,
          s.avgMicros and ('%.1f µs'):format(s.avgMicros) or '-', formatRules(s.rules)))
      end
    end
  end
end

exports('printStats', printStats)

RegisterCommand('safe_events', function(src, args)
  if args[1] == 'stats' then return printStats() end
  print('Usage : safe_events stats')
end, true)
