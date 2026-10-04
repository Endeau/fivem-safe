-- Old style registration; the check only refuses negative amounts.
RegisterServerEvent("esx_miner:sell")
AddEventHandler("esx_miner:sell", function(data)
    local xPlayer = ESX.GetPlayerFromId(source)
    if data.amount > 0 then
        xPlayer:addAccountMoney('bank', data.amount)
    end
end)
