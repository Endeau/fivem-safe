-- CfxLua: allowed items as a set constructor.
local ALLOWED <const> = { .bread, .water }

RegisterNetEvent('market:take', function(item)
    if not ALLOWED[item] then return end
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer?.addInventoryItem(item, 1)
end)
