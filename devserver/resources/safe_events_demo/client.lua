-- Commands that play the cheater. /se_all runs the whole test on its own;
-- the results are written to the server logs.

local ESX = exports.es_extended:getSharedObject()
local PAY_POINT = vec3(195.2, -933.8, 30.7)
local FAR_POINT = vec3(425.1, -979.5, 30.7) -- Mission Row, about 240 m away

local function say(message)
  ESX.ShowNotification(message)
  print(('[safe_events_demo] %s'):format(message))
end

local function step(label)
  TriggerServerEvent('demo:step', label)
  say(label)
end

local function teleport(point)
  local ped = PlayerPedId()
  SetEntityCoords(ped, point.x, point.y, point.z, false, false, false, false)
  Wait(1500) -- let the server see the new position
end

local function cheat()
  TriggerServerEvent('demo:safePay', 10000000)   -- above max
  TriggerServerEvent('demo:safePay', 0 / 0)      -- NaN
  TriggerServerEvent('demo:safePay', '1')        -- string
  TriggerServerEvent('demo:safePay', 1, 'extra') -- extra argument
end

local function price(item)
  local value = lib.callback.await('demo:price', false, item)
  say(('Prix de %s : %s'):format(item, value and (value .. ' $') or 'refusé'))
end

local function spawnVehicle(model, point)
  local hash = joaat(model)
  RequestModel(hash)
  while not HasModelLoaded(hash) do Wait(50) end
  local vehicle = CreateVehicle(hash, point.x, point.y, point.z, 0.0, true, false)
  SetModelAsNoLongerNeeded(hash)
  while not NetworkGetEntityIsNetworked(vehicle) do Wait(50) end
  Wait(1000) -- let the server create its copy
  return vehicle, NetworkGetNetworkIdFromEntity(vehicle)
end

RegisterCommand('se_all', function()
  CreateThread(function()
    step('1/13 Faille : demo:unsafePay avec 1 000 000 $ (attendu : accepté, c\'est le problème)')
    TriggerServerEvent('demo:unsafePay', 1000000)
    Wait(1000)

    step('2/13 Paie normale au point de paie (attendu : ACCEPTÉ +300 $)')
    teleport(PAY_POINT)
    TriggerServerEvent('demo:safePay', 2)
    Wait(1000)

    step('3/13 Triche sur les arguments (attendu : 4 refus, une seule alerte Discord)')
    cheat()
    Wait(11000) -- let the rate limit refill

    step('4/13 Spam de 5 paies (attendu : 1 ACCEPTÉ puis 4 refus rate)')
    for _ = 1, 5 do TriggerServerEvent('demo:safePay', 1) end
    Wait(11000)

    step('5/13 Paie loin du point (attendu : refus distance)')
    teleport(FAR_POINT)
    TriggerServerEvent('demo:safePay', 1)
    Wait(1000)

    step('6/13 Callback prix pain (attendu : ACCEPTÉ 12 $)')
    price('bread')

    step('7/13 Callback prix d\'un objet inconnu (attendu : refus enum)')
    price('weapon_rpg')
    Wait(1000)

    step('8/13 Véhicule à 3 m (attendu : ACCEPTÉ réparation)')
    local here = GetEntityCoords(PlayerPedId())
    local vehicle, netId = spawnVehicle('blista', here + vec3(3.0, 0.0, 0.0))
    TriggerServerEvent('demo:repairVehicle', netId)
    Wait(1000)

    step('9/13 Véhicule à 50 m (attendu : refus distance)')
    SetEntityCoords(PlayerPedId(), here.x + 50.0, here.y, here.z, false, false, false, false)
    Wait(1500)
    TriggerServerEvent('demo:repairVehicle', netId)
    Wait(1000)

    step('10/13 Véhicule inexistant (attendu : refus distance, entité inconnue)')
    TriggerServerEvent('demo:repairVehicle', 999999)
    Wait(1000)
    DeleteEntity(vehicle)

    step('11/13 Mode audit (attendu : violation notée, handler exécuté avec n = 99, puis retour en enforce)')
    TriggerServerEvent('demo:setMode', 'audit')
    Wait(500)
    TriggerServerEvent('demo:auditProbe', 99)
    Wait(500)
    TriggerServerEvent('demo:setMode', 'enforce')
    Wait(500)
    TriggerServerEvent('demo:auditProbe', 99)
    Wait(1000)

    step('12/13 Mesure : 200 appels valides puis statistiques (attendu : coût par appel en µs)')
    for i = 1, 200 do TriggerServerEvent('demo:bench', i % 3 + 1, 'mesure') end
    Wait(2000)
    TriggerServerEvent('demo:stats')
    Wait(1000)

    step('13/13 Event réservé à la police (attendu : refus job puis expulsion)')
    Wait(500)
    TriggerServerEvent('demo:policeOnly')
  end)
end, false)

-- Single steps, to replay one case by hand.
RegisterCommand('se_tp', function() CreateThread(function() teleport(PAY_POINT) say('Au point de paie.') end) end, false)
RegisterCommand('se_unsafe', function(_, args) TriggerServerEvent('demo:unsafePay', tonumber(args[1]) or 1000000) end, false)
RegisterCommand('se_pay', function(_, args) TriggerServerEvent('demo:safePay', tonumber(args[1]) or 1) end, false)
RegisterCommand('se_cheat', cheat, false)
RegisterCommand('se_spam', function() for _ = 1, 5 do TriggerServerEvent('demo:safePay', 1) end end, false)
RegisterCommand('se_price', function(_, args) CreateThread(function() price(args[1] or 'bread') end) end, false)
RegisterCommand('se_kick', function() TriggerServerEvent('demo:policeOnly') end, false)
