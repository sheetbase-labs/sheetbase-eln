import { describe, expect, it, vi } from 'vitest'
import {
  decodeScientificValue,
  fetchScientificDependencies,
  fetchScientificFormulas,
  scientificQueryKeys,
} from './scientific-sheet-data'
import type { ScientificColumnWire } from './scientific-sheet-data'

const column = (
  logical_type: ScientificColumnWire['logical_type'],
  extra: Partial<ScientificColumnWire> = {},
): ScientificColumnWire => ({
  id: '00000000-0000-4000-8000-000000000001',
  field_name: 'col_a',
  label: 'Value',
  display_order: 1,
  logical_type,
  nullable: true,
  unit: null,
  validation: {},
  width: null,
  options: [],
  ...extra,
})

describe('scientific sheet codecs', () => {
  it('strictly converts every logical type and category labels', () => {
    expect(decodeScientificValue(column('text'), 12)).toBe('12')
    expect(decodeScientificValue(column('integer'), '-12')).toBe(-12)
    expect(decodeScientificValue(column('decimal'), '1.25')).toBe(1.25)
    expect(decodeScientificValue(column('boolean'), 'false')).toBe(false)
    expect(decodeScientificValue(column('date'), '2024-02-29')).toBe(
      '2024-02-29',
    )
    expect(
      decodeScientificValue(column('timestamp'), '2024-01-01T12:00:00Z'),
    ).toBe('2024-01-01T12:00:00Z')
    expect(
      decodeScientificValue(
        column('category', {
          options: [{ id: 'option-id', label: 'Control', display_order: 1 }],
        }),
        'Control',
      ),
    ).toBe('option-id')
    expect(decodeScientificValue(column('text'), '')).toBeNull()
  })

  it.each([
    ['integer', '1x'],
    ['integer', '1.2'],
    ['decimal', 'Infinity'],
    ['boolean', 'yes'],
    ['category', 'missing'],
    ['date', '2023-02-29'],
    ['timestamp', 'today'],
  ] as const)('rejects invalid %s values', (type, value) =>
    expect(() => decodeScientificValue(column(type), value)).toThrow(),
  )

  it('enforces nullability and metadata constraints', () => {
    expect(() =>
      decodeScientificValue(column('text', { nullable: false }), null),
    ).toThrow(/required/)
    expect(() =>
      decodeScientificValue(
        column('decimal', { validation: { min: 2, max: 4 } }),
        1,
      ),
    ).toThrow(/minimum/)
    expect(() =>
      decodeScientificValue(
        column('text', {
          validation: { minLength: 2, maxLength: 4, pattern: '^[A-Z]+$' },
        }),
        'a',
      ),
    ).toThrow()
  })

  it('keys deterministic pages below the SSE-compatible prefix', () => {
    expect(scientificQueryKeys.rows('table', 3)).toEqual([
      'scientific-rows',
      'table',
      3,
    ])
  })

  it('loads every formula page instead of treating a capped response as complete', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({
      id: `formula-${index}`,
    }))
    const list = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ id: 'formula-1000' }])
    const result = await fetchScientificFormulas(
      { list } as never,
      '10000000-0000-4000-8000-000000000001',
    )
    expect(result).toHaveLength(1001)
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1][1]).toContain('offset=1000')
  })

  it('loads every source dependency page for schema-change explanations', async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({
      formula_id: `formula-${index}`,
    }))
    const list = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ formula_id: 'formula-1000' }])
    const result = await fetchScientificDependencies(
      { list } as never,
      '10000000-0000-4000-8000-000000000001',
    )
    expect(result).toHaveLength(1001)
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1][1]).toContain('offset=1000')
  })
})
