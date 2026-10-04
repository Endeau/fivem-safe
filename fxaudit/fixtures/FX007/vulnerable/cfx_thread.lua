-- CfxLua: a thread runs after the handler returned.
RegisterNetEvent('robbery:start', function()
    local store <const> = Config.Stores[1]
    CreateThread(function()
        Wait(store?.duration or 1000)
        TriggerClientEvent('robbery:done', source)
    end)
end)
