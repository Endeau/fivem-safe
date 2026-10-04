-- The clamp works for numbers, but NaN fails `count > 8` and reaches ox_inventory.
RegisterNetEvent('job:overtime', function(count)
    if count > 8 then
        count = 8
    end
    exports.ox_inventory:AddItem(source, 'money', count * Config.HourlyRate)
end)
