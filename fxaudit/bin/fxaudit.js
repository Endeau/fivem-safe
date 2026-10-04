#!/usr/bin/env node
// Installed package: runs the compiled build. In the repository without a
// build, Node >= 22.18 runs the TypeScript sources directly (type stripping).
import { existsSync } from 'node:fs'

const built = new URL('../dist/src/cli.js', import.meta.url)
await import(existsSync(built) ? built.href : new URL('../src/cli.ts', import.meta.url).href)
