RegisterNetEvent('reward:claim', function(rewardId)
    local entry = Config.Rewards[rewardId]
    if not entry then return end
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addInventoryItem(entry.name, entry.count)
end)
