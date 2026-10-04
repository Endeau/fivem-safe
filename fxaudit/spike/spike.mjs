// Compares parsers on the fixtures and on the corpus.
// Usage (in Docker, see run.sh): node spike.mjs
import fs from 'node:fs'
import path from 'node:path'
import luaparse from 'luaparse'
import { Parser, Language } from 'web-tree-sitter'
import { rewrite } from './rewrite.mjs'

const FIXTURES = 'fixtures'
const CORPUS = 'corpus'
const SINKS = new Set(['addMoney', 'addAccountMoney', 'addInventoryItem', 'AddItem', 'removeAccountMoney'])

const walkFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '.git' || e.name === 'node_modules' ? [] : walkFiles(p)
    return e.name.endsWith('.lua') ? [p] : []
  })

// ---------- luaparse ----------
const LUAPARSE_OPTS = { luaVersion: '5.3', locations: true, ranges: true, comments: false, scope: false }

function luaparseAnalyze(original, code) {
  const idents = []
  const sinks = []
  const ast = luaparse.parse(code, {
    ...LUAPARSE_OPTS,
    onCreateNode(node) {
      if (node.type === 'Identifier') idents.push(node)
      if (node.type === 'CallExpression' && node.base.type === 'MemberExpression' && SINKS.has(node.base.identifier.name)) {
        const loc = node.base.identifier.loc.start
        sinks.push(`${node.base.indexer}${node.base.identifier.name}@${loc.line}:${loc.column}`)
      }
    },
  })
  const badPositions = idents.filter((id) => original.slice(id.range[0], id.range[1]) !== id.name)
  return { ast, identCount: idents.length, badPositions: badPositions.length, sinks }
}

function runLuaparse(file, useRewrite) {
  const original = fs.readFileSync(file, 'utf8')
  let code = original
  let marks = []
  if (useRewrite) ({ code, marks } = rewrite(original))
  if (code.length !== original.length) return { ok: false, error: 'rewrite changed length' }
  try {
    const r = luaparseAnalyze(original, code)
    return { ok: true, ...r, marks: marks.length }
  } catch (e) {
    return { ok: false, error: `${e.message}` }
  }
}

// ---------- tree-sitter ----------
await Parser.init()
const Lua = await Language.load('node_modules/@tree-sitter-grammars/tree-sitter-lua/tree-sitter-lua.wasm')
const tsParser = new Parser()
tsParser.setLanguage(Lua)

function runTreeSitter(file) {
  const original = fs.readFileSync(file, 'utf8')
  const tree = tsParser.parse(original)
  const errors = []
  const sinks = []
  let idents = 0
  let badPositions = 0
  const cursor = tree.walk()
  const visit = () => {
    const node = cursor.currentNode
    if (node.type === 'ERROR' || node.isMissing) {
      errors.push(`${node.isMissing ? 'MISSING ' + node.type : 'ERROR'}@${node.startPosition.row + 1}:${node.startPosition.column} "${original.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 30)).replace(/\n/g, '\\n')}"`)
    }
    if (node.type === 'identifier') {
      idents++
      if (Buffer.from(original).subarray(node.startIndex, node.endIndex).toString() !== node.text) badPositions++
    }
    if (node.type === 'function_call') {
      const name = node.childForFieldName('name')
      if (name && (name.type === 'dot_index_expression' || name.type === 'method_index_expression')) {
        const field = name.childForFieldName(name.type === 'dot_index_expression' ? 'field' : 'method')
        if (field && SINKS.has(field.text)) {
          sinks.push(`${name.type === 'dot_index_expression' ? '.' : ':'}${field.text}@${field.startPosition.row + 1}:${field.startPosition.column}`)
        }
      }
    }
    if (cursor.gotoFirstChild()) {
      do visit()
      while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }
  visit()
  return { ok: errors.length === 0, errors, identCount: idents, badPositions, sinks }
}

// ---------- fixtures ----------
const fixtures = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.lua')).sort()
const report = { fixtures: {}, corpus: {} }
for (const f of fixtures) {
  const file = path.join(FIXTURES, f)
  const raw = runLuaparse(file, false)
  const rw = runLuaparse(file, true)
  const ts = runTreeSitter(file)
  report.fixtures[f] = {
    luaparse: raw.ok ? 'ok' : raw.error,
    'luaparse+rewrite': rw.ok ? `ok (${rw.marks} réécritures, ${rw.badPositions} positions fausses / ${rw.identCount} identifiants)` : rw.error,
    'tree-sitter': ts.ok ? `ok (${ts.badPositions} positions fausses / ${ts.identCount})` : ts.errors.join(' | '),
    sinks_luaparse: rw.sinks ?? [],
    sinks_treesitter: ts.sinks,
  }
}

// ---------- corpus: success rate and speed ----------
const files = fs.existsSync(CORPUS) ? walkFiles(CORPUS) : []
const sources = files.map((f) => [f, fs.readFileSync(f, 'utf8')])
const bytes = sources.reduce((s, [, src]) => s + src.length, 0)

function bench(label, fn) {
  const times = []
  let failures = []
  for (let run = 0; run < 3; run++) {
    failures = []
    const t0 = performance.now()
    for (const [f, src] of sources) {
      const err = fn(src)
      if (err) failures.push(`${f}: ${err}`)
    }
    times.push(performance.now() - t0)
  }
  report.corpus[label] = {
    files: sources.length,
    failures: failures.length,
    msBest: Math.round(Math.min(...times)),
    sampleFailures: failures.slice(0, 8),
  }
}

bench('luaparse', (src) => {
  try { luaparse.parse(src, LUAPARSE_OPTS) } catch (e) { return e.message }
})
bench('luaparse+rewrite', (src) => {
  try { luaparse.parse(rewrite(src).code, LUAPARSE_OPTS) } catch (e) { return e.message }
})
bench('tree-sitter+rewrite', (src) => {
  const tree = tsParser.parse(rewrite(src).code)
  const hasError = tree.rootNode.hasError
  tree.delete()
  return hasError ? 'ERROR node' : null
})
{
  // Position check on the whole corpus: every identifier found in the
  // rewritten code must read the same in the original file.
  let checked = 0
  let wrong = 0
  for (const [, src] of sources) {
    try {
      const r = luaparseAnalyze(src, rewrite(src).code)
      checked += r.identCount
      wrong += r.badPositions
    } catch {}
  }
  report.corpus.positionsLuaparseRewrite = { identifiers: checked, wrong }
}
bench('tree-sitter', (src) => {
  const tree = tsParser.parse(src)
  const hasError = tree.rootNode.hasError
  tree.delete()
  return hasError ? 'ERROR node' : null
})
report.corpus.bytes = bytes

console.log(JSON.stringify(report, null, 2))
