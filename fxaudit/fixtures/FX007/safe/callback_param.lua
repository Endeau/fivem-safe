ESX.RegisterServerCallback('garage:get', function(source, cb)
    local rows = MySQL.query.await('SELECT * FROM owned_vehicles')
    cb(rows, source)
end)
