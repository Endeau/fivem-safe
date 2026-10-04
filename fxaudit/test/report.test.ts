import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args.ts'
import { escapeHtml, formatHtml } from '../src/report/html.ts'
import { fingerprint, formatSarif, toUri } from '../src/report/sarif.ts'
import { RULES } from '../src/rules/rules.ts'
import { scan, type ScanResult } from '../src/scan.ts'

// A small server: one resource with a money exploit, one with a SQL one.
function sampleServer(): string {
  const root = mkdtempSync(join(tmpdir(), 'fxaudit-report-'))
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  write('[jobs]/pizza/fxmanifest.lua', "server_script 'server.lua'\nclient_script 'client.lua'\n")
  write('[jobs]/pizza/server.lua', "RegisterNetEvent('pizza:pay', function(amount)\n    local xPlayer = ESX.GetPlayerFromId(source)\n    xPlayer.addMoney(amount)\nend)\n")
  write('[jobs]/pizza/client.lua', "TriggerServerEvent('pizza:pay', 1)\n")
  write('bank/fxmanifest.lua', "server_script 'server.lua'\n")
  write(
    'bank/server.lua',
    "-- </script><script>alert(1)</script>\nRegisterNetEvent('bank:find', function(name)\n    MySQL.query('SELECT * FROM users WHERE name = \"' .. name .. '\"')\nend)\n",
  )
  return root
}

function sarifOf(result: ScanResult) {
  return JSON.parse(formatSarif(result, result.root)) as {
    version: string
    runs: {
      tool: { driver: { name: string; rules: { id: string; shortDescription: { text: string }; help: { text: string }; defaultConfiguration: { level: string } }[] } }
      results: {
        ruleId: string
        level: string
        message: { text: string }
        locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; startColumn: number } } }[]
        partialFingerprints: Record<string, string>
      }[]
    }[]
  }
}

describe('parseArgs', () => {
  it('reads the target and the report files', () => {
    expect(parseArgs(['res', '--sarif', 'out.sarif', '--html', 'out.html', '--no-color'])).toMatchObject({
      target: 'res',
      sarif: 'out.sarif',
      html: 'out.html',
      color: false,
    })
  })
  it('refuses a report option without a file', () => {
    expect(parseArgs(['res', '--sarif'])).toBe('fxaudit : --sarif attend un nom de fichier.')
  })
  it('refuses unknown options and two targets', () => {
    expect(parseArgs(['--fast'])).toBe('fxaudit : option inconnue --fast.')
    expect(parseArgs(['a', 'b'])).toBe('fxaudit : un seul dossier ou fichier à la fois.')
  })
})

describe('scan', () => {
  it('counts resources and tags each finding with its resource', () => {
    const result = scan(sampleServer())
    expect(result.resources).toBe(2)
    expect(result.findings.map((f) => [f.rule, f.resource])).toEqual([
      ['FX001', '[jobs]/pizza'],
      ['FX004', 'bank'],
    ])
  })
})

describe('SARIF', () => {
  const result = scan(sampleServer())
  const sarif = sarifOf(result)
  const run = sarif.runs[0]!

  it('is SARIF 2.1.0 with every rule described', () => {
    expect(sarif.version).toBe('2.1.0')
    expect(run.tool.driver.name).toBe('fxaudit')
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual(Object.keys(RULES))
    for (const rule of run.tool.driver.rules) {
      expect(rule.shortDescription.text).not.toBe('')
      expect(rule.help.text).not.toBe('')
      expect(['error', 'warning']).toContain(rule.defaultConfiguration.level)
    }
  })

  it('gives each result a rule, a level, a relative location and a fingerprint', () => {
    expect(run.results).toHaveLength(2)
    for (const r of run.results) {
      expect(r.ruleId).toMatch(/^FX\d{3}$/)
      expect(r.level).toBe('error')
      expect(r.message.text).toContain('Correction')
      const location = r.locations[0]!.physicalLocation
      expect(location.artifactLocation.uri).not.toMatch(/^\//)
      expect(location.region.startLine).toBeGreaterThan(0)
      expect(location.region.startColumn).toBeGreaterThan(0)
      expect(r.partialFingerprints['fxaudit/v1']).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('encodes brackets in paths', () => {
    expect(toUri('[jobs]/pizza/server.lua')).toBe('%5Bjobs%5D/pizza/server.lua')
    expect(run.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri).toBe('%5Bjobs%5D/pizza/server.lua')
  })

  it('keeps the fingerprint when the finding moves to another line', () => {
    const f = result.findings[0]!
    expect(fingerprint({ ...f, line: f.line + 40 })).toBe(fingerprint(f))
  })

  it('makes paths relative to the current folder when the files are inside it', () => {
    const uri = JSON.parse(formatSarif(result, join(result.root, '..'))).runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri
    expect(uri).toMatch(/^fxaudit-report-[^/]+\/%5Bjobs%5D\/pizza\/server\.lua$/)
  })

  it('matches the snapshot', () => {
    const stable = formatSarif({ ...result, root: 'server' }, 'server')
    expect(JSON.parse(stable)).toMatchSnapshot()
  })
})

describe('HTML', () => {
  const root = sampleServer()
  const result = scan(root)
  const html = formatHtml(result, {
    readSource: (file) => readFileSync(join(root, file), 'utf8'),
    target: 'resources',
    date: new Date('2026-09-26T10:00:00Z'),
  })

  it('shows the summary and every finding', () => {
    expect(html).toContain('<b>2</b><span>problèmes critiques</span>')
    expect(html).toContain('<b>2</b><span>ressources analysées</span>')
    expect(html).toContain(RULES.FX001.title.replace("'", '&#39;'))
    expect(html).toContain('[jobs]/pizza/server.lua:3:')
    expect(html).toContain('Comment corriger avec safe_events')
  })

  it('escapes the source code it quotes', () => {
    expect(html).not.toContain('</script><script>')
    expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toMatch(/<script/i)
  })

  it('highlights the reported line in the excerpt', () => {
    expect(html).toMatch(/<span class="row hit"><span class="ln">3<\/span><span class="src">    xPlayer\.addMoney\(amount\)<\/span><\/span>/)
  })

  it('has no external resource', () => {
    expect(html).not.toMatch(/(src|href)="https?:/)
    expect(html).not.toMatch(/@import|url\(/)
  })

  it('says so when nothing is found', () => {
    const empty = formatHtml({ ...result, findings: [] }, { readSource: () => undefined, target: 'x', date: new Date() })
    expect(empty).toContain('Aucun problème trouvé')
  })

  it('escapes every special character', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
