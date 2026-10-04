RegisterNetEvent('admin:give', function(amount)
    local xPlayer = ESX.GetPlayerFromId(source)
    if xPlayer.getGroup() ~= 'admin' then return end
    -- fxaudit-ignore FX001 (admins only, reviewed)
    xPlayer.addMoney(amount)
end)
