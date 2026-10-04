RegisterNetEvent('farm:harvest', function(item)
    if lib.table.contains(Config.Harvestable, item) then
        exports.ox_inventory:AddItem(source, item, 1)
    end
end)
