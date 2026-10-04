-- CfxLua: a number cannot carry SQL.
RegisterNetEvent('billing:pay', function(data)
    local id <const> = tonumber(data.id)
    if not id then return end
    MySQL.update.await('UPDATE billing SET paid = 1 WHERE id = ' .. id)
end)
