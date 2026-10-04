-- CfxLua: revive any player from a callback.
lib.callback.register('ems:revive', function(source, targetId)
    local xTarget <const> = ESX.GetPlayerFromId(targetId)
    xTarget?.triggerEvent('esx_ambulancejob:revive')
    return true
end)
