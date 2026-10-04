// Walks one Lua file. Parameters of server handlers (net events, callbacks)
// and HTTP responses are tainted; the walker follows them through locals,
// table fields and local helpers, drops them when they are checked, and
// reports the ones that reach a sensitive call.

import { markBetween, type LuaNode, type ParsedFile } from '../parse/parse.ts'
import type { Mark } from '../parse/rewrite.ts'
import { RULES, type Confidence, type Finding, type RuleId } from '../rules/rules.ts'
import { Scope } from './scope.ts'
import {
  CLEAN,
  combine,
  describeOrigins,
  indirect,
  isTainted,
  merge,
  nanFree,
  relatedOf,
  tainted,
  type Origin,
  type Value,
} from './values.ts'

// ---------------------------------------------------------------------------
// Vocabulary

/** Money methods of an ESX player (and QBCore Functions), with the index of the amount. */
const MONEY_METHODS: Record<string, number> = {
  addMoney: 0,
  setMoney: 0,
  addAccountMoney: 1,
  setAccountMoney: 1,
}
const QB_MONEY_METHODS: Record<string, number> = { AddMoney: 1, SetMoney: 1 }
/** Item methods: index of the item name, index of the count. */
const ITEM_METHODS: Record<string, [number, number]> = {
  addInventoryItem: [0, 1],
  addWeapon: [0, 1],
}
const MONEY_ITEMS = new Set(['money', 'black_money', 'cash', 'bank'])

const SQL_CALL =
  /^(MySQL(\.(Async|Sync))?\.(query|execute|insert|update|scalar|single|prepare|rawExecute|fetchAll|fetchScalar|fetchSingle|transaction)(\.await)?|exports\.(oxmysql|ghmattimysql|mysql-async)[.:]\w+)$/

const YIELDING_CALLS = new Set([
  'Wait',
  'Citizen.Wait',
  'Citizen.Await',
  'lib.callback.await',
  'lib.waitFor',
  'PerformHttpRequestAwait',
])
const isYielding = (path: string): boolean =>
  YIELDING_CALLS.has(path) ||
  path.endsWith('.await') ||
  path.startsWith('MySQL.Sync.') ||
  /^exports\.oxmysql[.:]\w+_async$/.test(path)

/** Calls that run their function argument right away. Any other function argument runs later. */
const SYNC_CALLBACK_CALLS = new Set(['pcall', 'xpcall', 'table.sort', 'string.gsub'])

const PASS_THROUGH_CALLS = new Set([
  'tonumber',
  'tostring',
  'math.floor',
  'math.ceil',
  'math.abs',
  'math.tointeger',
  'math.round',
  'ESX.Math.Round',
  'ESX.Math.Trim',
  'string.lower',
  'string.upper',
  'string.sub',
  'string.format',
  'string.rep',
  'string.gsub',
])
const NUMERIC_CALLS = new Set([
  'tonumber',
  'math.floor',
  'math.ceil',
  'math.abs',
  'math.tointeger',
  'math.round',
  'ESX.Math.Round',
])
/** String methods whose result carries the receiver and the arguments: ('%s'):format(x). */
const STRING_METHODS = new Set(['format', 'gsub', 'sub', 'lower', 'upper', 'rep', 'reverse'])
const UNPACKING_CALLS = new Set([
  'json.decode',
  'msgpack.unpack',
  'table.unpack',
  'unpack',
  'select',
  'table.concat',
  'pairs',
  'ipairs',
  'next',
])
const CLAMP_CALLS = new Set(['math.clamp', 'lib.math.clamp'])
const PLAYER_LOOKUPS = new Set([
  'ESX.GetPlayerFromId',
  'ESX.GetPlayerFromIdentifier',
  'ESX.Player',
  'QBCore.Functions.GetPlayer',
  'exports.qbx_core:GetPlayer',
])
const CONTAINS_CALLS = /(^|\.)(contains|includes|Contains|HasValue)$/
const AUTH_CALLS = new Set(['getJob', 'getGroup', 'IsPlayerAceAllowed', 'hasGroup', 'HasPermission', 'hasPermission'])
const AUTH_FIELDS = new Set(['job', 'group', 'job2', 'gang', 'permission'])
const COMPARISON_OPS = new Set(['<', '<=', '>', '>=', '==', '~='])
const NAN_MESSAGE =
  "La borne est vérifiée, mais NaN (0/0 envoyé par un client modifié) passe le contrôle : toute comparaison avec NaN est fausse"
const NAN_FIX =
  "Refuser NaN avant de comparer (if amount ~= amount then return end), écrire le test à l'endroit (if amount >= 1 and amount <= 500 then ... end) " +
  'ou utiliser safe_events, qui refuse NaN et l\'infini.'

// ---------------------------------------------------------------------------
// Walk state

interface FnState {
  yielded: string | null
  sourceReported: boolean
  returns: Value[]
}

interface PendingTarget {
  node: LuaNode
  origin: Origin
  action: string
}

interface HandlerCtx {
  event: string
  /** Tainted parameters used in a condition: the handler checked something about them. */
  conditionParams: Set<string>
  authSeen: boolean
  pendingTargets: PendingTarget[]
}

interface Ctx {
  scope: Scope
  fn: FnState
  handler: HandlerCtx | null
  depth: number
}

interface Refinement {
  key: string
  upper: boolean
  exact: boolean
  /** The test also rules out NaN (a comparison that held, `x == x`, a list). */
  nanSafe?: boolean
}

const MAX_INLINE_DEPTH = 3

// ---------------------------------------------------------------------------
// Small AST helpers

function callArgs(node: LuaNode): LuaNode[] {
  if (node.type === 'StringCallExpression') return [node.argument]
  if (node.type === 'TableCallExpression') return [node.arguments]
  return node.arguments ?? []
}

function isCall(node: LuaNode | undefined): boolean {
  return (
    !!node &&
    (node.type === 'CallExpression' || node.type === 'StringCallExpression' || node.type === 'TableCallExpression')
  )
}

function isFunction(node: LuaNode | undefined): boolean {
  return !!node && node.type === 'FunctionDeclaration'
}

/** Short string literal content, or undefined. */
function stringValue(node: LuaNode | undefined, source: string): string | undefined {
  if (!node || node.type !== 'StringLiteral') return undefined
  const raw: string = node.raw ?? source.slice(node.range[0], node.range[1])
  const quote = raw[0]
  if (quote === '"' || quote === "'") return raw.slice(1, -1)
  const long = /^\[=*\[\n?([\s\S]*)\]=*\]$/.exec(raw)
  return long?.[1]
}

/** Dotted path of an expression: `ESX.GetPlayerFromId`, `exports.ox_inventory:AddItem`. */
function pathOf(node: LuaNode | undefined, source: string): string {
  if (!node) return '?'
  switch (node.type) {
    case 'Identifier':
      return node.name
    case 'MemberExpression':
      return `${pathOf(node.base, source)}${node.indexer}${node.identifier.name}`
    case 'IndexExpression': {
      const key = stringValue(node.index, source)
      return key !== undefined && /^[\w-]+$/.test(key) ? `${pathOf(node.base, source)}.${key}` : '?'
    }
    default:
      return '?'
  }
}

/** Last name of a call path: `addMoney` for `xPlayer.addMoney`. */
const lastName = (path: string): string => path.split(/[.:]/).pop() ?? path

// ---------------------------------------------------------------------------

export interface AnalyzeOptions {
  file: string
}

export interface FileReport {
  findings: Finding[]
  /** Net events, callbacks and HTTP callbacks walked with tainted parameters. */
  handlers: number
}

export function analyze(parsed: ParsedFile, options: AnalyzeOptions): Finding[] {
  return analyzeFile(parsed, options).findings
}

export function analyzeFile(parsed: ParsedFile, options: AnalyzeOptions): FileReport {
  const analyzer = new FileAnalyzer(parsed, options.file)
  const findings = analyzer.run()
  return { findings, handlers: analyzer.handlers }
}

class FileAnalyzer {
  parsed: ParsedFile
  file: string
  source: string
  marks: Mark[]
  findings: Finding[] = []
  reported = new Set<string>()
  ignores: Map<number, Set<string> | 'all'>
  localFunctions = new Map<string, LuaNode>()
  netEvents = new Set<string>()
  inlining = new Set<LuaNode>()
  handlers = 0

  constructor(parsed: ParsedFile, file: string) {
    this.parsed = parsed
    this.file = file
    this.source = parsed.source
    this.marks = parsed.marks
    this.ignores = readIgnores(parsed.source)
  }

  run(): Finding[] {
    this.collect(this.parsed.ast)
    const root = new Scope(null)
    const ctx: Ctx = { scope: root, fn: newFn(null), handler: null, depth: 0 }
    this.walkBlock(this.parsed.ast.body, ctx)
    return this.findings.sort((a, b) => a.line - b.line || a.column - b.column)
  }

  // --- pre-pass --------------------------------------------------------------

  /** Local helper functions and events registered as net events without a handler. */
  collect(node: LuaNode): void {
    visit(node, (n) => {
      if (n.type === 'FunctionDeclaration' && n.identifier?.type === 'Identifier') {
        this.localFunctions.set(n.identifier.name, n)
      }
      if (n.type === 'LocalStatement' || n.type === 'AssignmentStatement') {
        n.variables.forEach((v: LuaNode, i: number) => {
          const init = n.init[i]
          if (v.type === 'Identifier' && isFunction(init)) this.localFunctions.set(v.name, init)
        })
      }
      if (isCall(n)) {
        const path = pathOf(n.base, this.source)
        const args = callArgs(n)
        if ((path === 'RegisterNetEvent' || path === 'RegisterServerEvent') && args[0]) {
          this.netEvents.add(this.eventName(args[0]))
        }
      }
    })
  }

  /** Event name: the string content, or the expression text when it is built. */
  eventName(node: LuaNode): string {
    return stringValue(node, this.source) ?? this.text(node)
  }

  text(node: LuaNode): string {
    return this.source.slice(node.range[0], node.range[1]).replace(/\s+/g, ' ')
  }

  // --- reporting -------------------------------------------------------------

  report(rule: RuleId, node: LuaNode, message: string, confidence: Confidence, event?: string, fix?: string): void {
    const line = node.loc.start.line
    const column = node.loc.start.column + 1
    const key = `${rule}:${line}:${column}`
    if (this.reported.has(key)) return
    this.reported.add(key)
    for (const l of [line, line - 1]) {
      const ignored = this.ignores.get(l)
      if (ignored === 'all' || ignored?.has(rule)) return
    }
    const meta = RULES[rule]
    this.findings.push({
      rule,
      severity: meta.severity,
      confidence,
      file: this.file,
      line,
      column,
      message,
      fix: fix ?? meta.fix,
      ...(event !== undefined ? { event } : {}),
    })
  }

  confidenceOf(v: Value): Confidence {
    return v.origins.some((o) => !o.indirect) ? 'high' : 'medium'
  }

  // --- statements ------------------------------------------------------------

  walkBlock(body: LuaNode[], ctx: Ctx): void {
    for (const statement of body) this.walkStatement(statement, ctx)
  }

  walkStatement(node: LuaNode, ctx: Ctx): void {
    switch (node.type) {
      case 'LocalStatement':
        return this.walkLocal(node, ctx)
      case 'AssignmentStatement':
        return this.walkAssignment(node, ctx)
      case 'CallStatement':
        this.evalExpr(node.expression, ctx)
        return
      case 'IfStatement':
        return this.walkIf(node, ctx)
      case 'WhileStatement':
        this.evalCondition(node.condition, ctx)
        return this.walkLoopBody(node.body, ctx, this.refinements(node.condition, true, ctx))
      case 'RepeatStatement':
        this.walkLoopBody(node.body, ctx, [])
        this.evalCondition(node.condition, ctx)
        return
      case 'DoStatement': {
        const inner = { ...ctx, scope: new Scope(ctx.scope) }
        return this.walkBlock(node.body, inner)
      }
      case 'ForNumericStatement': {
        const bounds = combine([node.start, node.end, node.step].filter(Boolean).map((e) => this.evalExpr(e, ctx)))
        const loop = new Scope(ctx.scope, true)
        loop.declare(node.variable.name, indirect({ ...bounds, upper: false, exact: false }))
        return this.walkLoopScope(node.body, ctx, loop)
      }
      case 'ForGenericStatement': {
        const iterated = indirect(combine(node.iterators.map((e: LuaNode) => this.evalExpr(e, ctx))))
        const loop = new Scope(ctx.scope, true)
        for (const v of node.variables) loop.declare(v.name, { ...iterated, upper: false, exact: false })
        return this.walkLoopScope(node.body, ctx, loop)
      }
      case 'FunctionDeclaration': {
        // `local function f` or `function M.f`: defined now, run later or through inlining.
        if (node.identifier?.type === 'Identifier' && node.isLocal) {
          ctx.scope.declare(node.identifier.name, { ...CLEAN, fn: node.identifier.name })
        }
        this.walkNestedFunction(node, ctx, 'define')
        return
      }
      case 'ReturnStatement': {
        const values = node.arguments.map((e: LuaNode) => this.evalExpr(e, ctx))
        ctx.fn.returns.push(combine(values))
        return
      }
      default:
        return
    }
  }

  walkLocal(node: LuaNode, ctx: Ctx): void {
    const values = node.init.map((e: LuaNode) => this.evalExpr(e, ctx))
    const unpack = node.init.length === 1 && markBetween(this.marks, 'in_unpack', node.range[0], node.init[0].range[0])
    node.variables.forEach((v: LuaNode, i: number) => {
      let value: Value
      if (unpack) {
        value = indirect({ ...(values[0] as Value), upper: false, exact: false })
      } else if (i < values.length) {
        value = values[i] as Value
      } else {
        // Extra names take the extra results of a trailing call or `...`.
        const last = node.init[node.init.length - 1]
        value = last && (isCall(last) || last.type === 'VarargLiteral') ? (values[values.length - 1] as Value) : CLEAN
      }
      ctx.scope.declare(v.name, value)
    })
  }

  walkAssignment(node: LuaNode, ctx: Ctx): void {
    const values: Value[] = node.init.map((e: LuaNode) => this.evalExpr(e, ctx))
    const first = node.variables[0]
    const compound =
      first && node.init[0] && markBetween(this.marks, 'compound', first.range[1], node.init[0].range[0])
    node.variables.forEach((target: LuaNode, i: number) => {
      let value = values[i] ?? CLEAN
      if (compound) {
        // `total += amount` was rewritten as `total = amount`.
        value = combine([this.evalExpr(target, ctx), value])
      }
      const key = this.keyOf(target)
      if (key) ctx.scope.assign(key, value)
      else if (target.type === 'IndexExpression' || target.type === 'MemberExpression') this.evalExpr(target.base, ctx)
    })
  }

  walkIf(node: LuaNode, ctx: Ctx): void {
    const branchScopes: Scope[] = []
    const fallthroughRefs: Refinement[] = []
    const afterRefs: Refinement[] = []
    let hasElse = false

    for (const clause of node.clauses) {
      const scope = new Scope(ctx.scope, true)
      if (clause.condition) {
        this.evalCondition(clause.condition, ctx)
        this.applyRefinements(this.refinements(clause.condition, true, ctx), scope, ctx)
      } else {
        hasElse = true
      }
      this.walkBlock(clause.body, { ...ctx, scope })
      const negative = clause.condition ? this.refinements(clause.condition, false, ctx) : []
      fallthroughRefs.push(...negative)
      if (exits(clause.body)) {
        afterRefs.push(...negative)
      } else {
        branchScopes.push(scope)
      }
    }

    // Values assigned in the branches: merge every path that reaches the next statement.
    const keys = new Set(branchScopes.flatMap((s) => [...s.assigned]))
    for (const key of keys) {
      const before = ctx.scope.lookup(key) ?? CLEAN
      const paths = branchScopes.map((s) => (s.assigned.has(key) ? (s.vars.get(key) ?? CLEAN) : before))
      if (!hasElse) paths.push(refine(before, key, fallthroughRefs))
      ctx.scope.assign(key, paths.reduce(merge))
    }
    this.applyRefinements(afterRefs, ctx.scope, ctx)
  }

  walkLoopBody(body: LuaNode[], ctx: Ctx, refs: Refinement[]): void {
    const loop = new Scope(ctx.scope, true)
    this.applyRefinements(refs, loop, ctx)
    this.walkLoopScope(body, ctx, loop)
  }

  walkLoopScope(body: LuaNode[], ctx: Ctx, loop: Scope): void {
    this.walkBlock(body, { ...ctx, scope: loop })
    for (const key of loop.assigned) {
      const before = ctx.scope.lookup(key) ?? CLEAN
      ctx.scope.assign(key, merge(before, loop.vars.get(key) ?? CLEAN))
    }
  }

  // --- functions -------------------------------------------------------------

  /**
   * A function defined inside the code being walked. `async` means it runs
   * later (a callback, a thread): `source` is no longer the caller by then.
   */
  walkNestedFunction(fnNode: LuaNode, ctx: Ctx, mode: 'define' | 'sync' | 'async'): void {
    const scope = new Scope(ctx.scope)
    for (const p of fnNode.parameters) scope.declare(p.type === 'VarargLiteral' ? '...' : p.name, CLEAN)
    const reason = mode === 'async' ? 'un rappel asynchrone' : ctx.fn.yielded
    const fn = newFn(reason)
    this.walkBlock(fnNode.body, { scope, fn, handler: ctx.handler, depth: ctx.depth })
  }

  /** Walks a handler with its client-controlled parameters tainted. */
  analyzeHandler(fnNode: LuaNode, ctx: Ctx, event: string, firstTainted: number, kind: 'client' | 'http'): void {
    const scope = new Scope(ctx.scope)
    fnNode.parameters.forEach((p: LuaNode, i: number) => {
      const name = p.type === 'VarargLiteral' ? '...' : p.name
      scope.declare(name, i >= firstTainted ? tainted({ kind, param: name, indirect: false }) : CLEAN)
    })
    const handler: HandlerCtx = {
      event,
      conditionParams: new Set(),
      authSeen: false,
      pendingTargets: [],
    }
    this.walkBlock(fnNode.body, { scope, fn: newFn(null), handler, depth: 0 })

    if (!handler.authSeen) {
      for (const pending of handler.pendingTargets) {
        if (handler.conditionParams.has(pending.origin.param)) continue
        this.report(
          'FX003',
          pending.node,
          `${RULES.FX003.title} : ${pending.origin.param} → ${pending.action}`,
          'medium',
          event,
        )
      }
    }
  }

  /** Calls a local helper with tainted arguments: walks its body with them. */
  inlineCall(fnNode: LuaNode, args: Value[], ctx: Ctx): Value {
    if (this.inlining.has(fnNode) || ctx.depth >= MAX_INLINE_DEPTH) return combine(args.map(indirect))
    this.inlining.add(fnNode)
    const scope = new Scope(ctx.scope.root())
    fnNode.parameters.forEach((p: LuaNode, i: number) => {
      if (p.type === 'VarargLiteral') scope.declare('...', indirect(combine(args.slice(i))))
      else scope.declare(p.name, indirect(args[i] ?? CLEAN))
    })
    const fn = newFn(ctx.fn.yielded)
    this.walkBlock(fnNode.body, { scope, fn, handler: ctx.handler, depth: ctx.depth + 1 })
    this.inlining.delete(fnNode)
    return fn.returns.length ? fn.returns.reduce(merge) : CLEAN
  }

  resolveFunction(node: LuaNode | undefined, ctx: Ctx): LuaNode | undefined {
    if (!node) return undefined
    if (isFunction(node)) return node
    if (node.type === 'Identifier') {
      const v = ctx.scope.lookup(node.name)
      if (v && !v.fn) return undefined
      return this.localFunctions.get(node.name)
    }
    return undefined
  }

  // --- expressions -----------------------------------------------------------

  /** Name or field path usable as a scope key: `amount`, `data.amount`. */
  keyOf(node: LuaNode | undefined): string | undefined {
    if (!node) return undefined
    if (node.type === 'Identifier') return node.name
    if (node.type === 'MemberExpression' && node.indexer === '.') {
      const base = this.keyOf(node.base)
      return base ? `${base}.${node.identifier.name}` : undefined
    }
    if (node.type === 'IndexExpression') {
      const field = stringValue(node.index, this.source)
      const base = this.keyOf(node.base)
      return base && field !== undefined ? `${base}.${field}` : undefined
    }
    return undefined
  }

  evalExpr(node: LuaNode | undefined, ctx: Ctx): Value {
    if (!node) return CLEAN
    switch (node.type) {
      case 'Identifier':
        return this.evalIdentifier(node, ctx)
      case 'VarargLiteral':
        return ctx.scope.lookup('...') ?? CLEAN
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
      case 'NilLiteral':
        return CLEAN
      case 'FunctionDeclaration':
        this.walkNestedFunction(node, ctx, 'define')
        return CLEAN
      case 'MemberExpression':
      case 'IndexExpression':
        return this.evalIndex(node, ctx)
      case 'CallExpression':
      case 'StringCallExpression':
      case 'TableCallExpression':
        return this.evalCall(node, ctx)
      case 'BinaryExpression': {
        const left = this.evalExpr(node.left, ctx)
        const right = this.evalExpr(node.right, ctx)
        if (COMPARISON_OPS.has(node.operator)) return CLEAN
        return combine([left, right])
      }
      case 'LogicalExpression':
        return merge(this.evalExpr(node.left, ctx), this.evalExpr(node.right, ctx))
      case 'UnaryExpression': {
        const v = this.evalExpr(node.argument, ctx)
        if (node.operator === 'not') return CLEAN
        return isTainted(v) ? { ...v, upper: false, exact: false } : CLEAN
      }
      case 'TableConstructorExpression': {
        const values = node.fields.map((f: LuaNode) => {
          if (f.type === 'TableKey') this.evalExpr(f.key, ctx)
          return this.evalExpr(f.value, ctx)
        })
        return { ...combine(values), upper: false, exact: false }
      }
      default:
        return CLEAN
    }
  }

  evalIdentifier(node: LuaNode, ctx: Ctx): Value {
    if (markBetween(this.marks, 'set_field', node.range[0] - 1, node.range[1])) return CLEAN
    const v = ctx.scope.lookup(node.name)
    if (v) return v
    if (node.name === 'source' && ctx.handler && ctx.fn.yielded && !ctx.fn.sourceReported) {
      ctx.fn.sourceReported = true
      this.report('FX007', node, `source lu après ${ctx.fn.yielded}`, 'high', ctx.handler.event)
    }
    return CLEAN
  }

  evalIndex(node: LuaNode, ctx: Ctx): Value {
    const key = this.keyOf(node)
    if (key) {
      const known = ctx.scope.lookup(key)
      if (known) return known
    }
    const base = this.evalExpr(node.base, ctx)
    const index = node.type === 'IndexExpression' ? this.evalExpr(node.index, ctx) : CLEAN
    if (base.target) return CLEAN // a field of a player object is server data
    if (!isTainted(base)) return CLEAN // a server table read with any key stays server data
    return { ...combine([base, index]), upper: false, exact: false }
  }

  evalCall(node: LuaNode, ctx: Ctx): Value {
    const path = pathOf(node.base, this.source).replace(/^_G\./, '')
    const name = lastName(path)
    const argNodes = callArgs(node)

    if (this.registersHandler(path, argNodes, ctx)) return CLEAN

    // Receiver of a method call, for actions on a target player.
    const receiver =
      node.base.type === 'MemberExpression' ? this.evalExpr(node.base.base, ctx) : this.evalExpr(node.base, ctx)

    const syncCallback = SYNC_CALLBACK_CALLS.has(path)
    const args = argNodes.map((arg) => {
      if (isFunction(arg)) {
        // A TriggerEvent callback runs synchronously inside the local event, and
        // source keeps the caller there (checked in game on esx_jobs).
        this.walkNestedFunction(arg, ctx, syncCallback || path === 'TriggerEvent' ? 'sync' : 'async')
        return CLEAN
      }
      return this.evalExpr(arg, ctx)
    })

    this.checkSinks(node, path, name, argNodes, args, receiver, ctx)
    if (isYielding(path)) ctx.fn.yielded = `${path}()`

    // Result of the call.
    if (PASS_THROUGH_CALLS.has(path)) {
      const v = combine(args.slice(0, path === 'string.format' ? undefined : 1))
      return isTainted(v) && NUMERIC_CALLS.has(path) ? { ...v, numeric: true } : v
    }
    if (node.base.type === 'MemberExpression' && node.base.indexer === ':' && STRING_METHODS.has(name)) {
      return combine([receiver, ...args]) // ('... %s'):format(name), text:lower()
    }
    if (path === 'math.min') {
      const v = combine(args)
      return isTainted(v) && args.some((a) => !isTainted(a) || a.upper) ? { ...v, upper: true } : v
    }
    if (path === 'math.max') return combine(args)
    if (CLAMP_CALLS.has(path)) {
      const v = combine(args)
      return isTainted(v) ? { ...v, upper: true } : v
    }
    if (UNPACKING_CALLS.has(path)) return indirect({ ...combine(args), upper: false, exact: false })
    if (path === 'PerformHttpRequestAwait') return tainted({ kind: 'http', param: path, indirect: false })
    if (PLAYER_LOOKUPS.has(path)) {
      const id = args[0] ?? CLEAN
      return isTainted(id) && !id.exact ? { ...CLEAN, target: id.origins[0] as Origin } : CLEAN
    }
    const fnNode = node.base.type === 'Identifier' ? this.resolveFunction(node.base, ctx) : undefined
    if (fnNode && args.some(isTainted)) return this.inlineCall(fnNode, args, ctx)
    // Any other call returns server data, still related to the parameters it was given.
    const related = relatedOf(args)
    if (!related) return CLEAN
    return { ...CLEAN, related, lookup: this.isLookupCall(node, path) }
  }

  /**
   * A method call on a server object that answers about a client value:
   * `xPlayer.getInventoryItem(name)`, `inventory.getItem(name)`. When it
   * succeeds, the value is known to the server. Player lookups do not count:
   * any connected id finds a player.
   */
  isLookupCall(node: LuaNode, path: string): boolean {
    return (
      node.base.type === 'MemberExpression' &&
      !PASS_THROUGH_CALLS.has(path) &&
      !UNPACKING_CALLS.has(path) &&
      !PLAYER_LOOKUPS.has(path) &&
      !STRING_METHODS.has(lastName(path)) &&
      !path.startsWith('math.') &&
      !path.startsWith('string.')
    )
  }

  /** Net events, callbacks and HTTP callbacks: walked with tainted parameters. */
  registersHandler(path: string, args: LuaNode[], ctx: Ctx): boolean {
    const eventText = args[0] ? this.eventName(args[0]) : '?'
    const handlerAt = (index: number): LuaNode | undefined => this.resolveFunction(args[index], ctx)

    if (path === 'SafeEvents.register' || path === 'SafeEvents.callback') {
      // Already validated by safe_events: only the event name is evaluated.
      return true
    }

    let fnNode: LuaNode | undefined
    let firstTainted = 0
    let kind: 'client' | 'http' = 'client'
    if (path === 'RegisterNetEvent' && args.length >= 2) {
      fnNode = handlerAt(1)
    } else if (path === 'AddEventHandler' && args[0] && this.netEvents.has(eventText)) {
      fnNode = handlerAt(1)
    } else if (path === 'ESX.RegisterServerCallback' || path === 'QBCore.Functions.CreateCallback') {
      fnNode = handlerAt(1)
      firstTainted = 2
    } else if (path === 'lib.callback.register') {
      fnNode = handlerAt(1)
      firstTainted = 1
    } else if (path === 'PerformHttpRequest' && isFunction(args[1])) {
      fnNode = args[1]
      kind = 'http'
    }
    if (!fnNode) return false
    this.handlers++

    args.forEach((arg, i) => {
      if (i !== 1) this.evalExpr(arg, ctx)
    })
    if (kind === 'http') {
      // The response body can reach code in any file, handler or not.
      const scope = new Scope(ctx.scope)
      fnNode.parameters.forEach((p: LuaNode) => {
        const name = p.type === 'VarargLiteral' ? '...' : p.name
        scope.declare(name, tainted({ kind: 'http', param: name, indirect: false }))
      })
      this.walkBlock(fnNode.body, { scope, fn: newFn('un rappel asynchrone'), handler: ctx.handler, depth: ctx.depth })
    } else {
      this.analyzeHandler(fnNode, ctx, eventText, firstTainted, kind)
    }
    return true
  }

  // --- sinks -----------------------------------------------------------------

  checkSinks(
    node: LuaNode,
    path: string,
    name: string,
    argNodes: LuaNode[],
    args: Value[],
    receiver: Value,
    ctx: Ctx,
  ): void {
    const event = ctx.handler?.event
    const isMethod = node.base.type === 'MemberExpression'
    const unbounded = (v: Value | undefined): v is Value => !!v && isTainted(v) && !v.upper && !v.exact
    const unchecked = (v: Value | undefined): v is Value => !!v && isTainted(v) && !v.exact
    // Bounded, but by a test NaN goes through.
    const nanOpen = (v: Value | undefined): v is Value => !!v && isTainted(v) && v.upper && !nanFree(v)
    const at = isMethod ? node.base.identifier : node

    // FX001: money.
    let amountIndex: number | undefined
    if (isMethod && name in MONEY_METHODS) amountIndex = MONEY_METHODS[name]
    if (isMethod && name in QB_MONEY_METHODS && path.includes('Functions')) amountIndex = QB_MONEY_METHODS[name]
    if (amountIndex !== undefined) {
      const amount = args[amountIndex]
      if (unbounded(amount)) {
        this.report('FX001', at, `${RULES.FX001.title} : ${describeOrigins(amount)} → ${name}`, this.confidenceOf(amount), event)
      } else if (nanOpen(amount) && !(isMethod && name in MONEY_METHODS)) {
        // ESX's addAccountMoney/setAccountMoney test `money > 0` (or >= 0), which NaN fails:
        // there, NaN is refused downstream. QBCore AddMoney and others may not.
        this.report('FX001', at, `${RULES.FX001.title} : ${describeOrigins(amount)} → ${name}. ${NAN_MESSAGE}`, 'medium', event, NAN_FIX)
      }
    }

    // FX001 / FX002: ox_inventory AddItem(inv, item, count).
    if (/(^|\.)ox_inventory[.:]AddItem$/.test(path)) {
      const itemName = stringValue(argNodes[1], this.source)
      const item = args[1]
      const count = args[2]
      if (itemName && MONEY_ITEMS.has(itemName)) {
        if (unbounded(count)) {
          this.report('FX001', at, `${RULES.FX001.title} : ${describeOrigins(count)} → AddItem('${itemName}')`, this.confidenceOf(count), event)
        } else if (nanOpen(count)) {
          this.report('FX001', at, `${RULES.FX001.title} : ${describeOrigins(count)} → AddItem('${itemName}'). ${NAN_MESSAGE}`, 'medium', event, NAN_FIX)
        }
      } else if (unchecked(item) || unbounded(count)) {
        const v = unchecked(item) ? item : (count as Value)
        this.report('FX002', at, `${RULES.FX002.title} : ${describeOrigins(v)} → AddItem`, this.confidenceOf(v), event)
      } else if (nanOpen(count)) {
        this.report('FX002', at, `${RULES.FX002.title} : ${describeOrigins(count)} → AddItem. ${NAN_MESSAGE}`, 'medium', event, NAN_FIX)
      }
    }

    // FX002: ESX items and weapons, QBCore AddItem.
    let itemIndexes: [number, number] | undefined
    if (isMethod && name in ITEM_METHODS) itemIndexes = ITEM_METHODS[name]
    if (isMethod && name === 'AddItem' && path.includes('Functions')) itemIndexes = [0, 1]
    if (itemIndexes) {
      const item = args[itemIndexes[0]]
      const count = args[itemIndexes[1]]
      if (unchecked(item) || unbounded(count)) {
        const v = unchecked(item) ? item : (count as Value)
        this.report('FX002', at, `${RULES.FX002.title} : ${describeOrigins(v)} → ${name}`, this.confidenceOf(v), event)
      } else if (nanOpen(count)) {
        this.report('FX002', at, `${RULES.FX002.title} : ${describeOrigins(count)} → ${name}. ${NAN_MESSAGE}`, 'medium', event, NAN_FIX)
      }
    }

    // FX004: SQL text built from client data.
    if (SQL_CALL.test(path)) {
      const query = args[0]
      if (query && isTainted(query) && !query.numeric && query.origins.some((o) => o.kind === 'client')) {
        this.report('FX004', at, `${RULES.FX004.title} : ${describeOrigins(query)} → ${path}`, this.confidenceOf(query), event)
      }
    }

    // FX101: code from an HTTP response given to load().
    if (path === 'load' || path === 'loadstring') {
      const code = args[0]
      if (code && code.origins.some((o) => o.kind === 'http')) {
        this.report('FX101', node, `${RULES.FX101.title} : réponse de PerformHttpRequest → ${path}()`, 'high', event)
      }
    }

    // FX003: actions on a player the client chose.
    if (ctx.handler) {
      const pending = ctx.handler.pendingTargets
      if (isMethod && receiver.target && !/^(get|has|can|is)[A-Z]|^show\w*Notification$/.test(name)) {
        pending.push({ node: at, origin: receiver.target, action: `${name}() sur le joueur cible` })
      }
      if (path === 'TriggerClientEvent' && unchecked(args[1]) && !/notif/i.test(this.text(argNodes[0] as LuaNode))) {
        pending.push({
          node,
          origin: args[1].origins[0] as Origin,
          action: `TriggerClientEvent(${this.text(argNodes[0] as LuaNode)})`,
        })
      }
      if (path === 'DropPlayer' && unchecked(args[0])) {
        pending.push({ node, origin: args[0].origins[0] as Origin, action: 'DropPlayer()' })
      }
    }
  }

  // --- conditions ------------------------------------------------------------

  /** Evaluates a condition and notes what the handler checked. */
  evalCondition(node: LuaNode, ctx: Ctx): void {
    this.evalExpr(node, ctx)
    const handler = ctx.handler
    if (!handler) return
    visit(node, (n) => {
      if (n.type === 'MemberExpression' && AUTH_FIELDS.has(n.identifier.name)) handler.authSeen = true
      if (isCall(n) && AUTH_CALLS.has(lastName(pathOf(n.base, this.source)))) handler.authSeen = true
      if (n.type === 'Identifier' || n.type === 'MemberExpression') {
        const key = this.keyOf(n)
        const v = key ? ctx.scope.lookup(key) : undefined
        for (const param of v ? (relatedOf([v]) ?? []) : []) handler.conditionParams.add(param)
      }
    })
  }

  /** What is known about variables when `node` evaluates to `positive`. */
  refinements(node: LuaNode | undefined, positive: boolean, ctx: Ctx): Refinement[] {
    if (!node) return []
    if (node.type === 'UnaryExpression' && node.operator === 'not') return this.refinements(node.argument, !positive, ctx)
    if (node.type === 'LogicalExpression') {
      const left = this.refinements(node.left, positive, ctx)
      const right = this.refinements(node.right, positive, ctx)
      // `a and b` true, or `a or b` false: both sides hold. Otherwise only what both sides prove.
      const bothHold = (node.operator === 'and') === positive
      return bothHold ? [...left, ...right] : intersect(left, right)
    }
    if (node.type === 'BinaryExpression' && COMPARISON_OPS.has(node.operator)) {
      return this.comparisonRefinements(node, positive, ctx)
    }
    // `if Config.Items[item] then`: the key exists in a server table.
    if (positive && node.type === 'IndexExpression') {
      const key = this.guardedKey(node.index)
      if (key && !isTainted(this.evalQuiet(node.base, ctx))) return [{ key, upper: true, exact: true }]
    }
    if (positive && isCall(node) && CONTAINS_CALLS.test(pathOf(node.base, this.source))) {
      const args = callArgs(node)
      const key = this.guardedKey(args[1])
      if (key) return [{ key, upper: true, exact: true }]
    }
    // `if xPlayer.hasWeapon(name) then`: a server lookup answered for these values.
    if (positive && isCall(node) && this.isLookupCall(node, pathOf(node.base, this.source))) {
      return callArgs(node)
        .map((arg) => this.guardedKey(arg))
        .filter((key): key is string => !!key && isTainted(this.evalQuiet(keyNodeless(key), ctx)))
        .map((key) => ({ key, upper: true, exact: true }))
    }
    // `local item = xPlayer.getInventoryItem(name)` then `if item then`.
    if (positive && (node.type === 'Identifier' || node.type === 'MemberExpression')) {
      const key = this.keyOf(node)
      const v = key ? ctx.scope.lookup(key) : undefined
      if (v?.lookup && !isTainted(v)) {
        return (v.related ?? []).map((param) => ({ key: param, upper: true, exact: true }))
      }
    }
    return []
  }

  comparisonRefinements(node: LuaNode, positive: boolean, ctx: Ctx): Refinement[] {
    // `x ~= x` is only true for NaN: `if x ~= x then return end` rules it out.
    const selfKey = this.guardedKey(node.left)
    if (selfKey && selfKey === this.guardedKey(node.right)) {
      const notNan = (node.operator === '~=' && !positive) || (node.operator === '==' && positive)
      return notNan ? [{ key: selfKey, upper: false, exact: false, nanSafe: true }] : []
    }
    let op: string = node.operator
    let keyNode = node.left
    let other = node.right
    if (!this.guardedKey(keyNode) || isTainted(this.evalQuiet(other, ctx))) {
      keyNode = node.right
      other = node.left
      op = ({ '<': '>', '<=': '>=', '>': '<', '>=': '<=' } as Record<string, string>)[op] ?? op
    }
    // `Config.Items[item] ~= nil`: membership test.
    if (other.type === 'NilLiteral' && keyNode.type === 'IndexExpression') {
      const exists = (op === '~=') === positive
      return exists ? this.refinements(keyNode, true, ctx) : []
    }
    const key = this.guardedKey(keyNode)
    if (!key || other.type === 'NilLiteral' || isTainted(this.evalQuiet(other, ctx))) return []
    const upper = positive ? op === '<' || op === '<=' : op === '>' || op === '>='
    const exact = positive ? op === '==' : op === '~='
    // A comparison that held proves the value is not NaN; one that failed does not.
    return upper || exact ? [{ key, upper: true, exact, nanSafe: positive || exact }] : []
  }

  /** Key of `x`, `data.x`, or of `tonumber(x)` and similar wrappers. */
  guardedKey(node: LuaNode | undefined): string | undefined {
    if (!node) return undefined
    if (isCall(node) && PASS_THROUGH_CALLS.has(pathOf(node.base, this.source))) return this.guardedKey(callArgs(node)[0])
    return this.keyOf(node)
  }

  /** Evaluates without side effects on findings: only for reading a value. */
  evalQuiet(node: LuaNode | undefined, ctx: Ctx): Value {
    if (!node) return CLEAN
    const key = this.keyOf(node)
    if (key) {
      const v = ctx.scope.lookup(key)
      if (v) return v
      const base = key.split('.')[0] as string
      const baseValue = ctx.scope.lookup(base)
      return baseValue && isTainted(baseValue) ? { ...baseValue, upper: false, exact: false } : CLEAN
    }
    if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
      return combine([this.evalQuiet(node.left, ctx), this.evalQuiet(node.right, ctx)])
    }
    if (isCall(node)) return combine(callArgs(node).map((a) => this.evalQuiet(a, ctx)))
    return CLEAN
  }

  applyRefinements(refs: Refinement[], scope: Scope, ctx: Ctx): void {
    for (const r of refs) {
      const current = this.evalQuiet(keyNodeless(r.key), { ...ctx, scope })
      if (!isTainted(current)) continue
      scope.refine(r.key, refine(current, r.key, [r]))
    }
  }
}

// ---------------------------------------------------------------------------

function newFn(yielded: string | null): FnState {
  return { yielded, sourceReported: false, returns: [] }
}

/** Refinements proved by both lists. */
function intersect(a: Refinement[], b: Refinement[]): Refinement[] {
  const out: Refinement[] = []
  for (const r of a) {
    const other = b.find((x) => x.key === r.key)
    if (other) {
      out.push({
        key: r.key,
        upper: r.upper && other.upper,
        exact: r.exact && other.exact,
        nanSafe: (r.nanSafe === true || r.exact) && (other.nanSafe === true || other.exact),
      })
    }
  }
  return out
}

/** A value with the checks of `refs` that apply to `key`. */
function refine(value: Value, key: string, refs: Refinement[]): Value {
  let v = value
  for (const r of refs) {
    if (r.key !== key || !isTainted(v)) continue
    v = {
      ...v,
      upper: v.upper || r.upper || r.exact,
      exact: v.exact || r.exact,
      nanSafe: v.nanSafe === true || r.nanSafe === true || r.exact,
    }
  }
  return v
}

/** A synthetic node whose key is `key`, to reuse evalQuiet on a key. */
function keyNodeless(key: string): LuaNode {
  const parts = key.split('.')
  let node = { type: 'Identifier', name: parts[0] } as unknown as LuaNode
  for (const part of parts.slice(1)) {
    node = { type: 'MemberExpression', indexer: '.', base: node, identifier: { type: 'Identifier', name: part } } as unknown as LuaNode
  }
  return node
}

/** True when a block always leaves the function or the loop. */
function exits(body: LuaNode[]): boolean {
  return body.some(
    (s) =>
      s.type === 'ReturnStatement' ||
      s.type === 'BreakStatement' ||
      s.type === 'GotoStatement' ||
      (s.type === 'CallStatement' && s.expression.base?.type === 'Identifier' && s.expression.base.name === 'error'),
  )
}

/** Visits every node under `node`, without entering nested functions' own analysis. */
function visit(node: LuaNode, fn: (n: LuaNode) => void): void {
  const stack: unknown[] = [node]
  while (stack.length) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
      continue
    }
    if (!current || typeof current !== 'object') continue
    const n = current as LuaNode
    if (typeof n.type === 'string') fn(n)
    for (const [field, value] of Object.entries(n)) {
      if (field === 'loc' || field === 'range') continue
      if (value && typeof value === 'object') stack.push(value)
    }
  }
}

function readIgnores(source: string): Map<number, Set<string> | 'all'> {
  const ignores = new Map<number, Set<string> | 'all'>()
  source.split('\n').forEach((text, i) => {
    const m = /--\s*fxaudit-ignore\b([^\n]*)/.exec(text)
    if (!m) return
    const ids = (m[1] ?? '').match(/FX\d{3}/g)
    ignores.set(i + 1, ids && ids.length ? new Set(ids) : 'all')
  })
  return ignores
}
