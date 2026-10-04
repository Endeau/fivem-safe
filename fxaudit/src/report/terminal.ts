import type { ScanResult } from '../scan.ts'

const LABELS = { critical: 'CRIT', warning: 'WARN' } as const

export function formatTerminal(result: ScanResult, color: boolean): string {
  const paint = (code: string, text: string): string => (color ? `\x1b[${code}m${text}\x1b[0m` : text)
  const lines: string[] = []

  for (const f of result.findings) {
    const label = f.severity === 'critical' ? paint('1;31', LABELS.critical) : paint('1;33', LABELS.warning)
    const confidence = f.confidence === 'medium' ? paint('2', ' (confiance moyenne)') : ''
    lines.push(`${label}  ${paint('1', f.rule)}  ${f.file}:${f.line}:${f.column}${confidence}`)
    lines.push(`       ${f.message}${f.event ? paint('2', `  [${f.event}]`) : ''}`)
    lines.push(`       Correction : ${f.fix}`)
    lines.push('')
  }

  for (const e of result.errors) {
    lines.push(`${paint('2', 'SKIP')}  ${e.file}:${e.line}  fichier illisible : ${e.message}`)
  }
  if (result.errors.length) lines.push('')

  const critical = result.findings.filter((f) => f.severity === 'critical').length
  const warnings = result.findings.length - critical
  const files = new Set(result.findings.map((f) => f.file)).size
  const handlers = plural(result.handlers, 'handler serveur', 'handlers serveur')
  const summary =
    result.findings.length === 0
      ? `Aucun problème trouvé dans ${plural(result.files, 'fichier', 'fichiers')} (${handlers} analysés).`
      : `${plural(critical, 'critique', 'critiques')}, ${plural(warnings, 'avertissement', 'avertissements')} ` +
        `dans ${plural(files, 'fichier', 'fichiers')} sur ${result.files} (${handlers}).`
  lines.push(summary)
  if (result.skippedClientFiles) {
    lines.push(paint('2', `${result.skippedClientFiles} scripts client ignorés (le client ne peut pas être sécurisé côté serveur).`))
  }
  return lines.join('\n')
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`
}
