// SARIF 2.1.0, the format GitHub code scanning and GitLab read.
// https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html

import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { RULES, type Finding, type RuleId } from '../rules/rules.ts'
import type { ScanResult } from '../scan.ts'
import { VERSION } from '../version.ts'

const HELP_URI = 'https://github.com/Endeau/fivem-safe#fxaudit'

const LEVELS = { critical: 'error', warning: 'warning' } as const

/** A file path as a relative URI: each segment encoded, so `[esx_addons]` stays valid. */
export function toUri(file: string): string {
  return file
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * Identifies a finding across runs even when lines move: rule, file, event and
 * the part of the message before the location details.
 */
export function fingerprint(f: Finding): string {
  const parts = [f.rule, f.file, f.event ?? '', f.message]
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
}

/**
 * Path of a finding for SARIF: relative to `base` (the current folder, which is
 * the repository root in CI) when the file is inside it, so GitHub can link the
 * alert to the file; relative to the scanned folder otherwise.
 */
export function sarifPath(result: ScanResult, file: string, base: string): string {
  const absolute = file === result.root ? resolve(file) : resolve(result.root, file)
  const fromBase = relative(resolve(base), absolute)
  const inside = fromBase !== '' && !fromBase.startsWith('..') && !isAbsolute(fromBase)
  return inside ? fromBase.split(sep).join('/') : file
}

export function formatSarif(result: ScanResult, base: string = process.cwd()): string {
  const ruleIds = Object.keys(RULES) as RuleId[]
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'fxaudit',
            version: VERSION,
            semanticVersion: VERSION,
            informationUri: 'https://github.com/Endeau/fivem-safe',
            rules: ruleIds.map((id) => {
              const rule = RULES[id]
              return {
                id,
                name: id,
                shortDescription: { text: rule.title },
                fullDescription: { text: rule.title },
                help: { text: rule.fix, markdown: `**Correction** : ${rule.fix}` },
                helpUri: HELP_URI,
                defaultConfiguration: { level: LEVELS[rule.severity] },
                properties: { tags: ['security', 'fivem'] },
              }
            }),
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.rule,
          ruleIndex: ruleIds.indexOf(f.rule),
          level: LEVELS[f.severity],
          message: { text: `${f.message}\nCorrection : ${f.fix}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: toUri(sarifPath(result, f.file, base)) },
                region: { startLine: f.line, startColumn: f.column },
              },
            },
          ],
          partialFingerprints: { 'fxaudit/v1': fingerprint(f) },
          properties: {
            confidence: f.confidence,
            ...(f.event !== undefined ? { event: f.event } : {}),
            ...(f.resource !== undefined ? { resource: f.resource } : {}),
          },
        })),
        invocations: [
          {
            executionSuccessful: true,
            toolExecutionNotifications: result.errors.map((e) => ({
              level: 'warning',
              message: { text: `Fichier illisible : ${e.message}` },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: toUri(sarifPath(result, e.file, base)) },
                    region: { startLine: Math.max(1, e.line) },
                  },
                },
              ],
            })),
          },
        ],
      },
    ],
  }
  return JSON.stringify(sarif, null, 2)
}
