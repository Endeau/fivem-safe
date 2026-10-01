fx_version 'cerulean'
game 'gta5'
lua54 'yes'

description 'Dev server only: /se_esx shows three ESX `source` bugs, applies the fixes, and shows them fixed.'

server_script 'server.lua'
client_script 'client.lua'
-- Only es_extended: this resource restarts esx_jobs and esx_vehicleshop, and a
-- resource that depends on them would be stopped by that restart, in the
-- middle of its own script.
dependencies { 'es_extended' }
