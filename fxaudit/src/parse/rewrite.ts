// Position-preserving rewrite of CfxLua (and Lua 5.4 attributes) into Lua 5.3
// that luaparse understands. Every replacement has the same length as the
// original text and newlines are never touched, so the line, column and range
// of every AST node still point at the original source. Each rewrite is
// recorded in `marks` so the analyzer can restore the real meaning.
//
// Extensions: github.com/citizenfx/lua (branch luaglm-dev/cfx), "Power Patches".
// `defer` is NOT rewritten: FiveM builds without it (es_extended calls
// `deferrals.defer()`, ox_lib defines a `defer()` function).

export type MarkKind =
  | 'ccomment'
  | 'hash'
  | 'in_unpack'
  | 'attrib'
  | 'safenav_field'
  | 'safenav_index'
  | 'safenav_call'
  | 'compound'
  | 'set_field'

export interface Mark {
  kind: MarkKind
  start: number
  end: number
  /** Compound operator without `=`, e.g. `+` for `+=`. */
  op?: string
  /** Hash text or set-constructor field name. */
  name?: string
  attrib?: 'const' | 'close'
}

export interface Rewritten {
  code: string
  marks: Mark[]
}

const COMPOUND_OPS = ['<<=', '>>=', '//=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=']

const isIdentStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c)
const isIdent = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c)
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'
const blank = (s: string): string => s.replace(/[^\n]/g, ' ')

export function rewrite(source: string): Rewritten {
  const out = source.split('')
  const marks: Mark[] = []
  const n = source.length
  let i = 0
  let braceDepth = 0
  // Last significant character outside strings and comments: tells whether a
  // `.name` right after `{`, `,` or `;` is a set-constructor field.
  let lastSignificant = ''
  // Inside `local a, b` before `=` or `in`.
  let localNames = false
  let expectingName = false

  const set = (from: number, text: string): void => {
    for (let k = 0; k < text.length; k++) out[from + k] = text[k] as string
  }
  const mark = (m: Mark): void => {
    marks.push(m)
  }

  // Level of a long bracket `[`, `=`*, `[` starting at `at`, or -1.
  const longBracketLevel = (at: number): number => {
    if (source[at] !== '[') return -1
    let k = at + 1
    while (source[k] === '=') k++
    return source[k] === '[' ? k - at - 1 : -1
  }
  const skipLong = (at: number, level: number): number => {
    const close = ']' + '='.repeat(level) + ']'
    const end = source.indexOf(close, at)
    return end === -1 ? n : end + close.length
  }
  // End (exclusive) of a short string opened by `quote` at `at`.
  const skipShortString = (at: number, quote: string): number => {
    let k = at + 1
    while (k < n) {
      const c = source[k]
      if (c === quote) return k + 1
      if (c === '\n') return k // unfinished string: let the parser report it
      k += c === '\\' ? 2 : 1
    }
    return n
  }

  while (i < n) {
    const c = source[i] as string
    const next = source[i + 1]

    // Comments: `--[[ ]]`, `--[==[ ]==]`, `-- line`, and C comments `/* */`.
    if (c === '-' && next === '-') {
      const level = longBracketLevel(i + 2)
      if (level >= 0) {
        i = skipLong(i + 2, level)
      } else {
        const nl = source.indexOf('\n', i)
        i = nl === -1 ? n : nl
      }
      continue
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      set(i, blank(source.slice(i, stop)))
      mark({ kind: 'ccomment', start: i, end: stop })
      i = stop
      continue
    }

    // Strings.
    if (c === '"' || c === "'") {
      i = skipShortString(i, c)
      lastSignificant = c
      continue
    }
    if (c === '[') {
      const level = longBracketLevel(i)
      if (level >= 0) {
        i = skipLong(i, level)
        lastSignificant = ']'
        continue
      }
    }

    // Compile-time hash: `WEAPON_PISTOL` becomes "WEAPON_PISTOL".
    if (c === '`') {
      const end = source.indexOf('`', i + 1)
      if (end !== -1 && !source.slice(i + 1, end).includes('\n')) {
        set(i, '"')
        set(end, '"')
        mark({ kind: 'hash', start: i, end: end + 1, name: source.slice(i + 1, end) })
        i = end + 1
        lastSignificant = '"'
        continue
      }
    }

    // Names and keywords.
    if (isIdentStart(c)) {
      let k = i
      while (k < n && isIdent(source[k])) k++
      const word = source.slice(i, k)
      if (word === 'local') {
        localNames = true
        expectingName = true
      } else if (localNames) {
        if (expectingName && word !== 'function') {
          expectingName = false
        } else if (!expectingName && word === 'in') {
          // `local a, b in t` becomes `local a, b = t`.
          set(i, '= ')
          mark({ kind: 'in_unpack', start: i, end: k })
          localNames = false
        } else {
          localNames = false
        }
      }
      lastSignificant = 'a'
      i = k
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }

    // Lua 5.4 attributes: `local x <const>`, `local f <close>`.
    if (c === '<' && localNames && !expectingName) {
      const m = /^<\s*(const|close)\s*>/.exec(source.slice(i, i + 32))
      if (m) {
        set(i, blank(m[0]))
        mark({ kind: 'attrib', start: i, end: i + m[0].length, attrib: m[1] as 'const' | 'close' })
        i += m[0].length
        continue
      }
    }

    // Numbers, so `.5` or `1e-3` are never taken for fields or operators.
    if (isDigit(c) || (c === '.' && isDigit(next))) {
      let k = i
      const hex = c === '0' && (next === 'x' || next === 'X')
      if (hex) k += 2
      while (k < n) {
        const d = source[k] as string
        const exponent = hex ? d === 'p' || d === 'P' : d === 'e' || d === 'E'
        if (exponent && (source[k + 1] === '+' || source[k + 1] === '-')) {
          k += 2
        } else if (/[0-9A-Fa-f.xX]/.test(d) || exponent) {
          k++
        } else {
          break
        }
      }
      i = k
      lastSignificant = '0'
      if (localNames) localNames = false
      continue
    }

    // Safe navigation: `a?.b`, `a?[k]`, `a?.[k]`, `f?.()`.
    if (c === '?') {
      if (next === '.' && source[i + 2] === '(') {
        set(i, '  ')
        mark({ kind: 'safenav_call', start: i, end: i + 2 })
        i += 2
      } else if (next === '.' && source[i + 2] === '[') {
        set(i, '  ')
        mark({ kind: 'safenav_index', start: i, end: i + 2 })
        i += 2
      } else if (next === '.' || next === '[') {
        set(i, ' ')
        mark({ kind: next === '.' ? 'safenav_field' : 'safenav_index', start: i, end: i + 1 })
        i += 1
      } else {
        i++
      }
      lastSignificant = '.'
      continue
    }

    // Compound assignment, longest operators first. `a //= b` must not be
    // read as a line comment, and `x ~= y` or `x == y` are comparisons.
    const compound = COMPOUND_OPS.find((op) => source.startsWith(op, i))
    if (compound && !(compound === '/=' && source[i - 1] === '/')) {
      set(i, ' '.repeat(compound.length - 1) + '=')
      mark({ kind: 'compound', start: i, end: i + compound.length, op: compound.slice(0, -1) })
      i += compound.length
      localNames = false
      lastSignificant = '='
      continue
    }

    if (c === '{') braceDepth++
    if (c === '}') braceDepth = Math.max(0, braceDepth - 1)

    // Set-constructor field: `{ .police, .sheriff }` means `{ police = true, ... }`.
    if (
      c === '.' &&
      next !== '.' &&
      isIdentStart(next) &&
      braceDepth > 0 &&
      (lastSignificant === '{' || lastSignificant === ',' || lastSignificant === ';')
    ) {
      set(i, ' ')
      let k = i + 1
      while (k < n && isIdent(source[k])) k++
      mark({ kind: 'set_field', start: i, end: k, name: source.slice(i + 1, k) })
      i = k
      lastSignificant = 'a'
      continue
    }

    if (c === ',' && localNames) expectingName = true
    else if (localNames) localNames = false
    lastSignificant = c
    i++
  }

  return { code: out.join(''), marks }
}
