/**
 * DATA-02 Notebook/revision evidence package.
 *
 * Bundles the canonical output of api.revision_evidence_package into a
 * deterministic ZIP that a reviewer can read without knowing Sheetbase's
 * internal tables:
 *
 *   README.md                    how to read the package
 *   evidence.json                full machine-readable evidence document
 *   grids/<blockId>.csv          frozen Sheet grids (composed_grid or state)
 *   files/files-manifest.csv     pinned attachments with sha256 checksums
 *
 * Determinism: every byte derives from revision content; no wall-clock
 * timestamps are embedded.
 */
import { ZipWriter } from './zip'

export interface EvidencePackageInput {
  revision: {
    id: string
    recordId: string
    workspaceId: string
    reason: string
    structureVersion: number | string
    metadataVersion: number | string
    integrityAlgorithm: string | null
    integrityDigest: string | null
    supersededByRevisionId: string | null
    createdAt: string
    createdByUserId: string | null
  }
  record?: {
    identifier: string
    title: string
    kind: string
    status: string
  } | null
  metadataSnapshot: unknown
  blockSnapshot: unknown
  canonicalSnapshot: unknown
  sheetEvidence: Array<{
    blockId: string
    instanceId: string
    sourceDefinitionVersionId: string | null
    instanceRevision: number | string
    instanceState: Record<string, unknown> | null
    composedGrid: unknown
    datasetVersions: unknown
    createdAt?: string
  }>
  files: Array<{
    fileObjectId: string
    fileRecordId: string
    storageKey: string
    storageBackend: string
    checksumAlgorithm: string
    checksum: string
    byteSize: number | string
  }>
  submission: unknown
  decisions: unknown[]
  checkResults: unknown[]
  signatures: unknown[]
  comments: unknown[]
}

function csvEscape(text: string | number | null): string {
  if (text === null) text = ''
  text = String(text)
  return `"${text.replaceAll('"', '""')}"`
}

/** Frozen grid columns/rows rendered from composed_grid or instance state. */
function gridForEvidence(
  evidence: EvidencePackageInput['sheetEvidence'][number],
): {
  headers: string[]
  rows: string[][]
} {
  const grid = evidence.composedGrid as {
    columns?: Array<{ id?: unknown; label?: unknown }>
    rows?: unknown
  } | null
  if (
    grid &&
    Array.isArray(grid.columns) &&
    grid.columns.length > 0 &&
    grid.columns.every((c) => typeof c.id === 'string')
  ) {
    const headers = grid.columns.map((c) =>
      typeof c.label === 'string' && c.label.trim() ? c.label : 'Column',
    )
    const rows = (Array.isArray(grid.rows) ? grid.rows : []).map((row) =>
      Array.isArray(row)
        ? row.map((cell) =>
            cell === null || cell === undefined
              ? ''
              : typeof cell === 'object'
                ? JSON.stringify(cell)
                : String(cell),
          )
        : headers.map(() => ''),
    )
    return { headers, rows }
  }

  // Fall back to frozen local fields/values from the pinned instance state,
  // mirroring the historical render used by the review surface.
  const state = evidence.instanceState ?? {}
  const localFields = Array.isArray(state.localFields)
    ? state.localFields.filter(
        (f): f is Record<string, unknown> =>
          Boolean(f) && typeof f === 'object' && typeof f.fieldId === 'string',
      )
    : []
  const headers = localFields.map((f) =>
    typeof f.label === 'string' ? f.label : String(f.fieldId),
  )
  const ids = localFields.map((f) => String(f.fieldId))
  const localValues =
    state.localValues && typeof state.localValues === 'object'
      ? (state.localValues as Record<string, Record<string, unknown>>)
      : {}
  const rows = Object.values(localValues).map((row) =>
    ids.map((id) => {
      const value = row[id]
      return value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)
    }),
  )
  return { headers, rows }
}

export async function buildEvidencePackage(
  input: EvidencePackageInput,
): Promise<Uint8Array> {
  const writer = new ZipWriter()

  writer.add('evidence.json', JSON.stringify(input, null, 2))

  writer.add('README.md', readme(input))

  for (const item of input.sheetEvidence) {
    const { headers, rows } = gridForEvidence(item)
    const lines = [headerLine(headers)]
    for (const row of rows) {
      lines.push(row.map(csvEscape).join(','))
    }
    writer.add(`grids/${item.blockId}.csv`, lines.join('\r\n') + '\r\n')
  }

  if (input.files.length > 0) {
    const manifest = [
      headerLine([
        'fileObjectId',
        'fileRecordId',
        'storageKey',
        'storageBackend',
        'checksumAlgorithm',
        'checksum',
        'byteSize',
      ]),
      ...input.files.map((f) =>
        [
          f.fileObjectId,
          f.fileRecordId,
          f.storageKey,
          f.storageBackend,
          f.checksumAlgorithm,
          f.checksum,
          f.byteSize,
        ]
          .map(csvEscape)
          .join(','),
      ),
    ].join('\r\n')
    writer.add('files/files-manifest.csv', manifest + '\r\n')
  }

  // sha256sum -c compatible manifest over every other entry in the archive.
  const checksums = await checksumLines(writer)
  writer.add('checksums.sha256', checksums)

  return writer.stream()
}

function headerLine(headers: string[]): string {
  return headers.map(csvEscape).join(',')
}

async function checksumLines(writer: ZipWriter): Promise<string> {
  const { createHash } = await import('node:crypto')
  const entries = writer.entries()
  const lines: string[] = []
  for (const [name, data] of entries) {
    const digest = createHash('sha256').update(data).digest('hex')
    lines.push(`${digest}  ${name}`)
  }
  return lines.join('\n') + '\n'
}

function readme(input: EvidencePackageInput): string {
  const lines: string[] = []
  lines.push('# Sheetbase submitted-evidence package', '')
  lines.push(
    'This package is an export of one submitted Notebook revision.',
    'The submitted revision is immutable evidence; live records, Sheets and',
    'Datasets may have changed since submission and do not affect this package.',
    '',
  )
  if (input.record) {
    lines.push(
      `- Record: ${input.record.identifier} — ${input.record.title}`,
      `- Kind/status: ${input.record.kind} / ${input.record.status}`,
    )
  }
  lines.push(
    `- Revision id: ${input.revision.id}`,
    `- Reason captured: ${input.revision.reason}`,
    `- Structure/metadata versions: ${input.revision.structureVersion}/${input.revision.metadataVersion}`,
    `- Integrity: ${input.revision.integrityAlgorithm ?? 'sha256'} ${input.revision.integrityDigest ?? '(no digest)'}`,
  )
  if (input.revision.supersededByRevisionId) {
    lines.push(
      `- Superseded by revision: ${input.revision.supersededByRevisionId}`,
    )
  }
  lines.push('', '## Contents', '')
  lines.push(
    '- `evidence.json` — complete machine-readable evidence document.',
    '- `grids/*.csv` — one CSV per submitted Sheet block (frozen render).',
    input.files.length > 0
      ? '- `files/files-manifest.csv` — attached files with sha256 checksums.'
      : '- No files were attached to this revision.',
    '- `checksums.sha256` — verify with `sha256sum -c checksums.sha256`.',
    '',
    'Review workflow state (submission, decisions, check results, signatures,',
    'comments) is included in evidence.json under the matching keys.',
    'Dataset bindings reference immutable Dataset Versions; their ids are in',
    '`evidence.json` under sheetEvidence[].datasetVersions.',
    '',
  )
  return lines.join('\n')
}
