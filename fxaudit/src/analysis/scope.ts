import type { Value } from './values.ts'

/**
 * Variables visible at one point of a function. Keys are names (`amount`) or
 * field paths (`data.amount`).
 *
 * A branch scope (if clause, loop body) never writes through to its parents:
 * it keeps the new value as a local shadow and lists the key in `assigned`,
 * and the walker merges the branches once the statement is done, since a
 * branch may not run.
 */
export class Scope {
  parent: Scope | null
  branch: boolean
  /** `null` marks a field path made stale by a reassignment of its base. */
  vars = new Map<string, Value | null>()
  declared = new Set<string>()
  assigned = new Set<string>()

  constructor(parent: Scope | null, branch = false) {
    this.parent = parent
    this.branch = branch
  }

  lookup(key: string): Value | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      if (s.vars.has(key)) return s.vars.get(key) ?? undefined
    }
    return undefined
  }

  declare(key: string, value: Value): void {
    this.vars.set(key, value)
    this.declared.add(key)
    this.staleFields(key)
  }

  /** What a check proved about `key` in this scope. Not a declaration: assignments still merge. */
  refine(key: string, value: Value): void {
    this.vars.set(key, value)
  }

  assign(key: string, value: Value): void {
    if (this.vars.has(key) || this.branch || !this.parent) {
      this.vars.set(key, value)
      if (this.branch && !this.declared.has(key)) this.assigned.add(key)
      this.staleFields(key)
      return
    }
    this.parent.assign(key, value)
  }

  root(): Scope {
    let s: Scope = this
    while (s.parent) s = s.parent
    return s
  }

  /** `data = x` makes what was known about `data.amount` stale. */
  private staleFields(key: string): void {
    const prefix = key + '.'
    for (let s: Scope | null = this; s; s = s.parent) {
      for (const k of s.vars.keys()) {
        if (k.startsWith(prefix)) this.vars.set(k, null)
      }
    }
  }
}
