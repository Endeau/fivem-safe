-- A test that must hold: NaN makes it false, so NaN is never paid.
RegisterNetEvent('job:tip', function(amount)
    if amount >= 1 and amount <= 500 then
        local xPlayer = ESX.GetPlayerFromId(source)
        xPlayer.addMoney(amount)
    end
end)
