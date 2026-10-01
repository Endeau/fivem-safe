local ESX = exports.es_extended:getSharedObject()

-- Every outcome is printed here, so the whole test can be read from the
-- server logs without looking at the game screen.
local function log(message, ...)
  print(('^5[demo]^0 ' .. message):format(...))
end

-- Pay point in Legion Square.
local PAY_POINT = vec3(195.2, -933.8, 30.7)
local REWARDS = { 150, 300, 500 } -- amounts decided by the server, by delivery id

-- Step markers sent by /se_all, validated like any other event.
SafeEvents.register('demo:step', {
  args = { { name = 'label', type = 'string', maxLen = 160 } },
  rate = { calls = 30, per = 60 },
  onReject = 'log',
}, function(xPlayer, args)
  log('==== %s (%s) ====', args.label, xPlayer.getName())
end)

-- 1. The usual unsafe version: the client chooses the amount.
RegisterNetEvent('demo:unsafePay', function(amount)
  local xPlayer = ESX.GetPlayerFromId(source)
  if xPlayer then
    xPlayer.addAccountMoney('money', amount, 'demo:unsafePay')
    log('UNSAFE demo:unsafePay a donné %s $ (argent total : %s $)', tostring(amount), xPlayer.getAccount('money').money)
    xPlayer.showNotification(('[non protégé] +%s $'):format(tostring(amount)))
  end
end)

-- 2. The same payout behind SafeEvents.
SafeEvents.register('demo:safePay', {
  args     = { { name = 'deliveryId', type = 'integer', min = 1, max = #REWARDS } },
  distance = { coords = PAY_POINT, max = 15.0 },
  rate     = { calls = 1, per = 10 },
  onReject = 'log',
}, function(xPlayer, args, src)
  Wait(100) -- the global `source` is gone after this; src must still be right
  local reward = REWARDS[args.deliveryId]
  xPlayer.addAccountMoney('money', reward, 'demo:safePay')
  log('ACCEPTÉ demo:safePay livraison %d : +%d $ pour le joueur %s (src après Wait = %s, global source = %s)',
    args.deliveryId, reward, xPlayer.source, tostring(src), tostring(source))
  xPlayer.showNotification(('[safe_events] livraison %d payée : +%d $'):format(args.deliveryId, reward))
end)

-- 3. A callback: the price comes from the server, the item must be known.
local PRICES = { bread = 12, water = 8 }
SafeEvents.callback('demo:price', {
  args = { { name = 'item', type = 'string', enum = { 'bread', 'water' } } },
  onReject = 'log',
}, function(_, args)
  log('ACCEPTÉ demo:price %s = %d $', args.item, PRICES[args.item])
  return PRICES[args.item]
end)

-- 4. Kick test: only the police may call it, others are kicked.
SafeEvents.register('demo:policeOnly', { job = 'police' }, function(xPlayer)
  log('ACCEPTÉ demo:policeOnly pour %s', xPlayer.getName())
  xPlayer.showNotification('[safe_events] accès police accordé')
end)

AddEventHandler('playerDropped', function(reason)
  log('Joueur %s déconnecté : %s', tostring(source), reason)
end)

-- 5. Distance to a vehicle named by its network id.
SafeEvents.register('demo:repairVehicle', {
  args     = { { name = 'vehicle', type = 'integer', min = 1 } },
  distance = { netIdArg = 'vehicle', max = 5.0 },
  onReject = 'log',
}, function(xPlayer, args)
  log('ACCEPTÉ demo:repairVehicle véhicule %d réparé par %s', args.vehicle, xPlayer.getName())
end)

-- 6. Audit mode: violations are logged but the handler still runs, with the
-- raw values. The handler must then protect itself.
SafeEvents.register('demo:auditProbe', {
  args = { { name = 'n', type = 'integer', max = 5 } },
  onReject = 'log',
}, function(_, args)
  log('HANDLER EXÉCUTÉ demo:auditProbe avec n = %s', tostring(args.n))
end)

-- Switching the global mode is a test-only door, closed unless the dev
-- server opens it with safe_events_demo:allowModeSwitch.
SafeEvents.register('demo:setMode', {
  args = { { name = 'mode', type = 'string', enum = { 'audit', 'enforce' } } },
  onReject = 'log',
}, function(xPlayer, args)
  if GetConvar('safe_events_demo:allowModeSwitch', 'false') ~= 'true' then
    return log('demo:setMode ignoré : safe_events_demo:allowModeSwitch est fermé')
  end
  SetConvar('safe_events:mode', args.mode)
  log('MODE safe_events passé à %s par %s', GetConvar('safe_events:mode', '?'), xPlayer.getName())
end)

-- 7. Cost of the checks: a burst of valid calls, then the counters.
SafeEvents.register('demo:bench', {
  args = { { name = 'id', type = 'integer', min = 1, max = 3 }, { name = 'label', type = 'string', maxLen = 32 } },
  rate = { calls = 1000, per = 1 },
  onReject = 'log',
}, function() end)

-- Where the cost per call comes from: each piece timed on its own, with the
-- clock safe_events uses.
local function timeIt(label, n, fn)
  local now = os.nanotime and function() return os.nanotime() / 1e9 end or os.clock
  local started = now()
  for _ = 1, n do fn() end
  log('MESURE %-34s %8.1f µs par appel', label, (now() - started) / n * 1e6)
end

SafeEvents.register('demo:stats', { rate = { calls = 5, per = 60 }, onReject = 'log' }, function(xPlayer, _, src)
  exports.safe_events:printStats()
  log('MESURE horloge : %s', os.nanotime and 'os.nanotime' or 'os.clock (tous les threads du serveur)')
  local n = 200
  timeIt('boucle vide', n, function() end)
  timeIt('ESX.GetPlayerFromId', n, function() return ESX.GetPlayerFromId(src) end)
  timeIt('xPlayer.getJob()', n, function() return xPlayer.getJob() end)
  timeIt('ESX.IsPlayerLoaded', n, function() return ESX.IsPlayerLoaded(src) end)
  timeIt('export RunStaticPlayerMethod getJob', n, function() return exports.es_extended:RunStaticPlayerMethod(src, 'getJob') end)
  timeIt('GetPlayerPed + GetEntityCoords', n, function() return GetEntityCoords(GetPlayerPed(src)) end)
  timeIt('accès à un export d\'une autre ressource', n, function() return exports.safe_events.printStats ~= nil end)
end)
