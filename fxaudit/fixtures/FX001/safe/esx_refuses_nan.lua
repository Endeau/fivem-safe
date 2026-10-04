-- Only an upper bound, but ESX's addMoney refuses NaN itself (money > 0 fails).
RegisterNetEvent('job:overtime', function(hours)
    if hours > 8 then
        hours = 8
    end
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addMoney(hours * Config.HourlyRate)
end)
