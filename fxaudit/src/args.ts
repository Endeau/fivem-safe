// Command-line arguments of fxaudit.

export interface Options {
  target?: string
  json: boolean
  color: boolean
  sarif?: string
  html?: string
  help: boolean
  version: boolean
}

export function parseArgs(argv: string[]): Options | string {
  const options: Options = { json: false, color: true, help: false, version: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '--json') options.json = true
    else if (arg === '--no-color') options.color = false
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--sarif' || arg === '--html') {
      const value = argv[++i]
      if (!value || value.startsWith('--')) return `fxaudit : ${arg} attend un nom de fichier.`
      options[arg === '--sarif' ? 'sarif' : 'html'] = value
    } else if (arg.startsWith('--')) return `fxaudit : option inconnue ${arg}.`
    else if (options.target) return 'fxaudit : un seul dossier ou fichier à la fois.'
    else options.target = arg
  }
  return options
}
