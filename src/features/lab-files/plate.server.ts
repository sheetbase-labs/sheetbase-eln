import { findAttachment } from '#/lib/assistant-attachments'
import type { ChatAttachment } from '#/lib/assistant-attachments'
import { invalid } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import { parsePlateTable } from '#/lib/plate-assay'
import type { AssayWell } from '#/lib/plate-assay'
import { parseWellCode, wellCode } from '#/lib/plate-map'
import type { AssignmentRole } from '#/lib/plate-map'

import { PLATE_FROM_FILE_TOOL, proposePlateFromFileSchema } from './plate'
import type { PlateFromFileAction } from './plate'

export type LabFilesOutcome =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

const fail = (message: string): LabFilesOutcome => ({ ok: false, message })

/** Well codes of a rectangle ("A1:B3") or a single well ("C5"), upper case. */
export function expandWells(spec: string): string[] | null {
  const [from, to, ...extra] = spec.trim().split(':')

  if (extra.length > 0) return null
  const a = parseWellCode(from.trim().toUpperCase())

  if (!a) return null

  if (to === undefined) return [wellCode(a.row, a.col)]
  const b = parseWellCode(to.trim().toUpperCase())

  if (!b) return null
  const codes: string[] = []

  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++) {
    for (
      let col = Math.min(a.col, b.col);
      col <= Math.max(a.col, b.col);
      col++
    ) {
      codes.push(wellCode(row, col))
    }
  }

  return codes
}

const isGridHeader = (row: string[]): boolean => {
  const cells = row.slice(1).map((c) => c.trim())
  const numbers = cells.filter((c) => c !== '')

  return (
    numbers.length >= 3 &&
    numbers.every((c, i) => /^\d+$/.test(c) && Number(c) === i + 1)
  )
}

const isListHeader = (row: string[]): boolean =>
  row.some((c) =>
    ['well', 'wellcode', 'position', 'wellposition'].includes(
      c.toLowerCase().replaceAll(/[\s_-]+/g, ''),
    ),
  )

/**
 * The rows of one plate from a sheet. A reader's export has a header block
 * before the plate and sometimes several plates, so with no row given the
 * first grid (a row of column numbers, then rows labelled A, B ...) or the
 * first list with a well column is taken.
 */
export function plateRows(
  rows: string[][],
  startRow?: number,
  endRow?: number,
): string[][] {
  let start = startRow === undefined ? -1 : startRow - 1

  if (start < 0) {
    start = rows.findIndex((row) => isGridHeader(row) || isListHeader(row))

    if (start < 0) return []
  }

  const header = rows[start]

  if (!header) return []

  if (isListHeader(header) && !isGridHeader(header)) {
    const stop = endRow ?? rows.length
    const body: string[][] = []

    for (const row of rows.slice(start + 1, stop)) {
      if (row.every((c) => c.trim() === '')) break
      body.push(row)
    }

    return [header, ...body]
  }

  // A grid: the rows under the header that start with a row letter.
  const body: string[][] = []
  const stop = endRow ?? rows.length

  for (const row of rows.slice(start + 1, stop)) {
    if (!/^[A-Za-z]{1,2}$/.test((row[0] ?? '').trim())) break
    body.push(row.slice(0, header.length))
  }

  return [header.map((c, i) => (i === 0 ? '' : c.trim())), ...body]
}

function tsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((c) => c.replaceAll(/[\t\r\n]/g, ' ')).join('\t'))
    .join('\n')
}

export async function buildLabFilesProposal(
  name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The model's tool call arrives as JSON; it is parsed with the tool's schema first.
  args: unknown,
  context: LabToolContext,
): Promise<LabFilesOutcome> {
  if (name !== PLATE_FROM_FILE_TOOL) return fail('Unknown tool.')
  const parsed = proposePlateFromFileSchema.safeParse(args)

  if (!parsed.success) return fail(invalid(parsed.error))
  const input = parsed.data
  const files: ChatAttachment[] = context.attachments ?? []
  const file = findAttachment(files, input.file)

  if (!file) {
    return fail(
      files.length === 0
        ? 'No files are attached to this chat. Ask the person to attach the export.'
        : `No attached file matches "${input.file}".`,
    )
  }

  if (file.kind !== 'table') {
    return fail(
      'That file is not a spreadsheet. A plate reader export is a CSV, TSV or XLSX file.',
    )
  }

  const sheet =
    input.sheet === undefined
      ? file.sheets[0]
      : file.sheets.find(
          (s) => s.name.toLowerCase() === input.sheet?.toLowerCase(),
        )

  if (!sheet) {
    return fail(
      `No sheet named "${input.sheet ?? ''}". The sheets are: ${file.sheets.map((s) => `"${s.name}"`).join(', ')}.`,
    )
  }

  const region = plateRows(sheet.rows, input.startRow, input.endRow)

  if (region.length < 2) {
    return fail(
      'No plate was found in that sheet. A plate is a grid (a row of column numbers 1, 2, 3 ... then rows A, B, C ...) or a list with a well column. Read the sheet, find the row it starts on and pass startRow.',
    )
  }

  const table = parsePlateTable(tsv(region))

  if (table.wells.length === 0) {
    return fail(
      'The plate could not be read from those rows. Check startRow and endRow with a read of the sheet.',
    )
  }

  if (!table.format) {
    return fail('The wells do not fit a standard plate (6 to 1536 wells).')
  }

  const readings = Object.values(table.readout).filter((v) => v !== null).length

  if (readings === 0) {
    return fail(
      'The plate has no numbers in it. Check which rows hold the readings.',
    )
  }

  const byCode = new Map<string, AssayWell>(
    table.wells.map((well) => [well.wellCode, well]),
  )

  const roleCounts = new Map<AssignmentRole, number>()

  for (const entry of input.roles ?? []) {
    for (const spec of entry.wells) {
      const codes = expandWells(spec)

      if (!codes) {
        return fail(
          `"${spec}" is not a well or a range of wells such as A1:A12.`,
        )
      }

      for (const code of codes) {
        const well = byCode.get(code)

        if (!well) {
          return fail(`Well ${code} is not on the plate that was read.`)
        }

        well.role = entry.role
        well.sampleLabel = null
        roleCounts.set(entry.role, (roleCounts.get(entry.role) ?? 0) + 1)
      }
    }
  }

  const controls =
    (roleCounts.get('positive_control') ?? 0) +
    (roleCounts.get('negative_control') ?? 0)

  const analyse = input.analyse === true && controls > 0

  const action: PlateFromFileAction = {
    kind: 'plate.from_file',
    name: input.name,
    format: table.format,
    wells: table.wells,
    readout: table.readout,
    analyse,
  }

  const counts = [...roleCounts.entries()]
    .map(([role, n]) => `${n} ${role.replaceAll('_', ' ')}`)
    .join(', ')

  const values = Object.values(table.readout).filter(
    (v): v is number => v !== null,
  )

  return {
    ok: true,
    proposal: {
      tool: PLATE_FROM_FILE_TOOL,
      title: input.title,
      summary: input.summary,
      target: `${input.name} · Plates`,
      deepLink: null,
      changes: [
        { label: 'Source', before: null, after: file.name },
        {
          label: 'Plate',
          before: null,
          after: `${table.format.replace('_well', '')}-well, ${readings} readings (${Math.min(...values)} to ${Math.max(...values)})`,
        },
        {
          label: 'Wells',
          before: null,
          after: counts === '' ? 'All samples' : `${counts}, the rest samples`,
        },
        {
          label: 'Analysis',
          before: null,
          after: analyse ? 'Run against the controls' : 'Not yet',
        },
        ...table.warnings.slice(0, 3).map((warning) => ({
          label: 'Note',
          before: null,
          after: warning.replaceAll('_', ' '),
        })),
      ],
      action,
    },
  }
}
