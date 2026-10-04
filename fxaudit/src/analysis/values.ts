// What the analyzer knows about a value while it walks a function.

export type OriginKind = 'client' | 'http'

/** Where tainted data comes from: a handler parameter or an HTTP response. */
export interface Origin {
  kind: OriginKind
  /** Parameter name as written in the handler, e.g. `amount` or `...`. */
  param: string
  /** True once the data went through a helper, a loop or an unpacking. */
  indirect: boolean
}

export interface Value {
  origins: Origin[]
  /** A tainted number checked against an upper limit. */
  upper: boolean
  /**
   * The checks exclude NaN. `if x > 500 then return end` does not: NaN fails
   * every comparison, so it goes through. `x ~= x` or a positive range test does.
   */
  nanSafe?: boolean
  /** A tainted value checked against a fixed list or equal to a known value. */
  exact: boolean
  /** Converted to a number: cannot carry SQL or code any more. */
  numeric?: boolean
  /** A player object obtained from an id the client chose. */
  target?: Origin
  /** Result of a method call on a server object with client data, e.g. xPlayer.getInventoryItem(name). */
  lookup?: boolean
  /** Parameters this server value was computed from, e.g. the coords of a target. */
  related?: string[]
  /** Name of a local function, when the value is one. */
  fn?: string
}

export const CLEAN: Value = Object.freeze({ origins: [], upper: false, exact: false }) as Value

export const isTainted = (v: Value): boolean => v.origins.length > 0

export function tainted(origin: Origin): Value {
  return { origins: [origin], upper: false, exact: false }
}

export function indirect(v: Value): Value {
  if (!isTainted(v)) return v
  return { ...v, origins: v.origins.map((o) => ({ ...o, indirect: true })) }
}

function uniqueOrigins(origins: Origin[]): Origin[] {
  const seen = new Set<string>()
  return origins.filter((o) => {
    const key = `${o.kind}|${o.param}|${o.indirect}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Data derived from several values: tainted if any is, checked only if all tainted ones are. */
export function combine(values: Value[]): Value {
  const taintedValues = values.filter(isTainted)
  if (taintedValues.length === 0) {
    const target = values.find((v) => v.target)?.target
    const related = relatedOf(values)
    if (!target && !related) return CLEAN
    return { ...CLEAN, ...(target ? { target } : {}), ...(related ? { related } : {}) }
  }
  return {
    origins: uniqueOrigins(taintedValues.flatMap((v) => v.origins)),
    upper: taintedValues.every((v) => v.upper || v.exact),
    exact: taintedValues.every((v) => v.exact),
    nanSafe: taintedValues.every(nanFree),
    numeric: taintedValues.every((v) => v.numeric === true),
  }
}

/** A value that can come from two branches. */
export function merge(a: Value, b: Value): Value {
  if (!isTainted(a) && !isTainted(b)) return a.target ? a : b
  if (!isTainted(a)) return b
  if (!isTainted(b)) return a
  return {
    origins: uniqueOrigins([...a.origins, ...b.origins]),
    upper: a.upper && b.upper,
    exact: a.exact && b.exact,
    nanSafe: nanFree(a) && nanFree(b),
    numeric: a.numeric === true && b.numeric === true,
    target: a.target ?? b.target,
  }
}

/** A value that cannot be NaN: checked against a fixed list, or with a NaN-proof test. */
export function nanFree(v: Value): boolean {
  return v.exact || v.nanSafe === true
}

/** Parameters behind `values`, tainted or not, or undefined when there are none. */
export function relatedOf(values: Value[]): string[] | undefined {
  const params = new Set<string>()
  for (const v of values) {
    for (const o of v.origins) params.add(o.param)
    if (v.target) params.add(v.target.param)
    for (const p of v.related ?? []) params.add(p)
  }
  return params.size ? [...params] : undefined
}

export function describeOrigins(v: Value): string {
  const names = uniqueOrigins(v.origins).map((o) => (o.kind === 'http' ? 'réponse HTTP' : o.param))
  return [...new Set(names)].join(', ')
}
