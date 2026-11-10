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
import { z } from 'zod'

import type { ExportRow } from './delimited'
import { ZipWriter } from './zip'

const version = z.union([z.string(), z.number()])

const evidenceSchema = z.looseObject({
  revision: z.looseObject({
    id: z.string(),
    workspaceId: z.string(),
    reason: z.string(),
    structureVersion: version,
    metadataVersion: version,
    integrityAlgorithm: z.string().nullable(),
    integrityDigest: z.string().nullable(),
    supersededByRevisionId: z.string().nullable(),
  }),
  record: z
    .looseObject({
      identifier: z.string().nullable(),
      title: z.string().nullable(),
      kind: z.string().nullable(),
      status: z.string().nullable(),
    })
    .nullable()
    .optional(),
  blockSnapshot: z.unknown(),
  sheetEvidence: z.array(
    z.looseObject({
      blockId: z.string(),
      instanceState: z.record(z.string(), z.unknown()).nullable().optional(),
      composedGrid: z.unknown().optional(),
    }),
  ),
  files: z.array(
    z.looseObject({
      fileObjectId: z.string(),
      fileRecordId: z.string(),
      storageKey: z.string(),
      storageBackend: z.string(),
      checksumAlgorithm: z.string(),
      checksum: z.string(),
      byteSize: version,
    }),
  ),
  signatures: z.array(z.unknown()),
})

export type EvidencePackageInput = z.infer<typeof evidenceSchema>

// Keep the original object and key order: it is written verbatim as evidence.json.
const evidenceInput = z.custom<EvidencePackageInput>(
  (input) => evidenceSchema.safeParse(input).success,
)

// This is the external RPC/input boundary; validate before rendering evidence.
// oxlint-disable-next-line anti-slop/no-unknown-parameters
export function parseEvidencePackage(input: unknown): EvidencePackageInput {
  return evidenceInput.parse(input)
}

function csvEscape(text: string | number | null): string {
  if (text === null) text = ''
  text = String(text)

  return `"${text.replaceAll('"', '""')}"`
}

/** Frozen grid columns/rows rendered from composed_grid or instance state. */
function gridForEvidence(
  evidence: EvidencePackageInput['sheetEvidence'][number],
) {
  // Legacy rendering reads the original grid without reconstructing it.
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
  const grid = evidence.composedGrid as {
    columns?: Array<{ id?: unknown; label?: unknown }>
    rows?: unknown
  } | null

  if (
    grid &&
    Array.isArray(grid.columns) &&
    grid.columns.length > 0 &&
    // Preserve the original validity check and each native getter read.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof
    grid.columns.every((c) => typeof c.id === 'string')
  ) {
    const headers = grid.columns.map((c) =>
      // Preserve repeated native label reads and the original fallback.
      // oxlint-disable-next-line anti-slop/no-runtime-typeof
      typeof c.label === 'string' && c.label.trim() ? c.label : 'Column',
    )

    const rows = (Array.isArray(grid.rows) ? grid.rows : []).map((row) =>
      Array.isArray(row)
        ? row.map((cell) =>
            cell === null || cell === undefined
              ? ''
              : // Objects, including cross-realm values, retain JSON rendering.
                // oxlint-disable-next-line anti-slop/no-runtime-typeof
                typeof cell === 'object'
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
        (f): f is { fieldId: string; label?: unknown } =>
          // Legacy membership accepts inherited fields and keeps getter order.
          // oxlint-disable-next-line anti-slop/no-runtime-typeof
          Boolean(f) && typeof f === 'object' && typeof f.fieldId === 'string',
      )
    : []

  const headers = localFields.map((f) =>
    // Preserve repeated label and field ID reads on the original object.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof
    typeof f.label === 'string' ? f.label : String(f.fieldId),
  )

  const ids = localFields.map((f) => String(f.fieldId))

  const localValues =
    // The fallback accepts native objects and arrays without reconstruction.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof
    state.localValues && typeof state.localValues === 'object'
      ? // The legacy renderer reads original rows directly; they are not validated here.
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
        (state.localValues as Record<string, ExportRow['values']>)
      : {}

  const rows = Object.values(localValues).map((row) =>
    ids.map((id) => {
      const value = row[id]

      return value === null || value === undefined
        ? ''
        : // Objects, including cross-realm values, retain JSON rendering.
          // oxlint-disable-next-line anti-slop/no-runtime-typeof
          typeof value === 'object'
          ? JSON.stringify(value)
          : // Other native values retain JavaScript string coercion.
            // oxlint-disable-next-line typescript/no-base-to-string
            String(value)
    }),
  )

  return { headers, rows }
}

/** The evidence, readme, grids and file manifest, added to an archive. */
export function addEvidenceEntries(
  writer: ZipWriter,
  input: EvidencePackageInput,
): void {
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
}

export async function buildEvidencePackage(
  input: EvidencePackageInput,
): Promise<Uint8Array> {
  const writer = new ZipWriter()
  addEvidenceEntries(writer, input)

  // sha256sum -c compatible manifest over every other entry in the archive.
  const checksums = await checksumLines(writer)
  writer.add('checksums.sha256', checksums)

  return writer.stream()
}

function headerLine(headers: string[]): string {
  return headers.map(csvEscape).join(',')
}

export async function checksumLines(writer: ZipWriter): Promise<string> {
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
