RegisterNetEvent('shop:buy', function(item, count)
    if not Config.Shop[item] then return end
    if count ~= count or count < 1 or count > 10 then return end
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addInventoryItem(item, count)
end)
