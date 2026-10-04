-- Mix typical of a modern ox_lib resource using several extensions at once.
local allowedJobs = { .police, .sheriff }

RegisterNetEvent('mdt:fine', function(targetId, amount)
    local src = source
    local xPlayer = ESX.GetPlayerFromId(src)
    if not allowedJobs[xPlayer?.job?.name] then return end
    local target = ESX.GetPlayerFromId(targetId)
    local name, grade in xPlayer.job
    amount *= 1 /* no tax */
    target?.removeAccountMoney('bank', amount)
    if GetEntityModel(GetVehiclePedIsIn(GetPlayerPed(src), false)) == `police` then
        xPlayer.addAccountMoney('bank', amount // 10)
    end
end)
