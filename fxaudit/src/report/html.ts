// A self-contained HTML report, in French, to hand to a server owner.
// One file: inline CSS, no script, no external resource.

import { RULES, type Finding } from '../rules/rules.ts'
import type { ScanResult } from '../scan.ts'
import { VERSION } from '../version.ts'

const CONTEXT_LINES = 3

export interface HtmlOptions {
  /** Returns the text of a scanned file, by its path as shown in the findings. */
  readSource: (file: string) => string | undefined
  /** Name shown for the analyzed folder. */
  target: string
  date: Date
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`

function excerpt(finding: Finding, source: string | undefined): string {
  if (source === undefined) return ''
  const lines = source.split(/\r?\n/)
  const first = Math.max(1, finding.line - CONTEXT_LINES)
  const last = Math.min(lines.length, finding.line + CONTEXT_LINES)
  const rows: string[] = []
  for (let n = first; n <= last; n++) {
    const text = (lines[n - 1] ?? '').replace(/\t/g, '    ')
    const hit = n === finding.line
    rows.push(
      `<span class="row${hit ? ' hit' : ''}"><span class="ln">${n}</span><span class="src">${escapeHtml(text) || ' '}</span></span>`,
    )
  }
  return `<pre class="code" aria-label="Extrait de ${escapeHtml(finding.file)}, lignes ${first} à ${last}">${rows.join('')}</pre>`
}

function findingHtml(f: Finding, options: HtmlOptions): string {
  const rule = RULES[f.rule]
  const severity = f.severity === 'critical' ? 'Critique' : 'Avertissement'
  const confidence = f.confidence === 'medium' ? '<span class="conf">confiance moyenne</span>' : ''
  return `
      <article class="finding ${f.severity}">
        <header>
          <span class="chip ${f.severity}">${severity}</span>
          <span class="rule">${f.rule}</span>
          <h3>${escapeHtml(rule.title)}</h3>
          ${confidence}
        </header>
        <p class="where"><code>${escapeHtml(f.file)}:${f.line}:${f.column}</code>${
          f.event ? ` · event <code>${escapeHtml(f.event)}</code>` : ''
        }</p>
        <p class="msg">${escapeHtml(f.message)}</p>
        ${excerpt(f, options.readSource(f.file))}
        <div class="fix"><strong>Correction</strong><p>${escapeHtml(f.fix)}</p></div>
      </article>`
}

function groupByResource(findings: Finding[]): [string, Finding[]][] {
  const groups = new Map<string, Finding[]>()
  for (const f of findings) {
    const key = f.resource ?? f.file.split('/').slice(0, -1).join('/')
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const weight = (list: Finding[]) => list.filter((f) => f.severity === 'critical').length * 1000 + list.length
  return [...groups.entries()].sort((a, b) => weight(b[1]) - weight(a[1]) || a[0].localeCompare(b[0]))
}

const SAFE_EVENTS_EXAMPLE = `-- Avant : le client choisit le montant
RegisterNetEvent('pizza:pay', function(amount)
    local xPlayer = ESX.GetPlayerFromId(source)
    xPlayer.addMoney(amount)
end)

-- Après : safe_events valide l'appel, le montant vient du serveur
SafeEvents.register('pizza:pay', {
    args     = { { name = 'deliveryId', type = 'integer', min = 1, max = #Config.Rewards } },
    job      = { name = 'pizza' },
    distance = { coords = Config.PayPoint, max = 8.0 },
    rate     = { calls = 1, per = 30 },
}, function(xPlayer, args, source)
    xPlayer.addAccountMoney('money', Config.Rewards[args.deliveryId], 'pizza:pay')
end)`

export function formatHtml(result: ScanResult, options: HtmlOptions): string {
  const critical = result.findings.filter((f) => f.severity === 'critical').length
  const warnings = result.findings.length - critical
  const groups = groupByResource(result.findings)
  const date = options.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  const body =
    result.findings.length === 0
      ? `<section class="empty"><h2>Aucun problème trouvé</h2><p>Aucun des ${plural(
          result.handlers,
          'handler serveur analysé',
          'handlers serveur analysés',
        )} ne fait confiance à ce que le client envoie, selon les règles de fxaudit. Voir les limites en bas de page.</p></section>`
      : groups
          .map(([resource, list]) => {
            const c = list.filter((f) => f.severity === 'critical').length
            const counts = [c ? plural(c, 'critique', 'critiques') : '', list.length - c ? plural(list.length - c, 'avertissement', 'avertissements') : '']
              .filter(Boolean)
              .join(', ')
            return `
    <section class="resource">
      <h2><span class="res-name">${escapeHtml(resource)}</span><span class="res-count">${counts}</span></h2>
      ${list.map((f) => findingHtml(f, options)).join('\n')}
    </section>`
          })
          .join('\n')

  const skipped = result.errors.length
    ? `<section class="skipped"><h2>Fichiers non analysés</h2><ul>${result.errors
        .map((e) => `<li><code>${escapeHtml(e.file)}:${e.line}</code> ${escapeHtml(e.message)}</li>`)
        .join('')}</ul></section>`
    : ''

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit fxaudit · ${escapeHtml(options.target)}</title>
<style>
:root{
  --bg:#F3F5F4;--surface:#FFFFFF;--sunk:#E8EDEB;--ink:#16211E;--muted:#58675F;--line:#D2DAD6;
  --accent:#1F6F5C;--crit:#A8231B;--crit-soft:#F7E0DC;--warn:#875800;--warn-soft:#F5E8CC;
  --hit:#FFF3C4;--code-bg:#F7F9F8;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SFMono-Regular","Cascadia Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --bg:#0F1614;--surface:#16201D;--sunk:#1D2926;--ink:#E3ECE8;--muted:#9AAAA4;--line:#2B3935;
  --accent:#5CC4A6;--crit:#F2887F;--crit-soft:#3B1C1A;--warn:#E4B35C;--warn-soft:#352A14;
  --hit:#3A3417;--code-bg:#111A17;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);padding:0 20px 56px}
.wrap{max-width:980px;margin:0 auto}
header.top{padding:40px 0 24px;border-bottom:1px solid var(--line)}
.eyebrow{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:clamp(26px,4.5vw,36px);line-height:1.1;margin:10px 0 8px;letter-spacing:-.01em}
.meta{color:var(--muted);font-size:14px;display:flex;flex-wrap:wrap;gap:4px 18px}
.meta code{font:13px var(--mono);color:var(--ink)}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:24px 0 8px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.stat b{display:block;font-size:30px;line-height:1.1;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:13px}
.stat.crit b{color:var(--crit)} .stat.warn b{color:var(--warn)}
.intro{color:var(--muted);max-width:70ch;margin:16px 0 0}
section{margin-top:36px}
h2{font-size:20px;margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px}
.res-name{font-family:var(--mono);font-size:17px}
.res-count{color:var(--muted);font-size:14px;font-weight:400}
.finding{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:10px;padding:16px 18px;margin-bottom:14px}
.finding.critical{border-left-color:var(--crit)}
.finding header{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.finding h3{font-size:16px;margin:0}
.chip{font:600 11.5px/1 var(--mono);padding:4px 8px;border-radius:99px}
.chip.critical{background:var(--crit-soft);color:var(--crit)} .chip.warning{background:var(--warn-soft);color:var(--warn)}
.rule{font:600 13px var(--mono);color:var(--muted)}
.conf{font-size:12.5px;color:var(--muted);border:1px solid var(--line);border-radius:99px;padding:1px 8px}
.where{margin:8px 0 4px;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.where code,.fix code,li code{font:13px var(--mono);color:var(--ink)}
.msg{margin:0 0 10px;max-width:75ch}
pre.code{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;margin:0 0 12px;padding:8px 0;overflow-x:auto;font:13px/1.55 var(--mono)}
.row{display:block;padding:0 14px 0 0;white-space:pre}
.row.hit{background:var(--hit)}
.ln{display:inline-block;min-width:3.2em;padding-right:12px;text-align:right;color:var(--muted);user-select:none}
.fix{border-top:1px dashed var(--line);padding-top:10px}
.fix strong{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.fix p{margin:4px 0 0;max-width:75ch}
.empty{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:20px}
.guide p,.limits li{max-width:72ch}
.guide pre{background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;font:13px/1.55 var(--mono)}
.limits ul,.skipped ul{padding-left:20px}
footer{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
@media print{body{background:#fff}.finding{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="eyebrow">Rapport fxaudit</div>
    <h1>Audit des events serveur</h1>
    <div class="meta"><span>Dossier analysé : <code>${escapeHtml(options.target)}</code></span><span>${escapeHtml(date)}</span><span>fxaudit ${VERSION}</span></div>
    <div class="summary">
      <div class="stat crit"><b>${critical}</b><span>${critical > 1 ? 'problèmes critiques' : 'problème critique'}</span></div>
      <div class="stat warn"><b>${warnings}</b><span>${warnings > 1 ? 'avertissements' : 'avertissement'}</span></div>
      <div class="stat"><b>${result.resources}</b><span>${result.resources > 1 ? 'ressources analysées' : 'ressource analysée'}</span></div>
      <div class="stat"><b>${result.handlers}</b><span>${result.handlers > 1 ? 'handlers serveur' : 'handler serveur'}</span></div>
    </div>
    <p class="intro">fxaudit lit les scripts serveur Lua sans les exécuter et cherche les events qui font confiance à ce que le client envoie : un montant, un item, un joueur cible ou du SQL choisis par le client. Un joueur qui triche peut déclencher ces events avec les valeurs de son choix.</p>
  </header>
${body}
${skipped}
  <section class="guide">
    <h2>Comment corriger avec safe_events</h2>
    <p>safe_events est une ressource gratuite qui déclare, pour chaque event, ce que le serveur accepte : types et bornes des arguments (NaN et l'infini sont refusés), job, distance, fréquence. Un appel qui ne respecte pas la déclaration n'atteint jamais le handler, il est journalisé et peut expulser le joueur. Le mode <code>audit</code> journalise sans bloquer, pour l'installer sur un serveur en production sans rien casser.</p>
    <pre>${escapeHtml(SAFE_EVENTS_EXAMPLE)}</pre>
    <p>Installation et documentation : <code>github.com/Endeau/fivem-safe</code></p>
  </section>
  <section class="limits">
    <h2>Limites de l'analyse</h2>
    <ul>
      <li>L'analyse s'arrête au fichier : un event déclaré dans un fichier et traité dans un autre n'est pas suivi.</li>
      <li>Les scripts client sont ignorés : le serveur ne peut pas faire confiance au client, quoi qu'il contienne.</li>
      <li>Une alerte en « confiance moyenne » demande une vérification humaine. L'absence d'alerte ne prouve pas l'absence de faille.</li>
    </ul>
  </section>
  <footer>Généré par fxaudit ${VERSION} · ${plural(result.files, 'fichier serveur analysé', 'fichiers serveur analysés')}${
    result.skippedClientFiles ? `, ${plural(result.skippedClientFiles, 'script client ignoré', 'scripts client ignorés')}` : ''
  }.</footer>
</div>
</body>
</html>
`
}
