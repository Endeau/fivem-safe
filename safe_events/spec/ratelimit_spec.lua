local ratelimit = require('lib.ratelimit')

describe('ratelimit', function()
  local clock, limiter

  before_each(function()
    clock = 0
    limiter = ratelimit.new(2, 10, function() return clock end)
  end)

  it('allows up to the number of calls at once', function()
    assert.is_true(limiter:take(1))
    assert.is_true(limiter:take(1))
    assert.is_false(limiter:take(1))
  end)

  it('keeps one bucket per player', function()
    limiter:take(1)
    limiter:take(1)
    assert.is_true(limiter:take(2))
  end)

  it('refills over the period', function()
    limiter:take(1)
    limiter:take(1)
    clock = 5000 -- half of 10 s gives back one call
    assert.is_true(limiter:take(1))
    assert.is_false(limiter:take(1))
  end)

  it('never refills above capacity', function()
    clock = 60000
    assert.is_true(limiter:take(1))
    assert.is_true(limiter:take(1))
    assert.is_false(limiter:take(1))
  end)

  it('forgets a player', function()
    limiter:take(1)
    limiter:take(1)
    limiter:forget(1)
    assert.is_true(limiter:take(1))
  end)

  it('refuses invalid settings', function()
    assert.has_error(function() ratelimit.new(0, 10, os.time) end,
      'safe_events: rate.calls must be a positive integer')
    assert.has_error(function() ratelimit.new(1, 0, os.time) end,
      'safe_events: rate.per must be a positive number of seconds')
  end)
end)
