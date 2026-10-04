PerformHttpRequest('https://api.github.com/repos/x/y/releases/latest', function(status, body)
    if status ~= 200 then return end
    local data = json.decode(body)
    print(('Latest version: %s'):format(data.tag_name))
end)
