-- The ESX adapter, with a fake es_extended behind the `exports` global.

local function loadAdapter()
  return dofile('adapters/esx.lua')
end

local function fakeEsx()
  local calls = { full = 0, loaded = 0, static = {} }
  local players = {
    [1] = { job = { name = 'police', grade = 2 }, name = 'Test Test' },
  }
  local shared = {
    GetPlayerFromId = function(src)
      calls.full = calls.full + 1
      local p = players[src]
      if not p then return nil end
      return { source = src, getJob = function() return p.job end, getName = function() return p.name end }
    end,
    IsPlayerLoaded = function(src)
      calls.loaded = calls.loaded + 1
      return players[src] ~= nil
    end,
  }
  _G.exports = {
    es_extended = {
      getSharedObject = function() return shared end,
      RunStaticPlayerMethod = function(_, src, method, ...)
        calls.static[#calls.static + 1] = method
        local p = players[src]
        if method == 'getJob' then return p.job end
        if method == 'getName' then return p.name end
        if method == 'addMoney' then return (...) end
      end,
    },
  }
  return calls
end

describe('ESX adapter', function()
  after_each(function() _G.exports = nil end)

  it("uses the full player by default ('full')", function()
    local calls = fakeEsx()
    local adapter = loadAdapter()('full')
    local player = adapter.getPlayer(1)
    assert.same(1, calls.full)
    assert.same({ 'police', 2 }, { adapter.getJob(player) })
    assert.is_nil(adapter.getPlayer(9))
  end)

  describe("'static'", function()
    it('never asks ESX for the full player', function()
      local calls = fakeEsx()
      local adapter = loadAdapter()('static')
      local player = adapter.getPlayer(1)
      assert.same({ 'police', 2 }, { adapter.getJob(player) })
      assert.same(0, calls.full)
      assert.same(1, calls.loaded)
    end)

    it('returns nothing for a player that is not loaded', function()
      fakeEsx()
      assert.is_nil(loadAdapter()('static').getPlayer(9))
    end)

    it('gives a player whose methods go through ESX, with src and source as fields', function()
      local calls = fakeEsx()
      local player = loadAdapter()('static').getPlayer(1)
      assert.same('Test Test', player.getName())
      assert.same(250, player.addMoney(250))
      assert.same({ 1, 1 }, { player.src, player.source })
      assert.same({ 'getName', 'addMoney' }, calls.static)
    end)
  end)

  it('refuses an unknown mode', function()
    fakeEsx()
    assert.has_error(function() loadAdapter()('lite') end,
      "safe_events: safe_events:esxPlayer must be 'full' or 'static', got 'lite'")
  end)
end)
