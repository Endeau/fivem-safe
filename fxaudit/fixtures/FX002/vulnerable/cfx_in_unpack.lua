-- CfxLua: in-unpacking from a table sent by the client.
RegisterNetEvent('loot:take', function(loot)
    local xPlayer <const> = ESX.GetPlayerFromId(source)
    local name, qty in loot
    xPlayer?.addInventoryItem(name, qty)
end)
