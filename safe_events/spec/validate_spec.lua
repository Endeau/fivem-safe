local validate = require('lib.validate')

local function check(schema, ...)
  local compiled = validate.compile(schema)
  return validate.args(compiled, select('#', ...), ...)
end

describe('validate.compile', function()
  it('rejects an unknown type', function()
    assert.has_error(function()
      validate.compile({ { name = 'x', type = 'money' } })
    end, "safe_events: argument 'x' has unknown type 'money'")
  end)

  it('rejects a missing name', function()
    assert.has_error(function()
      validate.compile({ { type = 'integer' } })
    end, 'safe_events: argument #1 has no name')
  end)

  it('rejects duplicate names', function()
    assert.has_error(function()
      validate.compile({ { name = 'a', type = 'integer' }, { name = 'a', type = 'string' } })
    end, "safe_events: argument 'a' is declared twice")
  end)

  it('rejects min greater than max', function()
    assert.has_error(function()
      validate.compile({ { name = 'a', type = 'integer', min = 5, max = 1 } })
    end, "safe_events: argument 'a' has min greater than max")
  end)
end)

describe('validate.args', function()
  it('returns the values by name', function()
    local ok, values = check({
      { name = 'id', type = 'integer', min = 1 },
      { name = 'label', type = 'string' },
    }, 3, 'pizza')
    assert.is_true(ok)
    assert.same({ id = 3, label = 'pizza' }, values)
  end)

  it('accepts an empty schema with no arguments', function()
    assert.is_true((check({})))
  end)

  it('rejects extra arguments', function()
    local ok, reason = check({ { name = 'id', type = 'integer' } }, 1, 2)
    assert.is_false(ok)
    assert.same('too_many_args', reason.rule)
  end)

  it('rejects a missing required argument', function()
    local ok, reason = check({ { name = 'id', type = 'integer' } })
    assert.is_false(ok)
    assert.same({ rule = 'required', arg = 'id' }, { rule = reason.rule, arg = reason.arg })
  end)

  it('accepts a missing optional argument', function()
    local ok, values = check({ { name = 'note', type = 'string', optional = true } })
    assert.is_true(ok)
    assert.is_nil(values.note)
  end)

  describe('integer', function()
    local schema = { { name = 'n', type = 'integer', min = 1, max = 500 } }

    it('accepts a value inside the bounds', function()
      assert.is_true((check(schema, 500)))
    end)

    it('accepts a float with no fractional part', function()
      assert.is_true((check(schema, 12.0)))
    end)

    it('rejects a fractional value', function()
      local ok, reason = check(schema, 1.5)
      assert.is_false(ok)
      assert.same('type', reason.rule)
    end)

    it('rejects a value above max', function()
      local ok, reason = check(schema, 10000000)
      assert.is_false(ok)
      assert.same('max', reason.rule)
    end)

    it('rejects a value below min', function()
      local ok, reason = check(schema, 0)
      assert.is_false(ok)
      assert.same('min', reason.rule)
    end)

    it('rejects NaN, which passes every < and > comparison', function()
      local ok, reason = check(schema, 0 / 0)
      assert.is_false(ok)
      assert.same('type', reason.rule)
    end)

    it('rejects infinity', function()
      assert.is_false((check(schema, math.huge)))
    end)

    it('rejects a numeric string', function()
      assert.is_false((check(schema, '10')))
    end)
  end)

  describe('number', function()
    it('accepts a finite float', function()
      assert.is_true((check({ { name = 'f', type = 'number', max = 1 } }, 0.25)))
    end)

    it('rejects NaN', function()
      assert.is_false((check({ { name = 'f', type = 'number' } }, 0 / 0)))
    end)
  end)

  describe('string', function()
    it('rejects a string longer than the default 256 characters', function()
      local ok, reason = check({ { name = 's', type = 'string' } }, string.rep('a', 257))
      assert.is_false(ok)
      assert.same('maxLen', reason.rule)
    end)

    it('uses a custom maxLen', function()
      assert.is_false((check({ { name = 's', type = 'string', maxLen = 3 } }, 'abcd')))
    end)

    it('checks a pattern', function()
      local schema = { { name = 'plate', type = 'string', pattern = '^%u%u%d%d%d$' } }
      assert.is_true((check(schema, 'AB123')))
      assert.is_false((check(schema, 'AB12;DROP')))
    end)
  end)

  describe('enum', function()
    local schema = { { name = 'item', type = 'string', enum = { 'bread', 'water' } } }

    it('accepts a listed value', function()
      assert.is_true((check(schema, 'water')))
    end)

    it('rejects an unlisted value', function()
      local ok, reason = check(schema, 'weapon_rpg')
      assert.is_false(ok)
      assert.same('enum', reason.rule)
    end)
  end)

  describe('boolean', function()
    it('rejects a truthy non-boolean', function()
      assert.is_false((check({ { name = 'b', type = 'boolean' } }, 1)))
    end)
  end)

  describe('vector3', function()
    local schema = { { name = 'pos', type = 'vector3' } }

    it('accepts a table with x, y and z', function()
      assert.is_true((check(schema, { x = 1, y = 2, z = 3 })))
    end)

    it('rejects a component that is NaN', function()
      assert.is_false((check(schema, { x = 1, y = 0 / 0, z = 3 })))
    end)
  end)

  describe('table', function()
    it('rejects more items than maxItems', function()
      local ok, reason = check({ { name = 't', type = 'table', maxItems = 2 } }, { 1, 2, 3 })
      assert.is_false(ok)
      assert.same('maxItems', reason.rule)
    end)

    it('validates each item against the items schema', function()
      local schema = { { name = 'ids', type = 'table', items = { type = 'integer', min = 1 } } }
      assert.is_true((check(schema, { 1, 2, 3 })))
      local ok, reason = check(schema, { 1, -4 })
      assert.is_false(ok)
      assert.same('ids[2]', reason.arg)
    end)

    it('rejects non-sequence keys when an items schema is set', function()
      local schema = { { name = 'ids', type = 'table', items = { type = 'integer' } } }
      assert.is_false((check(schema, { 1, 2, evil = 3 })))
    end)
  end)
end)
