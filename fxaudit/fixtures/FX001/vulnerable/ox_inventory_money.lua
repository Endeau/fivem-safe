RegisterNetEvent('fishing:sell', function(count)
    local src = source
    exports.ox_inventory:AddItem(src, 'money', count)
end)
