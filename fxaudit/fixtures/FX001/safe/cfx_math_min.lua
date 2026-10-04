-- CfxLua: NaN refused first, then clamped with math.min.
RegisterNetEvent('job:bonus', function(amount)
    local xPlayer <const> = ESX.GetPlayerFromId(source)
    amount = tonumber(amount)
    if not amount or amount ~= amount then return end
    amount = math.min(amount, Config.MaxBonus)
    xPlayer?.addMoney(amount)
end)
