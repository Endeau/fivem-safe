local function pay(xPlayer, amount)
    xPlayer.addAccountMoney('money', amount)
end

RegisterNetEvent('delivery:finish', function(reward)
    pay(ESX.GetPlayerFromId(source), reward)
end)
