import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { analyzeFile } from './analysis/analyze.ts'
import { LuaSyntaxError, parseLua } from './parse/parse.ts'
import type { Finding } from './rules/rules.ts'

export interface ScanError {
  file: string
  line: number
  message: string
}

export interface ScanResult {
  root: string
  files: number
  /** Resources (folders with an fxmanifest) that had server files analyzed. */
  resources: number
  /** Server handlers analyzed: net events, callbacks, HTTP callbacks. */
  handlers: number
  skippedClientFiles: number
  findings: Finding[]
  errors: ScanError[]
}

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build'])
const MANIFESTS = ['fxmanifest.lua', '__resource.lua']

interface Manifest {
  dir: string
  client: RegExp[]
  server: RegExp[]
}

/** Scans every .lua file under `root`, except client-only scripts. */
export function scan(root: string): ScanResult {
  const result: ScanResult = { root, files: 0, resources: 0, handlers: 0, skippedClientFiles: 0, findings: [], errors: [] }
  const rootIsFile = statSync(root).isFile()
  const files = rootIsFile ? [root] : listLuaFiles(root)
  const manifests = new Map<string, Manifest | null>()
  const resources = new Set<string>()

  for (const file of files) {
    const display = rootIsFile ? file : relative(root, file).split(sep).join('/')
    if (MANIFESTS.some((m) => file.endsWith(sep + m) || file === m)) continue
    if (isClientOnly(file, manifests)) {
      result.skippedClientFiles++
      continue
    }
    result.files++
    let parsed
    try {
      parsed = parseLua(readFileSync(file, 'utf8'))
    } catch (error) {
      if (error instanceof LuaSyntaxError) {
        result.errors.push({ file: display, line: error.line, message: error.message })
        continue
      }
      throw error
    }
    const resource = resourceOf(file, root, rootIsFile, manifests)
    resources.add(resource)
    const report = analyzeFile(parsed, { file: display })
    result.findings.push(...report.findings.map((f) => ({ ...f, resource })))
    result.handlers += report.handlers
  }
  result.resources = resources.size
  return result
}

/** The resource a file belongs to: its manifest folder, else its own folder. */
function resourceOf(file: string, root: string, rootIsFile: boolean, cache: Map<string, Manifest | null>): string {
  const manifest = manifestFor(file, cache)
  const dir = manifest ? manifest.dir : dirname(file)
  const base = rootIsFile ? dirname(root) : root
  const rel = relative(base, dir).split(sep).join('/')
  return rel === '' ? basename(resolve(dir)) : rel
}

function listLuaFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listLuaFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.lua')) out.push(path)
  }
  return out
}

/** Glob of an fxmanifest entry to a regular expression on the resource-relative path. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else {
        re += '.*'
      }
    } else if (c === '*') {
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

/** Reads client_script(s) and server_script(s)/shared_script(s) entries of a manifest. */
export function readManifest(text: string, dir: string): Manifest {
  const manifest: Manifest = { dir, client: [], server: [] }
  const statement = /\b(client|server|shared)_scripts?\s*(\{[^}]*\}|\(?\s*(['"])[^'"]*\3\s*\)?)/g
  for (const m of text.matchAll(statement)) {
    const side = m[1]
    const entries = [...(m[2] ?? '').matchAll(/(['"])([^'"]+)\1/g)].map((e) => e[2] as string)
    for (const entry of entries) {
      if (entry.startsWith('@')) continue // a file of another resource
      const re = globToRegExp(entry.replace(/^\.\//, ''))
      if (side === 'client') manifest.client.push(re)
      else manifest.server.push(re)
    }
  }
  return manifest
}

function manifestFor(file: string, cache: Map<string, Manifest | null>): Manifest | null {
  const parts = file.split(sep)
  for (let i = parts.length - 1; i > 0; i--) {
    const dir = parts.slice(0, i).join(sep) || sep
    if (cache.has(dir)) {
      const cached = cache.get(dir)
      if (cached) return cached
      continue
    }
    const found = MANIFESTS.map((m) => join(dir, m)).find((p) => existsSync(p))
    const manifest = found ? readManifest(readFileSync(found, 'utf8'), dir) : null
    cache.set(dir, manifest)
    if (manifest) return manifest
  }
  return null
}

function isClientOnly(file: string, cache: Map<string, Manifest | null>): boolean {
  const manifest = manifestFor(file, cache)
  if (manifest) {
    const rel = relative(manifest.dir, file).split(sep).join('/')
    const client = manifest.client.some((re) => re.test(rel))
    const server = manifest.server.some((re) => re.test(rel))
    return client && !server
  }
  // No manifest: guess from the path.
  return /(^|\/)(client|cl)(\/|_[^/]*\.lua$|\.lua$)/i.test(file.split(sep).join('/'))
}
