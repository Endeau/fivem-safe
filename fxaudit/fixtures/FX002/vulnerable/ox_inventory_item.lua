RegisterNetEvent('crafting:collect', function(data)
    exports.ox_inventory:AddItem(source, data.item, 1)
end)
