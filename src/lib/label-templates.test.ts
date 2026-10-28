import { describe, expect, it, vi } from 'vitest'

import {
  EMPTY_LABEL_INPUT,
  activeLabelTemplates,
  saveLabelTemplate,
  validateLabelInput,
} from './label-templates'
import { buildLabelLines, labelTemplateFromRow } from './labels'
import type { DataClient } from './data-client'

const row = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  name: 'Sample tube',
  record_kind: 'sample',
  show_condition: true,
  show_use_by: true,
  show_lot: true,
  show_sample_type: false,
  width_mm: 50,
  height_mm: 25,
  barcode_type: 'qr',
  is_default: false,
  archived_at: null,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
  ...over,
})

describe('labelTemplateFromRow', () => {
  it('reads the wire row', () => {
    expect(
      labelTemplateFromRow(row({ barcode_type: 'code128' })),
    ).toMatchObject({
      name: 'Sample tube',
      widthMm: 50,
      barcodeType: 'code128',
      archivedAt: null,
    })
  })
  it('rejects a code type it cannot print', () => {
    expect(() => labelTemplateFromRow(row({ barcode_type: 'ean13' }))).toThrow()
  })
})

describe('activeLabelTemplates', () => {
  it('leaves out archived and other kinds, default first', () => {
    const list = [
      labelTemplateFromRow(
        row({ id: '33333333-3333-4333-8333-333333333333', name: 'B' }),
      ),
      labelTemplateFromRow(row({ name: 'A', is_default: true })),
      labelTemplateFromRow(
        row({
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Old',
          archived_at: '2026-10-01T00:00:00Z',
        }),
      ),
      labelTemplateFromRow(
        row({
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Reagent',
          record_kind: 'reagent',
        }),
      ),
    ]
    expect(activeLabelTemplates(list, 'sample').map((t) => t.name)).toEqual([
      'A',
      'B',
    ])
  })
})

describe('validateLabelInput', () => {
  const valid = { ...EMPTY_LABEL_INPUT, name: 'Tube' }
  it('accepts a named template of sensible size', () => {
    expect(validateLabelInput(valid)).toBeNull()
  })
  it('asks for a name and a size in whole millimetres', () => {
    expect(validateLabelInput({ ...valid, name: '' })).toMatch(/name/)
    expect(validateLabelInput({ ...valid, widthMm: '5' })).toMatch(/width/)
    expect(validateLabelInput({ ...valid, heightMm: '12.5' })).toMatch(/height/)
  })
})

describe('buildLabelLines with a template', () => {
  const source = {
    identifier: 'SMP-1',
    sampleType: 'Harvest',
    lot: 'L1',
    condition: '-80 °C',
    useBy: '04-Oct',
  }
  it('prints the lot and storage by default, not the type', () => {
    expect(buildLabelLines(source).map((l) => l.kind)).toEqual([
      'identifier',
      'lot',
      'storage',
    ])
  })
  it('follows what the template shows', () => {
    expect(
      buildLabelLines(source, {
        showSampleType: true,
        showLot: false,
        showCondition: false,
      }).map((l) => l.text),
    ).toEqual(['SMP-1', 'Harvest', 'use by 04-Oct'])
    expect(
      buildLabelLines(source, {
        showLot: false,
        showCondition: false,
        showUseBy: false,
      }).map((l) => l.text),
    ).toEqual(['SMP-1'])
  })
})

describe('saveLabelTemplate', () => {
  it('sends the form to the database function', async () => {
    const rpc = vi.fn().mockResolvedValue(row())
    await saveLabelTemplate({ rpc } as unknown as DataClient, 'ws', null, {
      ...EMPTY_LABEL_INPUT,
      name: ' Tube ',
      barcodeType: 'code128',
    })
    expect(rpc).toHaveBeenCalledWith(
      'save_label_template',
      expect.objectContaining({
        p_workspace_id: 'ws',
        p_id: null,
        p_name: 'Tube',
        p_barcode_type: 'code128',
        p_width_mm: 50,
      }),
    )
  })
})
