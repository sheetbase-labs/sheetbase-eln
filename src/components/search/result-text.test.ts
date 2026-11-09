import { describe, expect, it } from 'vitest'
import {
  searchResultContext,
  searchResultLabel,
  searchResultParentLine,
} from './result-text'

const project = {
  recordId: '0b6f0c6e-0000-4000-8000-000000000205',
  identifier: 'ambr-250-perfusion-scale-down',
  title: 'Ambr 250 perfusion scale-down',
}

describe('searchResultContext', () => {
  it('reads an empty cell as one dash, not two', () => {
    const row = {
      recordId: '0b6f0c6e-0000-4000-8000-000000000999',
      identifier: 'DS-1',
      title: 'ELISA',
    }

    const text = searchResultContext(
      row,
      '<b>plate</b> PR-01 — — Duplicate standards',
    )
      .map((segment) => segment.text)
      .join('')

    expect(text).toBe('plate PR-01 — Duplicate standards')
  })

  it('leaves no dangling dash where the row id was dropped', () => {
    const report = {
      recordId: '0b6f0c6e-0000-4000-8000-000000000301',
      identifier: 'RPT-2026-0001',
      title: 'Virus Stability Study Report',
    }

    const text = (context: string) =>
      searchResultContext(report, context)
        .map((segment) => segment.text)
        .join('')

    // Only the title is left once the id goes, so the snippet says nothing.
    expect(text('<b>Virus</b> Stability Study Report — RPT-2026-0001')).toBe('')
    expect(text('RPT-2026-0001 — <b>Virus</b> titre falls by day 14')).toBe(
      'Virus titre falls by day 14',
    )
  })

  it('drops the title it sits beside and keeps what follows', () => {
    const experiment = {
      recordId: '0b6f0c6e-0000-4000-8000-000000000101',
      identifier: 'EXP-2025-0001',
      title: 'Virus Stability at 4°C',
    }

    expect(
      searchResultContext(
        experiment,
        '<b>Virus</b> Stability at 4°C — Objective Evaluate LVV-CAR-T',
      ),
    ).toEqual([{ text: 'Objective Evaluate LVV-CAR-T', highlighted: false }])
  })

  it('says nothing when the snippet only repeats the title and the row id', () => {
    expect(
      searchResultContext(
        project,
        '<b>Ambr</b> 250 perfusion scale-down ambr-250-perfusion-scale-down',
      ),
    ).toEqual([])
  })

  it('cuts the machine key out of a snippet even when the match splits it', () => {
    const segments = searchResultContext(
      {
        recordId: 'p-1',
        identifier: 'PL-0003',
        title: 'Ambr 250 daily import check',
      },
      '<b>Ambr</b> 250 daily import check <b>ambr</b>_250_daily_import_check',
    )

    expect(segments).toEqual([])
  })

  it('keeps a description that follows the key', () => {
    const segments = searchResultContext(
      { recordId: 'p-1', identifier: 'PL-0003', title: 'AEX screen summary' },
      'AEX screen summary aex_screen_summary Summarises the <b>fraction</b> screen',
    )

    expect(segments.map((s) => s.text).join('')).toBe(
      'AEX screen summary  Summarises the fraction screen',
    )
  })

  it('drops the row id but keeps the words that matched elsewhere', () => {
    const segments = searchResultContext(
      { recordId: 'x-1', identifier: 'SMP-2248', title: 'C-150 filtrate' },
      'SMP-2248 box 14, <b>filtrate</b> A9',
    )

    expect(segments.map((s) => s.text).join('')).toBe(' box 14, filtrate A9')
    expect(segments.some((s) => s.highlighted)).toBe(true)
  })
})

describe('searchResultLabel', () => {
  it('leads with the identifier a person can quote', () => {
    expect(searchResultLabel({ ...project, identifier: 'PRJ-0205' })).toBe(
      'PRJ-0205',
    )
  })
})

describe('searchResultParentLine', () => {
  it('names the attached file a notebook was found through', () => {
    expect(
      searchResultParentLine({
        resultType: 'record',
        parentTitle: '',
        matchedFileName: 'plate-reader.xlsx',
      }),
    ).toBe('In plate-reader.xlsx')
  })

  it('says nothing for a hit that is the thing itself', () => {
    expect(
      searchResultParentLine({
        resultType: 'record',
        parentTitle: '',
        matchedFileName: '',
      }),
    ).toBeNull()
  })
})
