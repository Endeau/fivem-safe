RegisterNetEvent('notes:save', function(text)
    exports.oxmysql:execute('INSERT INTO notes (text) VALUES ("' .. text .. '")')
end)
