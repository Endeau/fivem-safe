RegisterServerEvent('esx_billing:delete')
AddEventHandler('esx_billing:delete', function(id)
    MySQL.Async.execute("DELETE FROM billing WHERE id = '" .. id .. "'", {})
end)
