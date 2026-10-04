RegisterNetEvent('police:handcuff', function(target)
    local xPlayer = ESX.GetPlayerFromId(source)
    if xPlayer.job.name ~= 'police' then return end
    TriggerClientEvent('police:handcuff', target)
end)
