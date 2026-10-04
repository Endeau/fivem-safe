// Position-preserving rewrite of CfxLua (and Lua 5.4 attributes) into Lua 5.3
// that luaparse understands. Every replacement has the same length as the
// original text and newlines are never touched, so line, column and range of
// every AST node still point at the original source. Each rewrite is recorded
// in `marks` so the analyzer can restore the real meaning (compound operator,
// hash, safe navigation...).

const isIdentStart = (c) => /[A-Za-z_]/.test(c)
const isIdent = (c) => /[A-Za-z0-9_]/.test(c)
const blank = (s) => s.replace(/[^\n]/g, ' ')

export function rewrite(source) {
  const out = source.split('')
  const marks = []
  const n = source.length
  let i = 0
  // Tracks `{` nesting to know when a `.name` is a set-constructor field.
  const braces = []
  let lastSignificant = '' // last non-space, non-comment char outside strings
  let lastWord = ''
  let localNames = false // inside `local a, b` before `=`/`in`
  let expectingName = false

  const set = (from, text) => {
    for (let k = 0; k < text.length; k++) out[from + k] = text[k]
  }
  const mark = (kind, from, to, extra = {}) => marks.push({ kind, start: from, end: to, ...extra })

  const longBracketLevel = (at) => {
    // returns level if `[` `=`* `[` starts at `at`, else -1
    if (source[at] !== '[') return -1
    let k = at + 1
    while (source[k] === '=') k++
    return source[k] === '[' ? k - at - 1 : -1
  }
  const skipLong = (at, level) => {
    const close = ']' + '='.repeat(level) + ']'
    const end = source.indexOf(close, at)
    return end === -1 ? n : end + close.length
  }

  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    // Comments
    if (c === '-' && next === '-') {
      const level = longBracketLevel(i + 2)
      if (level >= 0) i = skipLong(i + 2, level)
      else {
        const nl = source.indexOf('\n', i)
        i = nl === -1 ? n : nl
      }
      continue
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      set(i, blank(source.slice(i, stop)))
      mark('ccomment', i, stop)
      i = stop
      continue
    }

    // Strings
    if (c === '"' || c === "'") {
      let k = i + 1
      while (k < n && source[k] !== c && source[k] !== '\n') k += source[k] === '\\' ? 2 : 1
      i = k + 1
      lastSignificant = c
      lastWord = ''
      continue
    }
    if (c === '[') {
      const level = longBracketLevel(i)
      if (level >= 0) {
        i = skipLong(i, level)
        lastSignificant = ']'
        lastWord = ''
        continue
      }
    }
    if (c === '`') {
      const end = source.indexOf('`', i + 1)
      if (end !== -1 && !source.slice(i + 1, end).includes('\n')) {
        set(i, '"')
        set(end, '"')
        mark('hash', i, end + 1, { name: source.slice(i + 1, end) })
        i = end + 1
        lastSignificant = '"'
        lastWord = ''
        continue
      }
    }

    // Words
    if (isIdentStart(c)) {
      let k = i
      while (k < n && isIdent(source[k])) k++
      const word = source.slice(i, k)
      // `defer` is NOT rewritten: FiveM builds without GRIT_POWER_DEFER
      // (es_extended calls `deferrals.defer()`, ox_lib defines `defer()`).
      if (word === 'local') {
        localNames = true
        expectingName = true
      } else if (localNames) {
        if (expectingName && word !== 'function') {
          expectingName = false // a name of the list
        } else if (!expectingName && word === 'in') {
          set(i, '= ')
          mark('in_unpack', i, k)
          localNames = false
        } else {
          localNames = false // `local function`, or the list ended without `=`
        }
      }
      // Set constructor: `{ .a, .b }` field
      lastWord = word
      lastSignificant = word[word.length - 1]
      i = k
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }

    // Lua 5.4 attributes: local x <const> / <close>
    if (c === '<' && localNames) {
      const m = /^<\s*(const|close)\s*>/.exec(source.slice(i))
      if (m) {
        set(i, blank(m[0]))
        mark('attrib', i, i + m[0].length, { attrib: m[1] })
        i += m[0].length
        continue
      }
    }

    // Numbers: skip so `.5` or `1.` are not taken for set fields
    if (/[0-9]/.test(c)) {
      let k = i
      while (k < n && /[0-9A-Fa-fxXpP._]/.test(source[k])) {
        if ((source[k] === 'e' || source[k] === 'E' || source[k] === 'p' || source[k] === 'P') && /[+-]/.test(source[k + 1])) k++
        k++
      }
      i = k
      lastSignificant = '0'
      lastWord = ''
      continue
    }

    // Safe navigation
    if (c === '?') {
      if (next === '.' && source[i + 2] === '(') {
        set(i, '  ')
        mark('safenav_call', i, i + 2)
        i += 2
      } else if (next === '.' && source[i + 2] === '[') {
        set(i, '  ')
        mark('safenav_index', i, i + 2)
        i += 2
      } else if (next === '.' || next === '[') {
        set(i, ' ')
        mark(next === '.' ? 'safenav_field' : 'safenav_index', i, i + 1)
        i += 1
      } else i++
      continue
    }

    // Compound assignment: longest operators first
    const compound = ['<<=', '>>=', '//=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].find((op) => source.startsWith(op, i))
    if (compound && !(compound === '/=' && source[i - 1] === '/')) {
      set(i, ' '.repeat(compound.length - 1) + '=')
      mark('compound', i, i + compound.length, { op: compound.slice(0, -1) })
      i += compound.length
      localNames = false
      lastSignificant = '='
      lastWord = ''
      continue
    }

    if (c === '{') braces.push(i)
    if (c === '}') braces.pop()

    // Set constructor field `.name` right after `{`, `,` or `;`
    if (c === '.' && next !== '.' && isIdentStart(next ?? '') && braces.length && ['{', ',', ';'].includes(lastSignificant)) {
      set(i, ' ')
      let k = i + 1
      while (k < n && isIdent(source[k])) k++
      mark('set_field', i, k, { name: source.slice(i + 1, k) })
      i = k
      lastSignificant = 'a'
      lastWord = ''
      continue
    }

    if (c === ',' && localNames) expectingName = true
    else if (localNames) localNames = false
    lastSignificant = c
    lastWord = ''
    i++
  }

  return { code: out.join(''), marks }
}
