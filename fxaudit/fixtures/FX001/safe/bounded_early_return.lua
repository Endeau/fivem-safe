-- amount ~= amount is only true for NaN.
RegisterNetEvent('job:tip', function(amount)
    if type(amount) ~= 'number' or amount ~= amount or amount < 1 or amount > 500 then
        return
    end
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addMoney(amount)
end)
