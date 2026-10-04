RegisterNetEvent('job:startShift', function()
    local src = source
    Wait(5000)
    TriggerClientEvent('job:shift', src)
end)
