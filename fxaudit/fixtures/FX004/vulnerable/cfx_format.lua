-- CfxLua: query built with string.format through a method call.
lib.callback.register('users:find', function(source, name)
    local sql <const> = ('SELECT money FROM users WHERE firstname = "%s"'):format(name)
    return MySQL.scalar.await(sql)
end)
