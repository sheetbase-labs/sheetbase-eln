/**
 * Fail on literal colours in product code (DSYS-02.3).
 *
 * Product UI must use the UI system v3 semantic tokens, never Tailwind
 * palette classes or hex/rgb literals. This is a small custom rule because
 * the palette-class and hex patterns appear inside strings and template
 * literals, which `no-restricted-syntax` handles poorly.
 *
 * Run with `pnpm check:colours` (part of `pnpm check`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * Transitional files whose colours are data for other libraries, replaced by
 * their owning task rather than this sweep.
 */
const ALLOWLIST = new Set([
  // Builds rgb() strings from computed series values at runtime.
  'src/components/viz/chart-plots.tsx',
  // ReactFlow minimap maskColor takes a raw colour prop.
  'src/routes/lineage.tsx',
  // Gantt bar status colours; the planner surface retires (DEC-03).
  'src/components/planner/planner-timeline.tsx',
])

const PALETTE =
  /\b(?:bg|text|border|from|to|via|ring|divide|fill|stroke|outline|decoration|accent|caret|placeholder)-(?:red|green|blue|amber|yellow|slate|gray|grey|zinc|emerald|violet|purple|sky|orange|rose|indigo|teal|cyan|lime|fuchsia|pink)-[0-9]{2,3}\b/
const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB = /\brgba?\(/

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

const findings: Array<{ file: string; line: number; rule: string }> = []
for (const path of walk(SRC)) {
  const rel = relative(ROOT, path)
  if (rel.includes('.test.')) continue
  if (ALLOWLIST.has(rel)) continue
  const isTsx = rel.endsWith('.tsx')
  const lines = stripComments(readFileSync(path, 'utf8')).split('\n')
  lines.forEach((line, index) => {
    if (PALETTE.test(line))
      findings.push({ file: rel, line: index + 1, rule: 'palette class' })
    if (isTsx && HEX.test(line))
      findings.push({ file: rel, line: index + 1, rule: 'hex colour' })
    if (isTsx && RGB.test(line))
      findings.push({ file: rel, line: index + 1, rule: 'rgb() colour' })
  })
}

if (findings.length > 0) {
  console.error('Literal colours found in product code (use v3 tokens):\n')
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  ${finding.rule}`)
  }
  console.error(`\n${findings.length} finding(s).`)
  process.exitCode = 1
} else {
  console.log('No literal colours in product code.')
}
