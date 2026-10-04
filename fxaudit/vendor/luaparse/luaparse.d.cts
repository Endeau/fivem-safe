export interface ParseOptions {
  wait?: boolean
  comments?: boolean
  scope?: boolean
  locations?: boolean
  ranges?: boolean
  luaVersion?: '5.1' | '5.2' | '5.3' | 'LuaJIT'
  encodingMode?: 'none' | 'pseudo-latin1' | 'x-user-defined'
}
export function parse(code: string, options?: ParseOptions): unknown
