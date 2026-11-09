import { describe, expect, it } from 'vitest'

import { buildLabelLines } from '#/lib/labels'
import {
  hazardStatementText,
  isHazardous,
  knownHazardCodes,
  materialIdsFromBlocks,
  toMaterialSafety,
} from '#/lib/material-safety'

describe('material safety', () => {
  it('words every known hazard code and falls back to the bare code', () => {
    for (const code of knownHazardCodes()) {
      expect(hazardStatementText(code)).not.toBe(code)
    }

    expect(hazardStatementText('H999')).toBe('H999')
  })

  it('projects a row and says whether it warns of anything', () => {
    const empty = toMaterialSafety({
      record_id: 'a',
      pictograms: null,
      signal_word: null,
      hazard_statements: null,
      sds_file_object_id: null,
      updated_at: '2026-11-04T00:00:00Z',
      sds: null,
    })

    expect(isHazardous(empty)).toBe(false)

    const flagged = toMaterialSafety({
      record_id: 'b',
      pictograms: ['GHS02', 'nonsense'],
      signal_word: 'danger',
      hazard_statements: ['H225'],
      sds_file_object_id: 'f',
      updated_at: '2026-11-04T00:00:00Z',
      sds: { id: 'f', record_id: 'r', display_name: 'SDS.pdf' },
    })

    expect(flagged.pictograms).toEqual(['GHS02'])
    expect(flagged.sheet?.name).toBe('SDS.pdf')
    expect(isHazardous(flagged)).toBe(true)
  })

  it('reads material ids from materials blocks', () => {
    expect(
      materialIdsFromBlocks([
        { type: 'rich_text', payload: {} },
        { type: 'materials', payload: { items: [{ materialRecordId: 'm1' }] } },
      ]),
    ).toEqual(['m1'])
  })

  it('puts the signal word on a label', () => {
    const lines = buildLabelLines({ identifier: 'MAT-1', signalWord: 'Danger' })
    expect(lines.at(-1)).toEqual({ kind: 'signal', text: 'DANGER' })
  })
})
