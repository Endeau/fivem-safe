import { parse as luaparse } from '../../vendor/luaparse/luaparse.cjs'
import { rewrite, type Mark } from './rewrite.ts'

/**
 * A luaparse AST node. luaparse ships no types; the analyzer reads the fields
 * it needs (see the luaparse README for the node shapes).
 */
export interface LuaNode {
  type: string
  range: [number, number]
  loc: { start: { line: number; column: number }; end: { line: number; column: number } }
  // luaparse nodes are heterogeneous: fields are read by node type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [field: string]: any
}

export interface ParsedFile {
  source: string
  ast: LuaNode
  marks: Mark[]
}

export class LuaSyntaxError extends Error {
  line: number
  column: number
  constructor(message: string, line: number, column: number) {
    super(message)
    this.line = line
    this.column = column
  }
}

export function parseLua(source: string): ParsedFile {
  // Strip a UTF-8 BOM with a space, so offsets stay the same.
  const withoutBom = source.charCodeAt(0) === 0xfeff ? ' ' + source.slice(1) : source
  const { code, marks } = rewrite(withoutBom)
  try {
    const ast = luaparse(code, {
      locations: true,
      ranges: true,
      comments: false,
      scope: false,
      luaVersion: '5.3',
    }) as LuaNode
    return { source, ast, marks }
  } catch (error) {
    const e = error as { message?: string; line?: number; column?: number }
    throw new LuaSyntaxError(e.message ?? String(error), e.line ?? 0, e.column ?? 0)
  }
}

/** The mark of `kind` that lies between two offsets, if any. */
export function markBetween(marks: Mark[], kind: Mark['kind'], from: number, to: number): Mark | undefined {
  return marks.find((m) => m.kind === kind && m.start >= from && m.end <= to)
}
