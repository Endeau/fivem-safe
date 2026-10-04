-- Looks bounded: NaN fails both comparisons. Older qb-core AddMoney only tests
-- amount < 0, so NaN is added to the balance.
RegisterNetEvent('job:tip', function(amount)
    if type(amount) ~= 'number' or amount < 1 or amount > 500 then
        return
    end
    local Player = QBCore.Functions.GetPlayer(source)
    Player.Functions.AddMoney('cash', amount)
end)
