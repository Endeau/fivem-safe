RegisterNetEvent('garage:list', function()
    local rows = MySQL.query.await('SELECT * FROM owned_vehicles')
    TriggerClientEvent('garage:show', source, rows)
end)
