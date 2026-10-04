-- tonumber does not bound anything.
ESX.RegisterServerCallback('bank:deposit', function(source, cb, amount)
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addAccountMoney('bank', tonumber(amount))
    cb(true)
end)
