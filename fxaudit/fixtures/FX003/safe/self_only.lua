RegisterNetEvent('ems:selfRevive', function(target)
    if target ~= source then return end
    local xTarget = ESX.GetPlayerFromId(target)
    xTarget.triggerEvent('esx_ambulancejob:revive')
end)
