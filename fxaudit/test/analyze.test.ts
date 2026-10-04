import { describe, expect, it } from 'vitest'
import { analyzeFile } from '../src/analysis/analyze.ts'
import { parseLua } from '../src/parse/parse.ts'

const run = (code: string) => analyzeFile(parseLua(code), { file: 'server.lua' })
const rules = (code: string) => run(code).findings.map((f) => f.rule)

describe('handlers', () => {
  it('pairs RegisterServerEvent and AddEventHandler whatever the quotes', () => {
    const code = `
      RegisterServerEvent("job:pay")
      AddEventHandler('job:pay', function(amount) ESX.GetPlayerFromId(source).addMoney(amount) end)`
    expect(rules(code)).toEqual(['FX001'])
  })

  it('ignores AddEventHandler on events that are not net events', () => {
    const code = `AddEventHandler('esx:playerLoaded', function(playerId, xPlayer) xPlayer.addMoney(playerId) end)`
    expect(run(code).handlers).toBe(0)
    expect(rules(code)).toEqual([])
  })

  it('analyzes a handler given as a local function', () => {
    const code = `
      local function onPay(amount) ESX.GetPlayerFromId(source).addMoney(amount) end
      RegisterNetEvent('job:pay', onPay)`
    expect(rules(code)).toEqual(['FX001'])
  })

  it('does not taint source and cb of an ESX callback', () => {
    const code = `
      ESX.RegisterServerCallback('x', function(source, cb, id)
        ESX.GetPlayerFromId(source).addMoney(cb)
      end)`
    expect(rules(code)).toEqual([])
  })
})

describe('findings', () => {
  it('gives the line and column of the method name', () => {
    const [f] = run(`RegisterNetEvent('a', function(n)\n  local x = ESX.GetPlayerFromId(source)\n  x.addMoney(n)\nend)`).findings
    expect(f).toMatchObject({ rule: 'FX001', line: 3, column: 5, event: 'a', confidence: 'high' })
  })

  it('lowers the confidence when the value goes through a helper', () => {
    const [f] = run(`
      local function give(p, v) p.addMoney(v) end
      RegisterNetEvent('a', function(n) give(ESX.GetPlayerFromId(source), n) end)`).findings
    expect(f?.confidence).toBe('medium')
  })

  it('honors fxaudit-ignore on the same line', () => {
    const code = `RegisterNetEvent('a', function(n) ESX.GetPlayerFromId(source).addMoney(n) end) -- fxaudit-ignore FX001`
    expect(rules(code)).toEqual([])
  })

  it('does not ignore another rule', () => {
    const code = `RegisterNetEvent('a', function(n) ESX.GetPlayerFromId(source).addMoney(n) end) -- fxaudit-ignore FX002`
    expect(rules(code)).toEqual(['FX001'])
  })

  it('keeps source valid inside a TriggerEvent callback, which runs synchronously', () => {
    // Checked in game on esx_jobs: a probe in such a callback printed source = 1.
    const findings = run(`
      RegisterNetEvent('a', function()
        TriggerEvent('esx_addonaccount:getSharedAccount', 'society', function(account)
          TriggerClientEvent('x', source)
        end)
      end)`).findings
    expect(findings).toEqual([])
  })

  it('still reports source in a TriggerEvent callback after a Wait', () => {
    const [f] = run(`
      RegisterNetEvent('a', function()
        Wait(100)
        TriggerEvent('esx_addonaccount:getSharedAccount', 'society', function(account)
          TriggerClientEvent('x', source)
        end)
      end)`).findings
    expect(f?.rule).toBe('FX007')
  })
})

describe('checks', () => {
  const pay = (check: string) =>
    rules(`RegisterNetEvent('a', function(n)\n${check}\nESX.GetPlayerFromId(source).addMoney(n)\nend)`)

  it('an upper bound that NaN goes through is reported with medium confidence', () => {
    const findings = run(`RegisterNetEvent('a', function(n)\nif n > 100 then return end\nlocal Player = QBCore.Functions.GetPlayer(source)\nPlayer.Functions.AddMoney('cash', n)\nend)`).findings
    expect(findings.map((f) => [f.rule, f.confidence])).toEqual([['FX001', 'medium']])
    expect(findings[0]?.message).toContain('NaN')
    expect(findings[0]?.fix).toContain('amount ~= amount')
  })
  it('an upper bound plus a NaN guard is enough', () => expect(pay('if n ~= n or n > 100 then return end')).toEqual([]))
  it('a NaN guard written as n == n also counts', () => {
    expect(rules(`RegisterNetEvent('a', function(n)\nif n == n and n <= 100 then ESX.GetPlayerFromId(source).addMoney(n) end\nend)`)).toEqual([])
  })
  it('ESX money functions refuse NaN themselves, so an upper bound is enough there', () => {
    expect(pay('if n > 100 then return end')).toEqual([])
  })
  it('a NaN guard alone is not a bound', () => expect(pay('if n ~= n then return end')).toEqual(['FX001']))
  it('a lower bound is not', () => expect(pay('if n < 1 then return end')).toEqual(['FX001']))
  it('both sides of an or are applied', () => expect(pay('if not n or n ~= n or n > 100 then return end')).toEqual([]))
  it('the checked branch is safe', () => {
    expect(rules(`RegisterNetEvent('a', function(n)\nif n <= 100 then ESX.GetPlayerFromId(source).addMoney(n) end\nend)`)).toEqual([])
  })
  it('tonumber alone is not a check', () => expect(pay('n = tonumber(n)')).toEqual(['FX001']))
  it('a compound assignment keeps the taint', () => {
    expect(rules(`RegisterNetEvent('a', function(n)\nlocal t = 10\nt += n\nESX.GetPlayerFromId(source).addMoney(t)\nend)`)).toEqual(['FX001'])
  })
  it('reassigning the variable with server data cleans it', () => expect(pay('n = Config.Pay')).toEqual([]))
})
