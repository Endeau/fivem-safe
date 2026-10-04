-- The amount comes from the server, the client only picks an id.
RegisterNetEvent('pizza:pay', function(deliveryId)
    local xPlayer = ESX.GetPlayerFromId(source)
    local reward = Config.Rewards[deliveryId]
    if not reward then return end
    xPlayer.addMoney(reward)
end)
