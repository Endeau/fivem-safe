RegisterNetEvent('police:fine', function(target, amount)
    local xTarget = ESX.GetPlayerFromId(target)
    xTarget.removeAccountMoney('bank', Config.Fines[amount] or 0)
end)
