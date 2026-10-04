RegisterNetEvent('job:set', function(job)
    MySQL.Async.execute('UPDATE users SET job = @job', { ['@job'] = job })
end)
