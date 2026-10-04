RegisterNetEvent('stats:read', function()
    local rows = MySQL.query.await('SELECT * FROM ' .. Config.StatsTable)
    print(#rows)
end)
