fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'safe_events'
author 'Endeau'
description 'Net events and callbacks validated on the server: arguments, job, distance, rate.'
version '0.1.0'
repository 'https://github.com/Endeau/fivem-safe'

server_script 'server/main.lua'

-- import.lua, lib/ and adapters/ are read on the server with LoadResourceFile
-- by the resources that use '@safe_events/import.lua'; clients never need them.
