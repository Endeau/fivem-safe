-- The fixes proposed upstream, as exact replacements in ESX's files.
-- Read by scripts/make-variants.lua at install time, which writes the 'probe'
-- and 'fixed' copies of each resource (FiveM forbids a running resource to
-- write into another one), and by server.lua to know which copies exist.
return {
  {
    resource = 'esx_jobs',
    file = 'server/main.lua',
    old = "TriggerClientEvent('esx:showNotification', source, TranslateCap('bank_deposit_returned'",
    -- With one player, a notification sent to everyone looks like a correct one:
    -- both copies print who the notification is really sent to.
    probe = "print(('[esx_check] esx_jobs envoie la notification à source = %s'):format(tostring(source))) TriggerClientEvent('esx:showNotification', source, TranslateCap('bank_deposit_returned'",
    fixed = "print(('[esx_check] esx_jobs envoie la notification à xPlayer.src = %s'):format(tostring(xPlayer.src))) xPlayer.showNotification(TranslateCap('bank_deposit_returned'",
  },
  {
    resource = 'esx_vehicleshop',
    file = 'server/main.lua',
    old = "Attempted To Sell Invalid Vehicle - ^5%s^7!'):format(source, vehicleModel)",
    fixed = "Attempted To Sell Invalid Vehicle - ^5%s^7!'):format(xPlayer.src, vehicleModel)",
  },
  {
    resource = 'esx_vehicleshop',
    file = 'server/main.lua',
    old = "Attempted To Exploit the Garage!'):format(source, plate)",
    fixed = "Attempted To Exploit the Garage!'):format(xPlayer.src, plate)",
  },
}
