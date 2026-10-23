import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordModelVersionEditor } from './record-model-version-editor'
import type { ModelFieldImpact } from './model-field-impact'
import type { RecordModelVersion } from '#/lib/record-model-versions'

const FIELD_ID = '00000000-0000-4000-8000-00000000c004'

const version: RecordModelVersion = {
  id: '00000000-0000-4000-8000-00000000c002',
  model_id: '00000000-0000-4000-8000-00000000c001',
  workspace_id: '00000000-0000-4000-8000-00000000c003',
  version: 2,
  revision: 7,
  lifecycle: 'draft',
  reason: 'Add a viability range',
  created_at: '2026-10-04T12:00:00Z',
  created_by_user_id: 'author',
  published_at: null,
  definition: {
    identifier_prefix: 'TB',
    fields: [
      {
        id: FIELD_ID,
        field_name: 'viability',
        label: 'Viability',
        logical_type: 'decimal',
        nullable: true,
        display_order: 0,
        lifecycle: 'active',
        default_value: 90,
        validation: { min: 0, max: 100 },
        cardinality: 'one',
        quantity: { kind: 'viability', dimension: 'ratio', storageUnit: '%' },
      },
    ],
  },
}

const impact: ModelFieldImpact = {
  recordsOnEachVersion: [
    { versionId: 'v-2', version: 2, recordCount: 3 },
    { versionId: 'v-1', version: 1, recordCount: 2 },
  ],
  migratableRecords: 2,
  templates: 1,
  sheets: 2,
}

afterEach(cleanup)

describe('RecordModelVersionEditor — field change contract', () => {
  it('shows the impact before the change can be applied', () => {
    render(
      <RecordModelVersionEditor
        version={version}
        impact={impact}
        busy={false}
        onSave={vi.fn()}
      />,
    )
    const panel = screen.getByRole('region', { name: 'Impact' })
    expect(panel.textContent).toContain('3 records use v2')
    expect(panel.textContent).toContain('2 records use v1')
    expect(panel.textContent).toContain('1 template and 2 sheets')
    expect(screen.getByLabelText('New records only')).toHaveProperty(
      'checked',
      true,
    )
    expect(
      screen.getByLabelText(
        'Also migrate eligible open records after publication (2)',
      ),
    ).toBeTruthy()
  })

  it('blocks saving without a reason for change', () => {
    const save = vi.fn()
    render(
      <RecordModelVersionEditor
        version={version}
        impact={impact}
        busy={false}
        onSave={save}
      />,
    )
    const button = screen.getByRole('button', { name: 'Save draft' })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      { target: { value: '   ' } },
    )
    expect(button).toHaveProperty('disabled', true)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      { target: { value: 'Narrow the release range' } },
    )
    expect(button).toHaveProperty('disabled', false)
    expect(save).not.toHaveBeenCalled()
  })

  it('sends the chosen scope to the apply call once a reason is given', () => {
    const save = vi.fn()
    render(
      <RecordModelVersionEditor
        version={version}
        impact={impact}
        busy={false}
        onSave={save}
      />,
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      { target: { value: 'Extend range after service' } },
    )
    fireEvent.click(
      screen.getByLabelText(
        'Also migrate eligible open records after publication (2)',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save).toHaveBeenCalledWith(
      version.definition,
      'Extend range after service',
      'also-migrate-open-experiments',
    )
  })

  it('locks a published key and explains why', () => {
    render(
      <RecordModelVersionEditor
        version={version}
        impact={impact}
        publishedFieldNames={['viability']}
        publishedVersion={2}
        busy={false}
        onSave={vi.fn()}
      />,
    )
    const key = screen.getByLabelText('Field key')
    expect(key).toHaveProperty('disabled', true)
    expect(screen.getByText(/Locked: published in v2/)).toBeTruthy()
  })

  it('leaves a key that has never been published editable', () => {
    render(
      <RecordModelVersionEditor
        version={version}
        impact={impact}
        publishedFieldNames={[]}
        busy={false}
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Field key')).toHaveProperty('disabled', false)
    expect(screen.getByText(/Not yet published/)).toBeTruthy()
  })
})
