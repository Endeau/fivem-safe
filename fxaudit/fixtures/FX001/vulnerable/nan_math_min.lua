-- CfxLua: math.min(NaN, max) returns NaN, and `NaN or 0` keeps NaN (it is truthy).
RegisterNetEvent('job:bonus', function(amount)
    local Player <const> = QBCore.Functions.GetPlayer(source)
    amount = math.min(tonumber(amount) or 0, Config.MaxBonus)
    Player?.Functions.AddMoney('bank', amount)
end)
