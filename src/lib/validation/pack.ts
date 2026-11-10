/**
 * The validation pack: what a validation team files, in one signed archive.
 *
 *   README.md                      what this is and what it is not
 *   system.json                    versions and non-secret configuration
 *   requirements.csv               each requirement and the checks that look at it
 *   trace.csv / trace.md           requirement -> automated tests and live checks
 *   protocol.md                    the IQ/OQ protocol, with sign-off blocks to fill in
 *   runs/<id>.json, runs/<id>.md   the evidence of each included run
 *   manifest.json, manifest.sig, public-key.pem, verify.mjs, verify.sh
 *                                  the same offline checks as a signed export bundle
 *
 * The pack is documentation and evidence. It does not claim that Sheetbase or
 * any lab using it complies with a regulation; deciding that, and signing off
 * the protocol, is for the lab's own people.
 */
import { createHash } from 'node:crypto'

import { VERIFY_MJS, VERIFY_SH } from '../export/bundle-verify-script'
import { ZipWriter } from '../export/zip'
import { checksumLines } from '../export/evidence-package'
import { CHECKS } from './checks.server'
import { REQUIREMENTS } from './requirements'
import trace from './trace.generated.json'
import type { CheckResult, ValidationRunRecord } from './types'

export const PACK_FORMAT = 'sheetbase-validation-pack/1'

export interface PackInput {
  workspaceName: string
  generatedAt: string
  appVersion: string
  migration: string | null
  /** Non-secret facts about this install, written to `system.json`. */
  system: Record<string, string | number | boolean | null>
  runs: ValidationRunRecord[]
  publicKeyPem: string
  fingerprint: string
  sign: (manifest: Uint8Array) => Uint8Array
}

function csv(rows: Array<Array<string | number>>): string {
  return (
    rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','),
      )
      .join('\r\n') + '\r\n'
  )
}

const checkTitle = (id: string): string =>
  CHECKS.find((c) => c.id === id)?.title ?? id

export function requirementsCsv(): string {
  return csv([
    ['Requirement', 'Area', 'Statement', 'Live checks'],
    ...REQUIREMENTS.map((r) => [
      r.id,
      r.area,
      r.statement,
      r.checks.join('; '),
    ]),
  ])
}

export function traceCsv(): string {
  return csv([
    ['Requirement', 'Layer', 'Automated test file', 'Test'],
    ...REQUIREMENTS.flatMap((r) => {
      const tests = trace.entries.filter((e) => e.requirement === r.id)

      return tests.length === 0
        ? [[r.id, '', '', '(no automated test is tagged to this requirement)']]
        : tests.map((e) => [r.id, e.layer, e.file, e.title])
    }),
  ])
}

export function traceMarkdown(latest: ValidationRunRecord | undefined): string {
  const lines = [
    '# Requirements trace',
    '',
    'Each requirement, the automated tests tagged to it in the Sheetbase source,',
    'and the checks that look at it on a live install' +
      (latest
        ? ` (latest run: ${latest.finished_at}).`
        : ' (no run included).'),
    '',
  ]

  for (const r of REQUIREMENTS) {
    lines.push(`## ${r.id} — ${r.area}`, '', r.statement, '')
    const tests = trace.entries.filter((e) => e.requirement === r.id)
    lines.push('Automated tests:')
    lines.push(
      ...(tests.length
        ? tests.map((e) => `- ${e.file} (${e.layer}): ${e.title}`)
        : ['- none tagged']),
    )
    lines.push('', 'Live checks:')
    lines.push(
      ...(r.checks.length
        ? r.checks.map((id) => {
            const result = latest?.results.find((c) => c.id === id)

            return `- ${id} ${checkTitle(id)}${result ? `: ${result.status}` : ''}`
          })
        : ['- none']),
    )
    lines.push('')
  }

  return lines.join('\n')
}

export function protocolMarkdown(input: PackInput): string {
  const lines = [
    '# Installation and operational qualification protocol',
    '',
    `Workspace: ${input.workspaceName}`,
    `Application version: ${input.appVersion}`,
    `Generated: ${input.generatedAt}`,
    '',
    'Each check below is run by Sheetbase against this install (Settings >',
    'Validation). The runs included in this pack hold the results. A skipped',
    'check was not performed and is not a pass.',
    '',
  ]

  for (const kind of ['iq', 'oq'] as const) {
    lines.push(
      kind === 'iq' ? '## Installation checks' : '## Operational checks',
      '',
    )

    for (const c of CHECKS.filter((x) => x.kind === kind)) {
      lines.push(
        `### ${c.id} ${c.title}`,
        '',
        `Method: ${c.method}`,
        '',
        `Expected: ${c.expected}`,
        '',
        `Requirements: ${c.requirements.join(', ')}`,
        '',
      )
    }
  }

  lines.push(
    '## Review and sign-off',
    '',
    'To be completed by the lab. Sheetbase does not fill these in.',
    '',
    '| Role | Name | Signature | Date |',
    '| --- | --- | --- | --- |',
    '| Executed by | | | |',
    '| Reviewed by | | | |',
    '| Approved by | | | |',
    '',
    'Deviations and how they were resolved:',
    '',
    '',
  )

  return lines.join('\n')
}

export function runMarkdown(run: ValidationRunRecord): string {
  const lines = [
    `# Validation run ${run.id}`,
    '',
    `Started ${run.started_at}, finished ${run.finished_at}.`,
    `Application version ${run.app_version}${run.migration ? `, migration ${run.migration}` : ''}.`,
    `Result: ${run.status}. ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped.`,
    '',
    '| Check | Result | Found |',
    '| --- | --- | --- |',
    ...run.results.map(
      (c: CheckResult) =>
        `| ${c.id} ${c.title} | ${c.status} | ${c.detail.replaceAll('|', '\\|')} |`,
    ),
    '',
  ]

  return lines.join('\n')
}

function readme(input: PackInput): string {
  return [
    '# Sheetbase validation pack',
    '',
    `Workspace: ${input.workspaceName}`,
    `Generated: ${input.generatedAt}`,
    `Application version: ${input.appVersion}`,
    `Format: ${PACK_FORMAT}`,
    '',
    'This pack is an input to your own validation. It holds:',
    '',
    '- `requirements.csv`: what a regulated lab asks of the software, in plain words',
    '- `trace.csv`, `trace.md`: which automated tests and which live checks cover each requirement',
    '- `protocol.md`: the installation and operational checks, with blocks for your sign-off',
    '- `runs/`: the evidence from running those checks on this install',
    '- `system.json`: the versions and non-secret settings of this install',
    '',
    '## What it is not',
    '',
    'It does not say that Sheetbase, or your use of it, complies with 21 CFR',
    'Part 11, EU Annex 11, GLP, GMP or any other rule. Whether it is fit for your',
    'intended use is a decision for your quality and validation people, who may',
    'accept, extend or reject this evidence.',
    '',
    '## Checking the pack has not changed',
    '',
    '    node verify.mjs --key-fingerprint ' + input.fingerprint,
    '    ./verify.sh',
    '',
    'The files are listed with SHA-256 digests in `manifest.json`, which is signed',
    "with this workspace's export key. Compare the fingerprint with the one in",
    'Settings > Audit of the lab that exported the pack.',
    '',
  ].join('\n')
}

export async function buildValidationPack(
  input: PackInput,
): Promise<Uint8Array> {
  const writer = new ZipWriter()
  const latest = input.runs[0]
  writer.add('README.md', readme(input))
  writer.add(
    'system.json',
    JSON.stringify(
      {
        appVersion: input.appVersion,
        migration: input.migration,
        generatedAt: input.generatedAt,
        ...input.system,
      },
      null,
      2,
    ),
  )
  writer.add('requirements.csv', requirementsCsv())
  writer.add('trace.csv', traceCsv())
  writer.add('trace.md', traceMarkdown(latest))
  writer.add('protocol.md', protocolMarkdown(input))

  for (const run of input.runs) {
    writer.add(`runs/${run.id}.json`, JSON.stringify(run, null, 2))
    writer.add(`runs/${run.id}.md`, runMarkdown(run))
  }

  writer.add('public-key.pem', input.publicKeyPem)
  writer.add('verify.mjs', VERIFY_MJS)
  writer.add('verify.sh', VERIFY_SH)
  writer.add('checksums.sha256', await checksumLines(writer))

  const files = writer.entries().map(([path, data]) => ({
    path,
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
  }))

  const manifest = new TextEncoder().encode(
    JSON.stringify(
      {
        format: PACK_FORMAT,
        generatedAt: input.generatedAt,
        keyAlgorithm: 'ed25519',
        keyFingerprint: input.fingerprint,
        timestamps: [],
        files,
      },
      null,
      2,
    ),
  )

  writer.add('manifest.json', manifest)
  writer.add('manifest.sig', input.sign(manifest))

  return writer.stream()
}
