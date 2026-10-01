-- Loaded into the resource that uses safe_events:
--   server_script '@safe_events/import.lua'
-- It defines the SafeEvents global for that resource only.

if not IsDuplicityVersion() then
  error("safe_events: import.lua is server-side only, use server_script '@safe_events/import.lua'", 0)
end

local RESOURCE = 'safe_events'

if GetResourceState(RESOURCE) ~= 'started' then
  error(("safe_events: start '%s' before '%s' in server.cfg"):format(RESOURCE, GetCurrentResourceName()), 0)
end

local function use(path)
  local code = LoadResourceFile(RESOURCE, path)
  if not code then error(('safe_events: missing file %s'):format(path), 0) end
  local chunk, err = load(code, ('@@%s/%s'):format(RESOURCE, path), 't')
  if not chunk then error(err, 0) end
  return chunk()
end

local validate = use('lib/validate.lua')
local ratelimit = use('lib/ratelimit.lua')
local core = use('lib/core.lua')

local framework = GetConvar('safe_events:framework', 'esx')
if not framework:match('^[%w_]+$') then
  error(("safe_events: invalid safe_events:framework '%s'"):format(framework), 0)
end
local adapter = use(('adapters/%s.lua'):format(framework))(GetConvar('safe_events:esxPlayer', 'full'))

local consumer = GetCurrentResourceName()

SafeEvents = core.new({
  validate = validate,
  ratelimit = ratelimit,

  registerNetEvent = RegisterNetEvent,
  registerCallback = (lib and lib.callback) and function(name, fn)
    lib.callback.register(name, fn)
  end or nil,

  getPlayer = adapter.getPlayer,
  getJob = adapter.getJob,

  getCoords = function(src)
    local ped = GetPlayerPed(src)
    if ped == 0 then return nil end
    return GetEntityCoords(ped)
  end,

  getNetIdCoords = function(netId)
    if math.type(netId) ~= 'integer' then return nil end
    local entity = NetworkGetEntityFromNetworkId(netId)
    if entity == 0 or not DoesEntityExist(entity) then return nil end
    return GetEntityCoords(entity)
  end,

  now = GetGameTimer,
  -- CfxLua's os.nanotime is a high-resolution clock; os.clock counts the CPU
  -- time of every server thread, so it is only a fallback.
  cpuClock = os.nanotime and function() return os.nanotime() / 1e9 end or os.clock,
  mode = function() return GetConvar('safe_events:mode', 'enforce') end,

  report = function(reason)
    exports[RESOURCE]:report(consumer, reason)
  end,

  onDropped = function(fn)
    AddEventHandler('playerDropped', function() fn(source) end)
  end,
})

-- Lets the `safe_events stats` console command read this resource's counters.
exports[RESOURCE]:attach(consumer, SafeEvents.stats)
