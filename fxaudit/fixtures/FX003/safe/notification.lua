RegisterNetEvent('phone:ping', function(target)
    TriggerClientEvent('esx:showNotification', target, 'Quelqu\'un vous cherche')
end)
