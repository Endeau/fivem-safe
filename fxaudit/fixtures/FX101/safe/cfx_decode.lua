-- CfxLua: the response is only decoded.
PerformHttpRequest('https://example.invalid/prices', function(status, body)
    local prices <const> = json.decode(body) or {}
    for name, price in pairs(prices) do
        Config.Prices[name] = price
    end
end)
