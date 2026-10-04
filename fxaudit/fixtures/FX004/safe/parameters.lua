RegisterNetEvent('garage:rename', function(plate, label)
    MySQL.update('UPDATE owned_vehicles SET label = ? WHERE plate = ?', { label, plate })
end)
