fx_version 'cerulean'
game 'gta5'
lua54 'yes'

description 'Demo: the same payout written unsafe and with safe_events, plus commands to attack both.'

shared_script '@ox_lib/init.lua'
server_scripts {
  '@safe_events/import.lua',
  'server.lua',
}
client_script 'client.lua'

dependencies { 'es_extended', 'ox_lib', 'safe_events' }
