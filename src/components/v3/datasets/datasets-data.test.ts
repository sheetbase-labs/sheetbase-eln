import { describe, expect, it } from 'vitest'

import {
  datasetIssueSummary,
  datasetValidation,
  toDatasetListRow,
} from './datasets-data'
import type { DatasetListRow } from './datasets-data'

const wire = {
  id: '00000000-0000-4000-8000-000000000381',
  display_id: 'DS-0311',
  name: 'ELISA capsid titre and turbidity',
  model: 'ELISA and turbidity v2',
  project_id: null,
  created_by_user_id: 'user-1',
  row_count: '96',
  issue_count: '1',
  out_of_range_count: '1',
  missing_unit_count: '0',
  missing_unit_fields: null,
  experiment_display_id: 'EXP-0142',
  review_state: null,
  updated_at: '2026-09-25T09:12:00+01:00',
  archived_at: null,
} as const

const row = (over: Partial<DatasetListRow> = {}): DatasetListRow => ({
  ...toDatasetListRow(wire),
  ...over,
})

describe('toDatasetListRow', () => {
  it('maps the wire shape, including the design-only columns', () => {
    expect(toDatasetListRow(wire)).toMatchObject({
      id: 'DS-0311',
      model: 'ELISA and turbidity v2',
      rows: 96,
      issues: 1,
      outOfRange: 1,
      missingUnit: 0,
      missingUnitFields: [],
      experimentId: 'EXP-0142',
      reviewState: null,
    })
  })
})

describe('datasetValidation', () => {
  it('names the issue by kind, not a bare count', () => {
    expect(datasetValidation(row())).toEqual({
      tone: 'bad',
      label: '1 out of range',
    })
    expect(
      datasetValidation(row({ missingUnit: 2, missingUnitFields: ['a', 'b'] })),
    ).toEqual({ tone: 'bad', label: '2 columns missing units' })
  })

  it('carries the producing experiment review state', () => {
    expect(datasetValidation(row({ issues: 0 }))).toEqual({
      tone: 'ok',
      label: 'Valid',
    })
    expect(
      datasetValidation(row({ issues: 0, reviewState: 'locked' })),
    ).toEqual({ tone: 'ok', label: 'Valid · locked' })
    expect(
      datasetValidation(row({ issues: 0, reviewState: 'in_review' })),
    ).toEqual({ tone: 'ok', label: 'Valid · in review' })
  })
})

describe('datasetIssueSummary', () => {
  it('lists the unit-less columns and the experiment they block', () => {
    expect(
      datasetIssueSummary(
        row({
          missingUnit: 2,
          missingUnitFields: ['Glucose', 'Osmolality'],
        }),
      ),
    ).toBe(
      '“Glucose” and “Osmolality” have no unit. Units are required before EXP-0142 can be submitted.',
    )
  })

  it('uses singular wording for one column', () => {
    expect(
      datasetIssueSummary(row({ missingUnit: 1, missingUnitFields: ['pH'] })),
    ).toBe(
      '“pH” has no unit. Units are required before EXP-0142 can be submitted.',
    )
  })

  it('describes out-of-range issues when no unit is missing', () => {
    expect(datasetIssueSummary(row({ outOfRange: 1 }))).toBe(
      "1 value is outside the model's allowed range.",
    )
  })
})
