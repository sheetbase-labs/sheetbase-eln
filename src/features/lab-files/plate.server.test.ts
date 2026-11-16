import { describe, expect, it } from 'vitest'

import { chatAttachmentSchema } from '#/lib/assistant-attachments'
import type { ChatAttachment } from '#/lib/assistant-attachments'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'

import { PLATE_FROM_FILE_TOOL } from './plate'
import type { PlateFromFileAction } from './plate'
import { buildLabFilesProposal, expandWells, plateRows } from './plate.server'

/** A 96-well grid under a reader's header block. */
function readerGrid(): string[][] {
  const header = ['', ...Array.from({ length: 12 }, (_, i) => String(i + 1))]

  const body = 'ABCDEFGH'
    .split('')
    .map((row, r) => [
      row,
      ...Array.from({ length: 12 }, (_, c) => String((r + 1) * 0.1 + c * 0.01)),
    ])

  return [
    ['Plate Reader Export'],
    ['Protocol', 'PicoGreen'],
    [],
    header,
    ...body,
    [],
    ['End'],
  ]
}

function file(rows: string[][]): ChatAttachment {
  return chatAttachmentSchema.parse({
    id: '00000000-0000-4000-8000-000000000009',
    name: 'picogreen.xlsx',
    mediaType: 'application/vnd.ms-excel',
    bytes: 1,
    kind: 'table',
    sheets: [{ name: 'Plate 1', rows }],
  })
}

const context = (files: ChatAttachment[]): LabToolContext => ({
  // The plate card reads only the chat's files.
  // SAFETY: the plate card reads only the chat's files and never touches the client.
  client: undefined as never,
  workspaceId: '00000000-0000-4000-8000-0000000000aa',
  userId: '00000000-0000-4000-8000-0000000000bb',
  timeZone: 'UTC',
  attachments: files,
})

const base = {
  title: 'Make plate run',
  summary: 'From the export',
  file: 'F1',
  name: 'PicoGreen plate 1',
}

describe('expandWells', () => {
  it('expands a single well and a rectangle', () => {
    expect(expandWells('a1')).toEqual(['A1'])
    expect(expandWells('A1:B2')).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(expandWells('B2:A1')).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(expandWells('H1:H12')).toHaveLength(12)
  })

  it('refuses nonsense', () => {
    expect(expandWells('A1:B2:C3')).toBeNull()
    expect(expandWells('Z')).toBeNull()
    expect(expandWells('A0')).toBeNull()
  })
})

describe('plateRows', () => {
  it('finds the grid under the header block and stops at the blank line', () => {
    const rows = plateRows(readerGrid())

    expect(rows).toHaveLength(9)
    expect(rows[0].slice(1)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ])
    expect(rows.at(-1)?.[0]).toBe('H')
  })

  it('takes a plate from a given row', () => {
    const rows = plateRows(readerGrid(), 4, 6)

    expect(rows).toHaveLength(3)
  })

  it('finds a list with a well column', () => {
    const rows = plateRows([
      ['Name', 'Run 7'],
      ['Well', 'Value'],
      ['A1', '0.1'],
      ['A2', '0.2'],
      [],
      ['trailer'],
    ])

    expect(rows).toHaveLength(3)
  })

  it('finds nothing in a sheet that has no plate', () => {
    expect(
      plateRows([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toEqual([])
  })
})

describe('buildLabFilesProposal', () => {
  it('builds a card from the file, with the file’s own numbers', async () => {
    const outcome = await buildLabFilesProposal(
      PLATE_FROM_FILE_TOOL,
      {
        ...base,
        roles: [
          { role: 'positive_control', wells: ['A1:H1'] },
          { role: 'negative_control', wells: ['A12:H12'] },
          { role: 'blank', wells: ['A2'] },
        ],
        analyse: true,
      },
      context([file(readerGrid())]),
    )

    expect(outcome.ok).toBe(true)

    if (!outcome.ok) return
    // SAFETY: a card built by this tool always carries a plate.from_file action.
    const action = outcome.proposal.action as PlateFromFileAction

    expect(action.kind).toBe('plate.from_file')
    expect(action.format).toBe('96_well')
    expect(action.wells).toHaveLength(96)
    expect(action.readout.A1).toBeCloseTo(0.1)
    expect(action.readout.H12).toBeCloseTo(0.91)
    expect(action.wells.find((w) => w.wellCode === 'A1')?.role).toBe(
      'positive_control',
    )
    expect(action.wells.find((w) => w.wellCode === 'A2')?.role).toBe('blank')
    expect(action.wells.find((w) => w.wellCode === 'B5')?.role).toBe('sample')
    expect(action.analyse).toBe(true)
    expect(outcome.proposal.changes.map((c) => c.label)).toContain('Source')
  })

  it('does not analyse without controls, even when asked', async () => {
    const outcome = await buildLabFilesProposal(
      PLATE_FROM_FILE_TOOL,
      { ...base, analyse: true },
      context([file(readerGrid())]),
    )

    expect(
      // SAFETY: a card built by this tool always carries a plate.from_file action.
      outcome.ok && (outcome.proposal.action as PlateFromFileAction).analyse,
    ).toBe(false)
  })

  it('says so when no file is attached', async () => {
    const outcome = await buildLabFilesProposal(
      PLATE_FROM_FILE_TOOL,
      base,
      context([]),
    )

    expect(outcome).toMatchObject({ ok: false })
    expect(!outcome.ok && outcome.message).toContain('No files are attached')
  })

  it('refuses a document and a well that is not on the plate', async () => {
    const doc = chatAttachmentSchema.parse({
      id: '00000000-0000-4000-8000-00000000000a',
      name: 'datasheet.pdf',
      mediaType: 'application/pdf',
      bytes: 1,
      kind: 'document',
      text: 'text',
    })

    expect(
      (await buildLabFilesProposal(PLATE_FROM_FILE_TOOL, base, context([doc])))
        .ok,
    ).toBe(false)

    const small = file(plateRows(readerGrid(), 4, 6))

    const outside = await buildLabFilesProposal(
      PLATE_FROM_FILE_TOOL,
      { ...base, roles: [{ role: 'blank', wells: ['H12'] }] },
      context([small]),
    )

    expect(!outside.ok && outside.message).toContain('H12')
  })

  it('refuses a plate with no numbers', async () => {
    const empty = readerGrid().map((row, i) =>
      i > 3 && i < 12 ? [row[0], ...row.slice(1).map(() => '')] : row,
    )

    const outcome = await buildLabFilesProposal(
      PLATE_FROM_FILE_TOOL,
      base,
      context([file(empty)]),
    )

    expect(outcome.ok).toBe(false)
  })

  it('refuses arguments that do not fit', async () => {
    const outcome = await buildLabFilesProposal(
      PLATE_FROM_FILE_TOOL,
      { title: 'x' },
      context([]),
    )

    expect(outcome.ok).toBe(false)
  })
})
