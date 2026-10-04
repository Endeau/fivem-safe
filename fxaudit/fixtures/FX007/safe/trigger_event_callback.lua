-- Same shape as esx_jobs:caution: the TriggerEvent callback runs synchronously
-- inside the local event, and source is still the caller there (checked in game).
RegisterNetEvent('esx_jobs:caution', function(cautionType, cautionAmount)
    local xPlayer = ESX.Player(source)
    local identifier = xPlayer.getIdentifier()
    if cautionType == 'give_back' then
        TriggerEvent('esx_addonaccount:getAccount', 'caution', identifier, function(account)
            local toGive = ESX.Math.Round(account.money * 0.5)
            account.removeMoney(toGive)
            TriggerClientEvent('esx:showNotification', source, 'bank_deposit_returned')
        end)
    end
end)
