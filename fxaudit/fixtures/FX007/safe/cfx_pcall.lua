-- CfxLua: pcall runs its function right away.
RegisterNetEvent('job:safe', function()
    local ok <const> = pcall(function()
        print(GetPlayerName(source))
    end)
    print(ok)
end)
