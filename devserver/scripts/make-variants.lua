-- Writes the copies of ESX resources used by /se_esx:
--   resources/[esx_variants]/<resource>_probe and <resource>_fixed
-- from the replacements in esx_source_check/fixes.lua. Fails if ESX changed
-- and a replacement no longer applies.
-- Usage: lua make-variants.lua <fixes.lua> <resources dir>
local fixesPath, resources = arg[1], arg[2]
local fixes = dofile(fixesPath)

local function sh(command)
  assert(os.execute(command), 'command failed: ' .. command)
end

local function quote(path) return "'" .. path:gsub("'", "'\\''") .. "'" end

local function read(path)
  local f = assert(io.open(path, 'rb')); local s = f:read('a'); f:close(); return s
end

local function write(path, s)
  local f = assert(io.open(path, 'wb')); f:write(s); f:close()
end

local byResource = {}
for _, fix in ipairs(fixes) do
  byResource[fix.resource] = byResource[fix.resource] or {}
  table.insert(byResource[fix.resource], fix)
end

local out = resources .. '/[esx_variants]'
sh('rm -rf ' .. quote(out) .. ' && mkdir -p ' .. quote(out))

for resource, list in pairs(byResource) do
  local source = resources .. '/[esx_addons]/' .. resource
  for _, mode in ipairs({ 'probe', 'fixed' }) do
    local changed = false
    for _, fix in ipairs(list) do if fix[mode] then changed = true end end
    if changed then
      local target = out .. '/' .. resource .. '_' .. mode
      sh('cp -r ' .. quote(source) .. ' ' .. quote(target))
      for _, fix in ipairs(list) do
        if fix[mode] then
          local path = target .. '/' .. fix.file
          local code = read(path)
          local first, last = code:find(fix.old, 1, true)
          assert(first, ('%s: text to replace not found (ESX changed?): %s'):format(path, fix.old))
          write(path, code:sub(1, first - 1) .. fix[mode] .. code:sub(last + 1))
        end
      end
      print('variant written: ' .. resource .. '_' .. mode)
    end
  end
end
