local core = require('lib.core')

-- A fake server: events are stored instead of registered, players are plain tables.
local function fakeEnv()
  local env = {
    events = {},
    callbacks = {},
    players = {},
    coords = {},
    netIds = {},
    reports = {},
    dropped = {},
    clock = 0,
    currentMode = 'enforce',
  }
  env.registerNetEvent = function(name, fn) env.events[name] = fn end
  env.registerCallback = function(name, fn) env.callbacks[name] = fn end
  env.getPlayer = function(src) return env.players[src] end
  env.getJob = function(player) return player.job, player.grade end
  env.getCoords = function(src) return env.coords[src] end
  env.getNetIdCoords = function(netId) return env.netIds[netId] end
  env.now = function() return env.clock end
  env.report = function(info) env.reports[#env.reports + 1] = info end
  env.mode = function() return env.currentMode end
  env.onDropped = function(fn) env.dropped[#env.dropped + 1] = fn end
  return env
end

-- Calls a registered net event the way FiveM does: `source` is a global.
local function trigger(env, name, src, ...)
  _G.source = src
  env.events[name](...)
  _G.source = nil
end

describe('SafeEvents.register', function()
  local env, SafeEvents, calls

  before_each(function()
    env = fakeEnv()
    SafeEvents = core.new(env)
    calls = {}
    env.players[1] = { job = 'pizza', grade = 0 }
    env.coords[1] = { x = 538.0, y = 101.0, z = 96.5 }
  end)

  local function handler(player, args, src)
    calls[#calls + 1] = { player = player, args = args, src = src }
  end

  it('calls the handler with the player, the named arguments and the source', function()
    SafeEvents.register('pizza:pay', { args = { { name = 'deliveryId', type = 'integer' } } }, handler)
    trigger(env, 'pizza:pay', 1, 7)
    assert.same(1, #calls)
    assert.same({ deliveryId = 7 }, calls[1].args)
    assert.same(1, calls[1].src)
    assert.same(0, #env.reports)
  end)

  it('keeps the source after a Wait, when the global has become nil', function()
    local srcAfterWait
    SafeEvents.register('a', {}, function(_, _, src)
      _G.source = nil -- what FiveM does to the global once the handler yields
      srcAfterWait = src
    end)
    trigger(env, 'a', 1)
    assert.same(1, srcAfterWait)
  end)

  it('refuses a player that is not loaded yet', function()
    SafeEvents.register('a', {}, handler)
    trigger(env, 'a', 2)
    assert.same(0, #calls)
    assert.same('player', env.reports[1].rule)
  end)

  it('does not look the player up when the arguments or the rate already refuse the call', function()
    local lookups = 0
    local getPlayer = env.getPlayer
    env.getPlayer = function(src) lookups = lookups + 1; return getPlayer(src) end
    SafeEvents.register('a', {
      args = { { name = 'n', type = 'integer', max = 5 } },
      rate = { calls = 1, per = 30 },
    }, handler)
    trigger(env, 'a', 1, 99) -- refused by max
    trigger(env, 'a', 1, 2)  -- accepted, spends the quota
    trigger(env, 'a', 1, 2)  -- refused by rate
    assert.same(1, lookups)
    assert.same(1, #calls)
  end)

  it('refuses invalid arguments and reports which one', function()
    SafeEvents.register('pizza:pay', { args = { { name = 'amount', type = 'integer', max = 500 } } }, handler)
    trigger(env, 'pizza:pay', 1, 10000000)
    assert.same(0, #calls)
    local report = env.reports[1]
    assert.same('pizza:pay', report.event)
    assert.same(1, report.source)
    assert.same('max', report.rule)
    assert.same('amount', report.arg)
  end)

  describe('job', function()
    it('accepts the right job', function()
      SafeEvents.register('a', { job = 'pizza' }, handler)
      trigger(env, 'a', 1)
      assert.same(1, #calls)
    end)

    it('refuses another job', function()
      SafeEvents.register('a', { job = 'police' }, handler)
      trigger(env, 'a', 1)
      assert.same(0, #calls)
      assert.same('job', env.reports[1].rule)
    end)

    it('accepts any job of a list', function()
      SafeEvents.register('a', { job = { 'police', 'pizza' } }, handler)
      trigger(env, 'a', 1)
      assert.same(1, #calls)
    end)

    it('refuses a grade that is too low', function()
      SafeEvents.register('a', { job = { name = 'pizza', minGrade = 2 } }, handler)
      trigger(env, 'a', 1)
      assert.same(0, #calls)
      assert.same('job', env.reports[1].rule)
    end)
  end)

  describe('distance', function()
    it('accepts a player close to the point', function()
      SafeEvents.register('a', { distance = { coords = { x = 538.4, y = 101.9, z = 96.5 }, max = 8.0 } }, handler)
      trigger(env, 'a', 1)
      assert.same(1, #calls)
    end)

    it('refuses a player far from the point', function()
      SafeEvents.register('a', { distance = { coords = { x = 0, y = 0, z = 0 }, max = 8.0 } }, handler)
      trigger(env, 'a', 1)
      assert.same(0, #calls)
      assert.same('distance', env.reports[1].rule)
    end)

    it('accepts a player close to any point of a list', function()
      SafeEvents.register('a', {
        distance = { coords = { { x = 0, y = 0, z = 0 }, { x = 540, y = 100, z = 96 } }, max = 8.0 },
      }, handler)
      trigger(env, 'a', 1)
      assert.same(1, #calls)
    end)

    it('measures from the entity named by a netId argument', function()
      env.netIds[42] = { x = 535, y = 101, z = 96.5 }
      SafeEvents.register('a', {
        args = { { name = 'vehicle', type = 'integer' } },
        distance = { netIdArg = 'vehicle', max = 5.0 },
      }, handler)
      trigger(env, 'a', 1, 42)
      assert.same(1, #calls)
    end)

    it('refuses a netId that does not exist', function()
      SafeEvents.register('a', {
        args = { { name = 'vehicle', type = 'integer' } },
        distance = { netIdArg = 'vehicle', max = 5.0 },
      }, handler)
      trigger(env, 'a', 1, 99)
      assert.same(0, #calls)
      assert.same('distance', env.reports[1].rule)
    end)

    it('refuses a netIdArg that is not a declared argument', function()
      assert.has_error(function()
        SafeEvents.register('a', { distance = { netIdArg = 'vehicle', max = 5.0 } }, handler)
      end, "safe_events: 'a' distance.netIdArg 'vehicle' is not a declared argument")
    end)
  end)

  describe('rate', function()
    it('refuses calls above the limit', function()
      SafeEvents.register('a', { rate = { calls = 1, per = 30 } }, handler)
      trigger(env, 'a', 1)
      trigger(env, 'a', 1)
      assert.same(1, #calls)
      assert.same('rate', env.reports[1].rule)
    end)

    it('does not spend the quota on calls with invalid arguments', function()
      SafeEvents.register('a', {
        args = { { name = 'id', type = 'integer', max = 3 } },
        rate = { calls = 1, per = 30 },
      }, handler)
      trigger(env, 'a', 1, 999)
      trigger(env, 'a', 1, 2)
      assert.same(1, #calls)
      assert.same('max', env.reports[1].rule)
    end)

    it('forgets a player who leaves', function()
      SafeEvents.register('a', { rate = { calls = 1, per = 30 } }, handler)
      trigger(env, 'a', 1)
      for _, fn in ipairs(env.dropped) do fn(1) end
      trigger(env, 'a', 1)
      assert.same(2, #calls)
    end)
  end)

  describe('onReject', function()
    local function reject(onReject)
      SafeEvents.register('a', { job = 'police', onReject = onReject }, handler)
      trigger(env, 'a', 1)
    end

    it("reports and asks for a kick by default ('log+kick')", function()
      reject(nil)
      assert.is_true(env.reports[1].kick)
    end)

    it("reports without kick for 'log'", function()
      reject('log')
      assert.is_false(env.reports[1].kick)
    end)

    it("stays silent for 'drop'", function()
      reject('drop')
      assert.same(0, #env.reports)
    end)

    it('calls a custom function with the source and the reason', function()
      local got
      reject(function(src, reason) got = { src = src, rule = reason.rule } end)
      assert.same({ src = 1, rule = 'job' }, got)
      assert.same(0, #env.reports)
    end)

    it('refuses an unknown action', function()
      assert.has_error(function()
        SafeEvents.register('a', { onReject = 'ban' }, handler)
      end, "safe_events: 'a' onReject must be 'drop', 'log', 'log+kick' or a function")
    end)
  end)

  describe('audit mode', function()
    it('reports the violation but still runs the handler, without kick', function()
      env.currentMode = 'audit'
      SafeEvents.register('a', { job = 'police' }, handler)
      trigger(env, 'a', 1)
      assert.same(1, #calls)
      assert.is_false(env.reports[1].kick)
      assert.is_true(env.reports[1].audit)
    end)

    it('passes the raw arguments by name when they fail validation', function()
      env.currentMode = 'audit'
      SafeEvents.register('a', { args = { { name = 'amount', type = 'integer', max = 500 } } }, handler)
      trigger(env, 'a', 1, 9999)
      assert.same({ amount = 9999 }, calls[1].args)
      assert.same('max', env.reports[1].rule)
    end)

    it('still refuses a player that is not loaded, since the handler needs one', function()
      env.currentMode = 'audit'
      SafeEvents.register('a', {}, handler)
      trigger(env, 'a', 2)
      assert.same(0, #calls)
    end)
  end)

  it('refuses unknown keys in the spec to catch typos', function()
    assert.has_error(function()
      SafeEvents.register('a', { jobs = 'police' }, handler)
    end, "safe_events: 'a' has unknown option 'jobs'")
  end)

  it('refuses a handler that is not a function', function()
    assert.has_error(function()
      SafeEvents.register('a', {}, nil)
    end, "safe_events: 'a' needs a handler function")
  end)
end)

describe('SafeEvents.stats', function()
  local env, SafeEvents

  before_each(function()
    env = fakeEnv()
    local t = 0
    env.cpuClock = function() t = t + 0.00002; return t end -- every reading advances 20 µs
    SafeEvents = core.new(env)
    env.players[1] = { job = 'pizza', grade = 0 }
    SafeEvents.register('b', {}, function() end)
    SafeEvents.register('a', {
      args = { { name = 'n', type = 'integer', max = 5 } },
      rate = { calls = 1, per = 30 },
    }, function() end)
  end)

  it('counts calls, accepted and refused calls with the rule that refused them', function()
    trigger(env, 'a', 1, 2)
    trigger(env, 'a', 1, 99)
    trigger(env, 'a', 1, 3)
    trigger(env, 'a', 2, 1)
    local a = SafeEvents.stats()[1]
    assert.same('a', a.event)
    assert.same(4, a.calls)
    assert.same(1, a.accepted)
    assert.same(3, a.refused)
    assert.same({ max = 1, rate = 1, player = 1 }, a.rules)
  end)

  it('measures the time spent in the checks, in microseconds per call', function()
    trigger(env, 'a', 1, 2)
    trigger(env, 'a', 1, 3)
    local a = SafeEvents.stats()[1]
    assert.near(20, a.avgMicros, 0.001)
  end)

  it('lists events sorted by name, including those never called', function()
    local stats = SafeEvents.stats()
    assert.same({ 'a', 'b' }, { stats[1].event, stats[2].event })
    assert.same(0, stats[2].calls)
    assert.is_nil(stats[2].avgMicros)
  end)

  it('counts a violation in audit mode without counting the call as refused', function()
    env.currentMode = 'audit'
    trigger(env, 'a', 1, 99)
    local a = SafeEvents.stats()[1]
    assert.same(1, a.accepted)
    assert.same(0, a.refused)
    assert.same({ max = 1 }, a.rules)
  end)

  it('leaves time out when the server gives no clock', function()
    env = fakeEnv()
    SafeEvents = core.new(env)
    env.players[1] = { job = 'pizza', grade = 0 }
    SafeEvents.register('a', {}, function() end)
    trigger(env, 'a', 1)
    assert.is_nil(SafeEvents.stats()[1].avgMicros)
  end)
end)

describe('SafeEvents.callback', function()
  it('returns the handler result when the call is valid, nothing otherwise', function()
    local env = fakeEnv()
    local SafeEvents = core.new(env)
    env.players[1] = { job = 'pizza', grade = 0 }
    SafeEvents.callback('shop:price', { args = { { name = 'item', type = 'string', enum = { 'bread' } } } },
      function(_, args) return 12, args.item end)

    local price, item = env.callbacks['shop:price'](1, 'bread')
    assert.same({ 12, 'bread' }, { price, item })
    assert.is_nil(env.callbacks['shop:price'](1, 'weapon_rpg'))
    assert.same('enum', env.reports[1].rule)
  end)

  it('explains that ox_lib is needed when no callback system is available', function()
    local env = fakeEnv()
    env.registerCallback = nil
    local SafeEvents = core.new(env)
    assert.has_error(function()
      SafeEvents.callback('a', {}, function() end)
    end, "safe_events: callbacks need ox_lib, add '@ox_lib/init.lua' before '@safe_events/import.lua'")
  end)
end)
