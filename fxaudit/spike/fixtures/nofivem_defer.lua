-- `defer` exists in citizenfx/lua (GRIT_POWER_DEFER) but is disabled in FiveM builds.
local function withLock()
    locked = true
    defer locked = false end
    doWork()
end
