import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { formatHtml } from './report/html.ts'
import { formatSarif } from './report/sarif.ts'
import { formatTerminal } from './report/terminal.ts'
import { parseArgs } from './args.ts'
import { scan } from './scan.ts'
import { VERSION } from './version.ts'

const USAGE = `Utilisation : fxaudit <dossier ou fichier> [options]

Analyse les scripts serveur Lua d'un serveur FiveM et signale les events
qui font confiance à ce que le client envoie.

  --json             sortie JSON sur la sortie standard (pour la CI)
  --sarif <fichier>  écrit un rapport SARIF 2.1.0 (GitHub code scanning, GitLab)
  --html <fichier>   écrit un rapport HTML autonome, à remettre au propriétaire du serveur
  --no-color         pas de couleurs
  --version          affiche la version

Code de sortie : 0 sans problème critique, 1 si au moins un problème critique, 2 en cas d'erreur.`

function main(argv: string[]): number {
  const options = parseArgs(argv)
  if (typeof options === 'string') {
    console.error(`${options}\n\n${USAGE}`)
    return 2
  }
  if (options.version) {
    console.log(VERSION)
    return 0
  }
  if (options.help || !options.target) {
    console.log(USAGE)
    return options.help ? 0 : 2
  }
  const target = options.target
  if (!existsSync(target)) {
    console.error(`fxaudit : ${target} n'existe pas.`)
    return 2
  }

  const result = scan(target)
  const rootIsFile = statSync(target).isFile()

  if (options.sarif) writeFileSync(options.sarif, formatSarif(result))
  if (options.html) {
    const readSource = (file: string): string | undefined => {
      try {
        return readFileSync(rootIsFile ? file : join(target, file), 'utf8')
      } catch {
        return undefined
      }
    }
    writeFileSync(options.html, formatHtml(result, { readSource, target: basename(resolve(target)), date: new Date() }))
  }

  if (options.json) {
    console.log(JSON.stringify({ tool: 'fxaudit', version: VERSION, ...result }, null, 2))
  } else {
    const color = options.color && process.stdout.isTTY === true && !process.env.NO_COLOR
    console.log(formatTerminal(result, color))
    for (const [kind, file] of [['SARIF', options.sarif], ['HTML', options.html]] as const) {
      if (file) console.log(`Rapport ${kind} : ${file}`)
    }
  }
  return result.findings.some((f) => f.severity === 'critical') ? 1 : 0
}

process.exitCode = main(process.argv.slice(2))
