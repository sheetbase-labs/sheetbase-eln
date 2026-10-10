import { describe, expect, it } from 'vitest'

import { buildLabelLines, labelQrPayload } from './labels'

describe('labelQrPayload', () => {
  it('builds the DEC-10 payload a printed code carries', () => {
    expect(labelQrPayload('app.sheetbase.co.uk', 'SMP-2231')).toBe(
      'https://app.sheetbase.co.uk/r/SMP-2231',
    )
  })

  it('adds the scheme to a bare host and keeps an explicit one', () => {
    expect(labelQrPayload('localhost:3000', 'TB-02')).toBe(
      'https://localhost:3000/r/TB-02',
    )
    expect(labelQrPayload('http://localhost:3000/', 'TB-02')).toBe(
      'http://localhost:3000/r/TB-02',
    )
  })

  it('encodes an identifier that would otherwise break the path', () => {
    expect(labelQrPayload('h.test', 'LOT 7/2')).toBe(
      'https://h.test/r/LOT%207%2F2',
    )
  })

  it('refuses to build a payload with no host', () => {
    expect(() => labelQrPayload('  ', 'SMP-1')).toThrow()
  })
})

describe('buildLabelLines', () => {
  it('carries the identifier, the lot and the storage line together', () => {
    expect(
      buildLabelLines({
        identifier: 'SMP-2231',
        lot: 'HL-0934',
        condition: '2–8 °C',
        useBy: '04-Oct',
      }),
    ).toEqual([
      { kind: 'identifier', text: 'SMP-2231' },
      { kind: 'lot', text: 'HL-0934' },
      { kind: 'storage', text: '2–8 °C · use by 04-Oct' },
    ])
  })

  it('prints a use-by date on its own when no condition is recorded', () => {
    expect(buildLabelLines({ identifier: 'SMP-2', useBy: '04-Oct' })).toEqual([
      { kind: 'identifier', text: 'SMP-2' },
      { kind: 'storage', text: 'use by 04-Oct' },
    ])
  })

  it('omits lines the record does not carry rather than inventing them', () => {
    expect(buildLabelLines({ identifier: 'SMP-3' })).toEqual([
      { kind: 'identifier', text: 'SMP-3' },
    ])
    expect(
      buildLabelLines({ identifier: 'SMP-3', lot: '   ', condition: '' }),
    ).toEqual([{ kind: 'identifier', text: 'SMP-3' }])
  })
})
