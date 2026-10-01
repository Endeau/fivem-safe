-- SafeEvents: registers net events and callbacks behind a declarative spec.
-- The server functions it needs come from `env`, so the same code runs in
-- FiveM (see import.lua) and in the tests (see spec/core_spec.lua).

local core = {}

local SPEC_KEYS = { args = true, job = true, distance = true, rate = true, onReject = true }
local ACTIONS = { drop = true, log = true, ['log+kick'] = true }

local function specError(name, message, ...)
  error(("safe_events: '%s' " .. message):format(name, ...), 0)
end

local function toPoint(value)
  return { x = value.x, y = value.y, z = value.z }
end

local function normalizeJob(name, job)
  if job == nil then return nil end
  if type(job) == 'string' then return { names = { [job] = true }, minGrade = nil } end
  if type(job) == 'table' and job.name then
    return { names = { [job.name] = true }, minGrade = job.minGrade }
  end
  if type(job) == 'table' and #job > 0 then
    local names = {}
    for _, jobName in ipairs(job) do names[jobName] = true end
    return { names = names }
  end
  specError(name, "job must be a name, a list of names or { name = ..., minGrade = ... }")
end

local function normalizeDistance(name, distance, compiledArgs)
  if distance == nil then return nil end
  if type(distance.max) ~= 'number' or distance.max <= 0 then
    specError(name, 'distance.max must be a positive number of meters')
  end
  local normalized = { max = distance.max }
  if distance.netIdArg then
    local declared = false
    for _, arg in ipairs(compiledArgs) do
      if arg.name == distance.netIdArg then declared = true end
    end
    if not declared then
      specError(name, "distance.netIdArg '%s' is not a declared argument", distance.netIdArg)
    end
    normalized.netIdArg = distance.netIdArg
  elseif distance.coords then
    local coords = distance.coords
    if coords.x then
      normalized.points = { toPoint(coords) }
    else
      normalized.points = {}
      for i, point in ipairs(coords) do normalized.points[i] = toPoint(point) end
    end
  else
    specError(name, 'distance needs coords or netIdArg')
  end
  return normalized
end

local function distanceBetween(a, b)
  local dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
  return math.sqrt(dx * dx + dy * dy + dz * dz)
end

function core.new(env)
  local validate = env.validate or require('lib.validate')
  local ratelimit = env.ratelimit or require('lib.ratelimit')
  local limiters = {}
  local registered = {} -- every compiled event, for stats()
  local clock = env.cpuClock -- optional, seconds with sub-millisecond precision

  env.onDropped(function(src)
    for _, limiter in ipairs(limiters) do limiter:forget(src) end
  end)

  local function compile(name, spec, handler)
    if type(handler) ~= 'function' then specError(name, 'needs a handler function') end
    spec = spec or {}
    for key in pairs(spec) do
      if not SPEC_KEYS[key] then specError(name, "has unknown option '%s'", key) end
    end
    local onReject = spec.onReject or 'log+kick'
    if type(onReject) ~= 'function' and not ACTIONS[onReject] then
      specError(name, "onReject must be 'drop', 'log', 'log+kick' or a function")
    end

    local args = validate.compile(spec.args)
    local compiled = {
      name = name,
      args = args,
      job = normalizeJob(name, spec.job),
      distance = normalizeDistance(name, spec.distance, args),
      onReject = onReject,
      stats = { calls = 0, accepted = 0, refused = 0, rules = {}, seconds = 0, timed = 0 },
    }
    registered[#registered + 1] = compiled
    if spec.rate then
      compiled.rate = ratelimit.new(spec.rate.calls, spec.rate.per, env.now)
      limiters[#limiters + 1] = compiled.rate
    end
    return compiled
  end

  local function checkJob(compiled, player)
    local job = compiled.job
    if not job then return true end
    local jobName, grade = env.getJob(player)
    if not job.names[jobName] then return false, { rule = 'job', got = tostring(jobName) } end
    if job.minGrade and (grade or 0) < job.minGrade then
      return false, { rule = 'job', got = ('%s grade %s'):format(jobName, tostring(grade)) }
    end
    return true
  end

  local function checkDistance(compiled, src, values)
    local distance = compiled.distance
    if not distance then return true end
    local here = env.getCoords(src)
    if not here then return false, { rule = 'distance', got = 'no position' } end

    local points = distance.points
    if distance.netIdArg then
      local target = env.getNetIdCoords(values[distance.netIdArg])
      if not target then return false, { rule = 'distance', arg = distance.netIdArg, got = 'unknown entity' } end
      points = { target }
    end

    local closest = math.huge
    for _, point in ipairs(points) do
      closest = math.min(closest, distanceBetween(here, point))
    end
    if closest > distance.max then
      return false, { rule = 'distance', got = ('%.1f m'):format(closest) }
    end
    return true
  end

  -- Runs every check in order. Returns the player and the values when the
  -- handler may run.
  local function guard(compiled, src, count, ...)
    local function reject(reason)
      reason.event = compiled.name
      reason.source = src
      local rules = compiled.stats.rules
      rules[reason.rule] = (rules[reason.rule] or 0) + 1
      local audit = env.mode() == 'audit'
      local onReject = compiled.onReject
      if type(onReject) == 'function' then
        onReject(src, reason)
      elseif onReject ~= 'drop' then
        reason.kick = onReject == 'log+kick' and not audit
        reason.audit = audit
        env.report(reason)
      end
      return audit
    end

    -- Cheapest checks first. In audit mode reject() returns true and the
    -- checks carry on. Arguments come before the rate limit: a malformed call is refused for
    -- what it is, and does not spend the quota of legitimate calls.
    local ok, result = validate.args(compiled.args, count, ...)
    local values = result
    if not ok then
      if not reject(result) then return nil end
      values = {}
      for i, arg in ipairs(compiled.args) do values[arg.name] = (select(i, ...)) end
    end

    if compiled.rate and not compiled.rate:take(src) then
      if not reject({ rule = 'rate' }) then return nil end
    end

    -- The framework lookup can cost more than every check above together (a
    -- call into another resource), so it comes only once the cheap checks pass.
    local player = env.getPlayer(src)
    if not player then
      reject({ rule = 'player', got = 'not loaded' })
      return nil
    end

    local reason
    ok, reason = checkJob(compiled, player)
    if not ok and not reject(reason) then return nil end

    ok, reason = checkDistance(compiled, src, values)
    if not ok and not reject(reason) then return nil end

    return player, values
  end

  -- Runs the checks and records the outcome and the time they took.
  local function run(compiled, src, count, ...)
    local stats = compiled.stats
    stats.calls = stats.calls + 1
    local started = clock and clock()
    local player, values = guard(compiled, src, count, ...)
    if started then
      stats.seconds = stats.seconds + (clock() - started)
      stats.timed = stats.timed + 1
    end
    if player then stats.accepted = stats.accepted + 1 else stats.refused = stats.refused + 1 end
    return player, values
  end

  local SafeEvents = {}

  --- Counters per event since the resource started, sorted by event name:
  -- { event, calls, accepted, refused, rules = { [rule] = count }, avgMicros }.
  -- In audit mode a violation is counted in rules but the call is accepted.
  function SafeEvents.stats()
    local list = {}
    for _, compiled in ipairs(registered) do
      local s = compiled.stats
      local rules = {}
      for rule, count in pairs(s.rules) do rules[rule] = count end
      list[#list + 1] = {
        event = compiled.name,
        calls = s.calls,
        accepted = s.accepted,
        refused = s.refused,
        rules = rules,
        avgMicros = s.timed > 0 and s.seconds / s.timed * 1e6 or nil,
      }
    end
    table.sort(list, function(a, b) return a.event < b.event end)
    return list
  end

  --- Registers a net event whose handler only runs for valid calls.
  -- handler(player, args, source): args are keyed by name, source is safe to
  -- use after a Wait.
  function SafeEvents.register(name, spec, handler)
    local compiled = compile(name, spec, handler)
    env.registerNetEvent(name, function(...)
      local src = source
      local player, values = run(compiled, src, select('#', ...), ...)
      if player then handler(player, values, src) end
    end)
  end

  --- Same as register, for an ox_lib server callback. The handler's return
  -- values go back to the client; an invalid call returns nothing.
  function SafeEvents.callback(name, spec, handler)
    if not env.registerCallback then
      error("safe_events: callbacks need ox_lib, add '@ox_lib/init.lua' before '@safe_events/import.lua'", 0)
    end
    local compiled = compile(name, spec, handler)
    env.registerCallback(name, function(src, ...)
      local player, values = run(compiled, src, select('#', ...), ...)
      if player then return handler(player, values, src) end
    end)
  end

  return SafeEvents
end

return core
