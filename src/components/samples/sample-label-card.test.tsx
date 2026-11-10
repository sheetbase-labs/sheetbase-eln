import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import QRCode from 'qrcode'

import { SampleLabelCard } from './sample-label-card'
import {
  labelCodeDrawing,
  labelDimensions,
  labelFacts,
} from './label-card-data'
import { encodeCode128 } from '#/lib/barcode128'

afterEach(cleanup)

describe('SampleLabelCard', () => {
  it('renders the label lines from the record and its hold window', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{
          identifier: 'SMP-2231',
          title: 'Harvest lot HL-0934',
          sampleType: 'Cell harvest',
          barcode: 'SMP-LVV-0020',
          customFields: { batch: 'HL-0934' },
          createdAt: '2026-09-20T00:00:00.000Z',
          properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
        }}
      />,
    )
    expect(screen.getByText('SMP-2231')).toBeTruthy()
    expect(screen.getByText('HL-0934')).toBeTruthy()
    expect(screen.getByText('2–8 °C · use by 04-Oct')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Printable label for SMP-2231' }),
    ).toBeTruthy()
  })

  it('encodes the DEC-10 payload so a scan resolves the sample', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{ identifier: 'SMP-2231', customFields: {} }}
      />,
    )

    const code = screen.getByRole('img', {
      name: 'Label code resolving to https://app.sheetbase.test/r/SMP-2231',
    })

    // A real code, not the old fixed decorative pattern.
    const path = code.querySelector('path')
    expect(path?.getAttribute('d')).toBeTruthy()
    expect(path!.getAttribute('d')!.length).toBeGreaterThan(100)
  })

  it('draws no code when there is no host to resolve against', () => {
    render(<SampleLabelCard host="" record={{ identifier: 'SMP-2239' }} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No code')).toBeTruthy()
    expect(screen.getByText('SMP-2239')).toBeTruthy()
  })

  it('omits the storage line when no hold window is recorded', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{ identifier: 'SMP-2232', customFields: {} }}
      />,
    )
    expect(screen.getByText('SMP-2232')).toBeTruthy()
    expect(screen.queryByText(/use by/)).toBeNull()
    expect(screen.queryByText('HL-0934')).toBeNull()
  })

  it('ignores a non-string batch custom field', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{ identifier: 'SMP-2233', customFields: { batch: 42 } }}
      />,
    )
    expect(screen.queryByText('42')).toBeNull()
  })

  it('keeps the identifier authoritative over title and a separate barcode', () => {
    const identifier = ' SMP / α '
    render(
      <SampleLabelCard
        host="x.test"
        record={{ identifier, title: 'Not the identifier', barcode: 'OTHER' }}
      />,
    )

    const code = screen.getByRole('img', {
      name: 'Label code resolving to https://x.test/r/SMP%20%2F%20%CE%B1',
    })

    const expected = QRCode.create('https://x.test/r/SMP%20%2F%20%CE%B1', {
      errorCorrectionLevel: 'M',
    })

    expect(code.getAttribute('viewBox')).toBe(
      `0 0 ${expected.modules.size} ${expected.modules.size}`,
    )
    expect(
      code.querySelector('path')?.getAttribute('d')?.match(/M/g),
    ).toHaveLength(Array.from(expected.modules.data).filter(Boolean).length)
    expect(code.getAttribute('shape-rendering')).toBe('crispEdges')
    expect(screen.queryByText('OTHER')).toBeNull()
    expect(screen.queryByText('Not the identifier')).toBeNull()
  })

  it.each([true, [2], { valueOf: () => 2 }, 2n])(
    'keeps native numeric hold acceptance for %s without parsing unrelated metadata',
    (duration) => {
      const facts = labelFacts(
        {
          identifier: 'SMP-native',
          createdAt: '2026-09-20T00:00:00.000Z',
          properties: {
            holdDurationDays: duration,
            holdCondition: ' cold ',
            unrelated: { value: Infinity, acquiredAt: new Date(), counter: 3n },
          },
          customFields: { batch: ' Lot A ' },
        },
        undefined,
      )

      expect(facts.condition).toBe('cold')
      expect(facts.lot).toBe(' Lot A ')
      expect(facts.useBy).toBe(duration === true ? '21-Sep' : '22-Sep')
      expect(
        labelFacts(
          {
            identifier: 'SMP-native-custom',
            createdAt: '2026-09-20T00:00:00.000Z',
            customFields: {
              holdDurationDays: duration,
              batch: ' Lot A ',
              unrelated: Infinity,
            },
          },
          undefined,
        ),
      ).toMatchObject({ lot: ' Lot A ', useBy: facts.useBy })
    },
  )

  it('uses explicit material facts without inventing sample lot or hold', () => {
    render(
      <SampleLabelCard
        host="x.test"
        record={{
          identifier: 'MAT-1',
          customFields: { batch: 'sample-only' },
          properties: { holdUntil: '2026-10-04' },
        }}
        source={{ sampleType: 'Chemical', signalWord: 'Danger' }}
        template={{ showSampleType: true }}
        hazards={['GHS02']}
      />,
    )
    expect(screen.getByText('Chemical')).toBeTruthy()
    expect(screen.getByText('DANGER')).toBeTruthy()
    expect(screen.queryByText('sample-only')).toBeNull()
    expect(screen.queryByText(/use by/)).toBeNull()
    expect(document.querySelector('[data-slot="label-hazards"]')).toBeTruthy()
  })

  it('reads only the needed metadata and preserves native conversion failures before the lot is read', () => {
    const order: string[] = []

    const record = {
      identifier: 'SMP-getters',
      createdAt: '2026-09-20T00:00:00.000Z',
      properties: {
        get holdUntil() {
          order.push('until')

          return '2026-09-24'
        },
        get holdDurationDays() {
          order.push('duration')

          return Symbol('invalid duration')
        },
        get unrelated() {
          throw new Error('unrelated metadata must not be read')
        },
      },
      customFields: {
        get batch() {
          order.push('batch')

          return 'Batch'
        },
        get unrelated() {
          throw new Error('unrelated custom field must not be read')
        },
      },
    }

    expect(() => labelFacts(record, undefined)).toThrow(TypeError)
    expect(order).toEqual(['until', 'duration'])
    expect(labelFacts(record, { sampleType: 'Material' })).toEqual({
      identifier: 'SMP-getters',
      sampleType: 'Material',
    })
    expect(order).toEqual(['until', 'duration'])
    expect(
      labelFacts(
        { ...record, properties: { holdUntil: '2026-09-24' } },
        undefined,
      ).lot,
    ).toBe('Batch')
    expect(order).toEqual(['until', 'duration', 'batch'])
  })

  it('keeps millimetre and scaled dimensions and rejects unsupported Code 128 text', () => {
    const { rerender } = render(
      <SampleLabelCard
        host=""
        record={{ identifier: ' SMP-1 ' }}
        template={{ barcodeType: 'code128', widthMm: 30, heightMm: 15 }}
        fit="mm"
      />,
    )

    const label = screen.getByRole('group')
    expect(label.getAttribute('style')).toContain(
      'width: 30mm; height: 15mm; padding: 5px',
    )
    const bars = screen.getByRole('img')
    expect(bars.getAttribute('viewBox')).toBe(
      `0 0 ${encodeCode128('SMP-1').length} 1`,
    )
    expect(bars.getAttribute('preserveAspectRatio')).toBe('none')
    expect(bars.getAttribute('shape-rendering')).toBe('crispEdges')
    rerender(
      <SampleLabelCard
        host="x.test"
        record={{ identifier: 'α' }}
        template={{ barcodeType: 'code128', widthMm: 30, heightMm: 15 }}
        fit={2}
      />,
    )
    expect(screen.getByRole('group').getAttribute('style')).toContain(
      'width: 60px; height: 30px',
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No barcode')).toBeTruthy()
    expect(labelDimensions({ widthMm: 10, heightMm: 10 }, 0.1)).toMatchObject({
      codePx: 16,
      barsPx: 12,
      pictogramPx: 12,
    })
    expect(
      labelDimensions({ widthMm: 30, heightMm: 15 }, 'natural'),
    ).toMatchObject({ style: undefined, pad: 10, codePx: 56, barsPx: 36 })
  })

  it('draws plugin bars and grids from plugin data rather than substituting a built-in code', () => {
    expect(
      labelCodeDrawing({
        host: '',
        identifier: 'SMP-1',
        barcodeType: 'plugin.lab.code',
        pluginCode: { kind: 'bars', modules: '101' },
      }),
    ).toMatchObject({
      bars: { d: 'M0 0h1v1h-1zM2 0h1v1h-1z', modules: 3 },
      code: null,
    })
    expect(
      labelCodeDrawing({
        host: '',
        identifier: 'SMP-1',
        barcodeType: 'plugin.lab.code',
        pluginCode: { kind: 'grid', rows: ['10', '01'] },
      }),
    ).toMatchObject({
      code: { d: 'M0 0h1v1h-1zM1 1h1v1h-1z', size: 2 },
      bars: null,
    })
    expect(
      labelCodeDrawing({
        host: 'x.test',
        identifier: 'SMP-1',
        barcodeType: 'plugin.lab.code',
        pluginCode: undefined,
      }),
    ).toMatchObject({ code: null, bars: null, pluginCodePending: true })
  })
})
