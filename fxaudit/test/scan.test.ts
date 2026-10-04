import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { globToRegExp, readManifest, scan } from '../src/scan.ts'

describe('globToRegExp', () => {
  it('matches fxmanifest globs', () => {
    expect(globToRegExp('client/*.lua').test('client/main.lua')).toBe(true)
    expect(globToRegExp('client/*.lua').test('client/sub/main.lua')).toBe(false)
    expect(globToRegExp('client/**/*.lua').test('client/sub/main.lua')).toBe(true)
    expect(globToRegExp('client/**/*.lua').test('client/main.lua')).toBe(true)
    expect(globToRegExp('cl_?.lua').test('cl_a.lua')).toBe(true)
  })
})

describe('readManifest', () => {
  it('reads single entries, lists and skips other resources', () => {
    const m = readManifest(
      `client_script 'client.lua'\nclient_scripts {\n  'client/*.lua',\n  '@ox_lib/init.lua',\n}\nserver_scripts { "server/*.lua" }\nshared_script 'config.lua'`,
      '/r',
    )
    expect(m.client.map(String)).toEqual([String(/^client\.lua$/), String(/^client\/[^/]*\.lua$/)])
    expect(m.server).toHaveLength(2)
  })
})

describe('scan', () => {
  it('skips client-only scripts and reports the others', () => {
    const root = mkdtempSync(join(tmpdir(), 'fxaudit-'))
    const res = join(root, '[jobs]', 'pizza')
    mkdirSync(join(res, 'client'), { recursive: true })
    mkdirSync(join(res, 'server'), { recursive: true })
    writeFileSync(join(res, 'fxmanifest.lua'), "client_scripts { 'client/*.lua' }\nserver_scripts { 'server/*.lua' }")
    const handler = "RegisterNetEvent('pizza:pay', function(a) ESX.GetPlayerFromId(source).addMoney(a) end)"
    writeFileSync(join(res, 'client', 'main.lua'), handler)
    writeFileSync(join(res, 'server', 'main.lua'), handler)
    writeFileSync(join(res, 'server', 'broken.lua'), 'local = 1')

    const result = scan(root)
    expect(result.skippedClientFiles).toBe(1)
    expect(result.files).toBe(2)
    expect(result.findings.map((f) => `${f.rule} ${f.file}`)).toEqual(['FX001 [jobs]/pizza/server/main.lua'])
    expect(result.errors.map((e) => e.file)).toEqual(['[jobs]/pizza/server/broken.lua'])
  })
})
