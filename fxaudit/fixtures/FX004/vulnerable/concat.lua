RegisterNetEvent('garage:rename', function(plate, label)
    MySQL.update('UPDATE owned_vehicles SET label = "' .. label .. '" WHERE plate = ?', { plate })
end)
