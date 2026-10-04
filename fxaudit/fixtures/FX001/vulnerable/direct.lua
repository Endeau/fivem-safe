-- The client chooses how much it is paid.
local ESX = exports.es_extended:getSharedObject()

RegisterNetEvent('pizza:pay', function(amount)
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addMoney(amount)
end)
