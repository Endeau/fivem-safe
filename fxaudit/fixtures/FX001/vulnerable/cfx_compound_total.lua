-- CfxLua: the total is summed from prices sent by the client.
RegisterNetEvent('shop:sellAll', function(items)
    local xPlayer <const> = ESX.GetPlayerFromId(source)
    local total = 0
    for _, entry in pairs(items) do
        total += entry.price * entry.count
    end
    xPlayer?.addAccountMoney('money', total, 'shop:sellAll')
end)
