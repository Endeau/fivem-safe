import { describe, expect, it } from 'vitest'
import { rewrite } from '../src/parse/rewrite.ts'
import { parseLua } from '../src/parse/parse.ts'

function check(source: string) {
  const result = rewrite(source)
  expect(result.code).toHaveLength(source.length)
  expect(result.code.split('\n').length).toBe(source.split('\n').length)
  // The rewritten code must parse.
  parseLua(source)
  return result
}

describe('rewrite', () => {
  it('turns compound assignments into plain ones and keeps the operator', () => {
    const { code, marks } = check('local total = 0\ntotal += amount\nflags <<= 1\nn //= 2')
    expect(code).toBe('local total = 0\ntotal  = amount\nflags   = 1\nn   = 2')
    expect(marks.map((m) => m.op)).toEqual(['+', '<<', '//'])
  })

  it('leaves comparisons alone', () => {
    const { marks } = check('if a ~= b and c == d and e <= f and g >= h then end')
    expect(marks).toEqual([])
  })

  it('handles safe navigation on fields, indexes and calls', () => {
    const { code, marks } = check('local n = xPlayer?.job?.name\nlocal r = rows?[1]\nlocal s = t?.[k]\ncb?.(1)')
    expect(code).toContain('xPlayer .job .name')
    expect(marks.map((m) => m.kind)).toEqual(['safenav_field', 'safenav_field', 'safenav_index', 'safenav_index', 'safenav_call'])
  })

  it('turns hashes into strings and records the name', () => {
    const { code, marks } = check('GiveWeaponToPed(ped, `WEAPON_PISTOL`, 50)')
    expect(code).toBe('GiveWeaponToPed(ped, "WEAPON_PISTOL", 50)')
    expect(marks[0]).toMatchObject({ kind: 'hash', name: 'WEAPON_PISTOL' })
  })

  it('rewrites in-unpacking', () => {
    const { code, marks } = check('local name, grade in xPlayer.job')
    expect(code).toBe('local name, grade =  xPlayer.job')
    expect(marks[0]?.kind).toBe('in_unpack')
  })

  it('does not touch the in of a generic for', () => {
    const { marks } = check('local t = {}\nfor k, v in pairs(t) do end')
    expect(marks).toEqual([])
  })

  it('rewrites set constructors', () => {
    const { code, marks } = check('local jobs = { .police, .sheriff }')
    expect(code).toBe('local jobs = {  police,  sheriff }')
    expect(marks.map((m) => m.name)).toEqual(['police', 'sheriff'])
  })

  it('keeps varargs in a table constructor', () => {
    const { marks } = check('local function f(...) return { ... }, {n, ...} end')
    expect(marks).toEqual([])
  })

  it('keeps numbers such as .5, 1e-3 and 0x1p4', () => {
    const { marks } = check('local t = { .5, 1e-3, 0x1p4, 0xFF, 3.0 }')
    expect(marks).toEqual([])
  })

  it('blanks several attributes on one line', () => {
    const { code, marks } = check('local a <const>, b <close> = 1, nil')
    expect(code).toBe('local a        , b         = 1, nil')
    expect(marks.map((m) => m.attrib)).toEqual(['const', 'close'])
  })

  it('blanks C comments and keeps their newlines', () => {
    const { code } = check('local a = 1 /* one\ntwo */ local b = 2')
    expect(code).toBe('local a = 1       \n       local b = 2')
  })

  describe('never rewrites inside strings and comments', () => {
    const cases: Record<string, string> = {
      'short strings': `local s = "a?.b \`x\` += { .f }" local t = 'c ?[ d'`,
      'escaped quotes': `local s = "say \\"a?.b\\" += 1"`,
      'long strings': 'local s = [[ a?.b `x` += ]]',
      'long strings with level': 'local s = [==[ ]] a?.b `x` ]=] += ]==]',
      'line comments': 'local a = 1 -- a?.b `x` += { .f }',
      'long comments': '--[[ a?.b\n`x` += ]] local a = 1',
      'long comments with level': '--[=[ ]] a?.b `x` ]=] local a = 1',
    }
    for (const [name, source] of Object.entries(cases)) {
      it(name, () => {
        const { code, marks } = check(source)
        expect(code).toBe(source)
        expect(marks).toEqual([])
      })
    }
  })

  it('does not treat defer as a keyword', () => {
    const { marks } = check('deferrals.defer()\nlocal function defer(fn) return fn end')
    expect(marks).toEqual([])
  })

  it('keeps positions of a mixed real handler', () => {
    const source = [
      "RegisterNetEvent('shop:buy', function(item, count)",
      '  local xPlayer <const> = ESX.GetPlayerFromId(source)',
      '  local price = Config.Prices?[item] or 0',
      '  price *= count',
      '  xPlayer?.removeAccountMoney(`money`, price)',
      'end)',
    ].join('\n')
    const { ast } = parseLua(source)
    const handler = ast.body[0].expression.arguments[1]
    expect(handler.parameters.map((p: { name: string }) => p.name)).toEqual(['item', 'count'])
    const call = handler.body[3].expression
    expect(call.base.identifier.name).toBe('removeAccountMoney')
    expect(call.loc.start).toEqual({ line: 5, column: 2 })
    expect(source.slice(call.base.identifier.range[0], call.base.identifier.range[1])).toBe('removeAccountMoney')
  })
})
