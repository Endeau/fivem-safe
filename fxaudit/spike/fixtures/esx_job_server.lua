-- Realistic ESX job server file (plain Lua 5.4, no Cfx extensions).
local ESX = exports['es_extended']:getSharedObject()
local Config = Config or {}

local function isNear(src, coords, max)
    local ped = GetPlayerPed(src)
    local pos = GetEntityCoords(ped)
    return #(pos - coords) <= max
end

RegisterNetEvent('pizza:pay')
AddEventHandler('pizza:pay', function(amount, deliveryId)
    local src = source
    local xPlayer = ESX.GetPlayerFromId(src)
    local total = amount * 2
    xPlayer.addMoney(total)
    xPlayer:addAccountMoney('bank', amount, 'pizza')
end)

RegisterNetEvent('pizza:item', function(item, count)
    local xPlayer = ESX.GetPlayerFromId(source)
    if count > 10 then return end
    xPlayer.addInventoryItem(item, count)
    exports.ox_inventory:AddItem(source, item, count)
end)

ESX.RegisterServerCallback('pizza:price', function(src, cb, id)
    MySQL.query('SELECT price FROM pizzas WHERE id = ' .. id, {}, function(rows)
        cb(rows[1] and rows[1].price or 0)
    end)
end)

lib.callback.register('pizza:stock', function(src, shop)
    return Config.Stock[shop]
end)

CreateThread(function()
    while true do
        Wait(60000)
        for _, playerId in ipairs(GetPlayers()) do
            local xPlayer = ESX.GetPlayerFromId(tonumber(playerId))
            if xPlayer and xPlayer.job.name == 'pizza' then
                xPlayer.addMoney(Config.Salary or 50)
            end
        end
    end
end)

local goto_target = 0
for i = 1, 10 do
    if i % 2 == 0 then goto continue end
    goto_target = goto_target + i
    ::continue::
end

local closeme <close> = nil
local constant <const> = 42
local s = [==[long [[string]] ]==]
local n = 0x1p4 + 3 // 2
