RegisterServerEvent('armory:take')
AddEventHandler('armory:take', function(weapon)
    local xPlayer = ESX.GetPlayerFromId(source)
    if xPlayer.job.name == 'police' then
        xPlayer.addWeapon(weapon, 250)
    end
end)
