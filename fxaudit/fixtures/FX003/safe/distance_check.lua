RegisterNetEvent('player:giveKeys', function(target)
    local here = GetEntityCoords(GetPlayerPed(source))
    local there = GetEntityCoords(GetPlayerPed(target))
    if #(here - there) > 3.0 then return end
    TriggerClientEvent('vehiclekeys:receive', target)
end)
