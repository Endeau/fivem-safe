-- Validation of the arguments a client sends with a net event.
-- Everything here assumes the client is hostile: types are checked exactly,
-- numbers must be finite, and extra arguments are refused.

local validate = {}

local DEFAULT_MAX_LEN = 256 -- in bytes: an accented letter counts 2 in UTF-8
local DEFAULT_MAX_ITEMS = 64

local KNOWN_KEYS = {
  name = true, type = true, optional = true, min = true, max = true,
  maxLen = true, pattern = true, enum = true, maxItems = true, items = true,
}

local function isFinite(value)
  -- NaN is the only value not equal to itself; it passes every < and > check.
  return type(value) == 'number' and value == value and value ~= math.huge and value ~= -math.huge
end

local function isVector3(value)
  local t = type(value)
  if t ~= 'vector3' and t ~= 'table' then return false end
  return isFinite(value.x) and isFinite(value.y) and isFinite(value.z)
end

local TYPES = {
  integer = function(v) return isFinite(v) and math.floor(v) == v end,
  number = isFinite,
  string = function(v) return type(v) == 'string' end,
  boolean = function(v) return type(v) == 'boolean' end,
  vector3 = isVector3,
  table = function(v) return type(v) == 'table' end,
}

local function fail(rule, arg, got)
  return false, { rule = rule, arg = arg, got = got }
end

local function describe(value)
  local t = type(value)
  if t == 'string' then
    return #value > 64 and ('string(%d)'):format(#value) or ('%q'):format(value)
  end
  if t == 'table' then return 'table' end
  return tostring(value)
end

local function compileOne(spec, label)
  for key in pairs(spec) do
    if not KNOWN_KEYS[key] then
      error(("safe_events: argument '%s' has unknown option '%s'"):format(label, key), 0)
    end
  end
  if not TYPES[spec.type] then
    error(("safe_events: argument '%s' has unknown type '%s'"):format(label, tostring(spec.type)), 0)
  end
  if spec.min and spec.max and spec.min > spec.max then
    error(("safe_events: argument '%s' has min greater than max"):format(label), 0)
  end

  local compiled = {
    name = spec.name,
    type = spec.type,
    optional = spec.optional == true,
    min = spec.min,
    max = spec.max,
    pattern = spec.pattern,
  }
  if spec.type == 'string' then compiled.maxLen = spec.maxLen or DEFAULT_MAX_LEN end
  if spec.type == 'table' then
    compiled.maxItems = spec.maxItems or DEFAULT_MAX_ITEMS
    if spec.items then compiled.items = compileOne(spec.items, label .. '[]') end
  end
  if spec.enum then
    compiled.enum = {}
    for _, allowed in ipairs(spec.enum) do compiled.enum[allowed] = true end
  end
  return compiled
end

--- Turns a list of argument specs into a checked, ready-to-use schema.
-- Errors describe developer mistakes, at registration time.
function validate.compile(schema)
  local compiled, seen = {}, {}
  for i, spec in ipairs(schema or {}) do
    if type(spec.name) ~= 'string' or spec.name == '' then
      error(('safe_events: argument #%d has no name'):format(i), 0)
    end
    if seen[spec.name] then
      error(("safe_events: argument '%s' is declared twice"):format(spec.name), 0)
    end
    seen[spec.name] = true
    compiled[i] = compileOne(spec, spec.name)
  end
  return compiled
end

local checkValue

local function checkTable(spec, value, label)
  local count = 0
  for _ in pairs(value) do
    count = count + 1
    if count > spec.maxItems then return fail('maxItems', label, count) end
  end
  if spec.items then
    if count ~= #value then return fail('items', label, 'non-sequence keys') end
    for i = 1, #value do
      local ok, reason = checkValue(spec.items, value[i], ('%s[%d]'):format(label, i))
      if not ok then return false, reason end
    end
  end
  return true
end

checkValue = function(spec, value, label)
  if not TYPES[spec.type](value) then return fail('type', label, describe(value)) end

  if spec.type == 'integer' or spec.type == 'number' then
    if spec.min and value < spec.min then return fail('min', label, value) end
    if spec.max and value > spec.max then return fail('max', label, value) end
  elseif spec.type == 'string' then
    if #value > spec.maxLen then return fail('maxLen', label, #value) end
    if spec.pattern and not value:find(spec.pattern) then return fail('pattern', label, describe(value)) end
  elseif spec.type == 'table' then
    local ok, reason = checkTable(spec, value, label)
    if not ok then return false, reason end
  end

  if spec.enum and not spec.enum[value] then return fail('enum', label, describe(value)) end
  return true
end

--- Checks the `count` values received against a compiled schema.
-- Returns true and the values keyed by name, or false and a reason table
-- { rule, arg, got }.
function validate.args(compiled, count, ...)
  if count > #compiled then return fail('too_many_args', nil, count) end

  local values = {}
  for i, spec in ipairs(compiled) do
    local value = (select(i, ...))
    if value == nil then
      if not spec.optional then return fail('required', spec.name, 'nil') end
    else
      local ok, reason = checkValue(spec, value, spec.name)
      if not ok then return false, reason end
      values[spec.name] = value
    end
  end
  return true, values
end

return validate
