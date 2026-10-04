local code = LoadResourceFile(GetCurrentResourceName(), 'data/config.lua')
local chunk = load(code)
if chunk then chunk() end
