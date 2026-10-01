-- ESX Legacy adapter: how safe_events finds a player and reads their job.
--
-- mode 'full' (default): the handler gets ESX.GetPlayerFromId(src), the usual
-- xPlayer. Measured in game at about 300 µs per call: ESX copies the whole
-- player object from es_extended to the calling resource.
--
-- mode 'static': the checks use ESX.IsPlayerLoaded and read the job through
-- es_extended's RunStaticPlayerMethod (about 20 µs together), and the handler
-- gets a static player like ESX.Player(src) from @es_extended/imports.lua:
-- every method works (xPlayer.addAccountMoney(...), xPlayer.getJob()), but
-- fields like xPlayer.job or xPlayer.name do not; src and source are set.

local MODES = { full = true, static = true }

local function staticPlayer(src)
  return setmetatable({ src = src, source = src }, {
    __index = function(_, method)
      return function(...)
        return exports.es_extended:RunStaticPlayerMethod(src, method, ...)
      end
    end,
  })
end

return function(mode)
  mode = mode or 'full'
  if not MODES[mode] then
    error(("safe_events: safe_events:esxPlayer must be 'full' or 'static', got '%s'"):format(tostring(mode)), 0)
  end
  local ESX = exports.es_extended:getSharedObject()

  local getPlayer
  if mode == 'static' then
    getPlayer = function(src)
      if not ESX.IsPlayerLoaded(src) then return nil end
      return staticPlayer(src)
    end
  else
    getPlayer = function(src)
      return ESX.GetPlayerFromId(src)
    end
  end

  return {
    getPlayer = getPlayer,

    getJob = function(xPlayer)
      local job = xPlayer.getJob()
      if not job then return nil end
      return job.name, job.grade
    end,
  }
end
