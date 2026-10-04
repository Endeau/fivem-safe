-- Same shape as esx_vehicleshop: source is read in an async MySQL callback,
-- where it is nil (checked in game: the warning printed "Player nil").
RegisterNetEvent('shop:returnProvider', function(vehicleModel)
    MySQL.single('SELECT id FROM cardealer_vehicles WHERE vehicle = ?', { vehicleModel }, function(result)
        if not result then
            return print(('Player %s tried an invalid vehicle'):format(source))
        end
    end)
end)
