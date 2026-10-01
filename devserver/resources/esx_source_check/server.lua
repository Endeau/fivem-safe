-- /se_esx, typed in game by a single player.
-- Each ESX bug runs twice: with a probe that prints what really happens, then
-- with the proposed fix. ESX as shipped is put back at the end.

local ESX = exports.es_extended:getSharedObject()

local function log(message, ...)
  print(('^3[esx_check]^0 ' .. message):format(...))
end

local FIXES = assert(load(LoadResourceFile(GetCurrentResourceName(), 'fixes.lua'), '@fixes.lua'))()

-- Runs one version of each patched resource: 'original' (ESX as shipped),
-- 'probe' (original plus a print that shows the bug) or 'fixed'. The copies
-- are written at install time by scripts/make-variants.lua; here the server
-- only stops one version and starts another.
local function setMode(mode)
  local resources, order = {}, {}
  for _, fix in ipairs(FIXES) do
    if not resources[fix.resource] then
      resources[fix.resource] = {}
      order[#order + 1] = fix.resource
    end
    if fix.probe then resources[fix.resource].probe = true end
    if fix.fixed then resources[fix.resource].fixed = true end
  end

  for _, resource in ipairs(order) do
    local wanted = resource
    if mode ~= 'original' and resources[resource][mode] then wanted = resource .. '_' .. mode end

    for _, name in ipairs({ resource, resource .. '_probe', resource .. '_fixed' }) do
      if name ~= wanted and GetResourceState(name) == 'started' then ExecuteCommand('stop ' .. name) end
    end
    if GetResourceState(wanted) ~= 'started' then ExecuteCommand('start ' .. wanted) end
    Wait(1500)

    if GetResourceState(wanted) ~= 'started' then
      log('ÉCHEC : %s n\'a pas démarré (état %s), test arrêté', wanted, GetResourceState(wanted))
      return false
    end
    log('%s : version %s en route (%s)', resource, mode, wanted)
  end
  return true
end

-- Stopping esx_vehicleshop also stops the resources that depend on it
-- (several job resources). The run notes what was started and
-- starts again whatever went down on the way.
local function startedResources()
  local started = {}
  for i = 0, GetNumResources() - 1 do
    local name = GetResourceByFindIndex(i)
    if name and GetResourceState(name) == 'started' then started[#started + 1] = name end
  end
  return started
end

local function restartStopped(before)
  local restarted = {}
  for _, name in ipairs(before) do
    if GetResourceState(name) ~= 'started' then
      ExecuteCommand('start ' .. name)
      restarted[#restarted + 1] = name
    end
  end
  if #restarted > 0 then log('Ressources relancées : %s', table.concat(restarted, ', ')) end
end

local notified = {}

RegisterNetEvent('esx_source_check:notified', function(message)
  local list = notified[source]
  if list then list[#list + 1] = message end
end)

-- Sends one event from the player's client and collects the notifications it gets back.
local function sendFromClient(src, eventName, args)
  notified[src] = {}
  TriggerClientEvent('esx_source_check:send', src, eventName, args)
  Wait(2500)
  local got = notified[src]
  notified[src] = nil
  return got
end

local function run(src, label)
  local xPlayer = ESX.GetPlayerFromId(src)
  local ped = GetPlayerPed(src)
  log('---- %s ----', label)

  -- 1. esx_jobs:caution give_back: the notification uses `source` inside a nested event.
  TriggerEvent('esx_addonaccount:getAccount', 'caution', xPlayer.getIdentifier(), function(account)
    account.addMoney(1000)
  end)
  local got = sendFromClient(src, 'esx_jobs:caution', { 'give_back', 0.5, 0, 0 })
  local returned = false
  for _, message in ipairs(got) do returned = returned or message ~= '' end
  log('[%s] esx_jobs caution rendue : notification reçue par le joueur = %s (%d message(s))',
    label, returned and 'OUI' or 'NON', #got)

  -- 2. esx_vehicleshop:setJobVehicleState: the warning prints `source` in an async callback.
  log('[%s] esx_vehicleshop garage : la ligne WARNING ci-dessous doit nommer le joueur %d', label, src)
  sendFromClient(src, 'esx_vehicleshop:setJobVehicleState', { 'ZZZZ9999', true })

  -- 3. esx_vehicleshop:returnProvider: same in another handler; needs the cardealer job near the boss office.
  xPlayer.setJob('cardealer', 0)
  SetEntityCoords(ped, -32.0, -1114.2, 25.4, false, false, false, false)
  Wait(1500)
  log('[%s] esx_vehicleshop retour fournisseur : la ligne WARNING ci-dessous doit nommer le joueur %d', label, src)
  sendFromClient(src, 'esx_vehicleshop:returnProvider', { 'not_a_real_model' })
  xPlayer.setJob('unemployed', 0)
end

RegisterCommand('se_esx', function(src)
  if src == 0 then return log('à lancer depuis le jeu') end
  CreateThread(function()
    log('==== Bugs de source ESX : avant / après correctif ====')
    local before = startedResources()
    if setMode('probe') then run(src, 'AVANT') end
    if setMode('fixed') then run(src, 'APRÈS') end
    setMode('original')
    restartStopped(before)
    log('==== Fini : ESX d\'origine remis en route ====')
  end)
end, false)
