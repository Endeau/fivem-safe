import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analysis/analyze.ts'
import { parseLua } from '../src/parse/parse.ts'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')

function findingsOf(file: string) {
  return analyze(parseLua(readFileSync(file, 'utf8')), { file })
}

for (const rule of readdirSync(FIXTURES).sort()) {
  describe(rule, () => {
    const vulnerable = readdirSync(join(FIXTURES, rule, 'vulnerable'))
    const safe = readdirSync(join(FIXTURES, rule, 'safe'))

    it('has at least 3 vulnerable and 3 safe fixtures', () => {
      expect(vulnerable.length).toBeGreaterThanOrEqual(3)
      expect(safe.length).toBeGreaterThanOrEqual(3)
    })

    for (const name of vulnerable) {
      it(`reports vulnerable/${name}`, () => {
        const rules = findingsOf(join(FIXTURES, rule, 'vulnerable', name)).map((f) => f.rule)
        expect(rules).toContain(rule)
      })
    }

    for (const name of safe) {
      it(`reports nothing in safe/${name}`, () => {
        const findings = findingsOf(join(FIXTURES, rule, 'safe', name))
        expect(findings.map((f) => `${f.rule}:${f.line} ${f.message}`)).toEqual([])
      })
    }
  })
}
