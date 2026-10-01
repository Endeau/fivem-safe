-- Sends the events the server asks for, and reports every notification it gets.
RegisterNetEvent('esx_source_check:send', function(eventName, args)
  TriggerServerEvent(eventName, table.unpack(args))
end)

RegisterNetEvent('esx:showNotification', function(message)
  TriggerServerEvent('esx_source_check:notified', tostring(message))
end)
