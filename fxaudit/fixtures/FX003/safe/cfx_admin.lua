-- CfxLua: group check before kicking.
RegisterNetEvent('staff:kick', function(playerId)
    local xPlayer <const> = ESX.GetPlayerFromId(source)
    if xPlayer?.getGroup() ~= 'admin' then return end
    DropPlayer(playerId, 'Kicked by staff')
end)
