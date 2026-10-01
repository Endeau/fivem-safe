-- Lets in the identifiers of dev_whitelist:allowed, and every connection from
-- the local network when dev_whitelist:allowLan is true (the default): the dev
-- server is only reachable from outside if the router forwards its port.
-- A refused player sees their identifier on screen and in the server logs.

local function isLan(ip)
  return ip:find('^10%.') or ip:find('^192%.168%.') or ip:find('^127%.')
    or ip:find('^172%.1[6-9]%.') or ip:find('^172%.2%d%.') or ip:find('^172%.3[01]%.')
end

AddEventHandler('playerConnecting', function(_, _, deferrals)
  local src = source
  deferrals.defer()
  Wait(0)

  local allowed = {}
  for id in GetConvar('dev_whitelist:allowed', ''):gmatch('%S+') do allowed[id] = true end
  local allowLan = GetConvar('dev_whitelist:allowLan', 'true') == 'true'

  local license
  for _, id in ipairs(GetPlayerIdentifiers(src)) do
    if allowed[id] then return deferrals.done() end
    if allowLan and id:find('^ip:') and isLan(id:sub(4)) then return deferrals.done() end
    if id:find('^license:') then license = id end
  end

  print(('^3[dev_whitelist] connexion refusée pour %s (%s)^0'):format(GetPlayerName(src) or '?', license or 'aucune licence'))
  deferrals.done(('Serveur de dev privé. Ton identifiant : %s'):format(license or 'inconnu'))
end)
