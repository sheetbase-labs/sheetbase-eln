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

  it('reveals a collapsed invalid field so validation can focus it', () => {
    const save = vi.fn()
    render(
      <RecordModelVersionEditor
        version={version}
        impact={impact}
        busy={false}
        onSave={save}
      />,
    )
    const unit = screen.getByLabelText('Unit')
    const disclosure = unit.closest('details')
    expect(disclosure).toHaveProperty('open', false)
    fireEvent.invalid(unit)
    expect(disclosure).toHaveProperty('open', true)
    expect(save).not.toHaveBeenCalled()
  })

  it('retains category identities, metadata and retired choices in original order', () => {
    const options: NonNullable<
      RecordModelVersion['definition']['fields'][number]['options']
    > = [
      {
        id: '00000000-0000-4000-8000-00000000c010',
        key: 'live',
        label: 'Live cells',
        displayOrder: 20,
        lifecycle: 'active' as const,
        scientificCode: 'LIVE',
      },
      {
        id: '00000000-0000-4000-8000-00000000c011',
        key: 'old',
        label: 'Old classification',
        displayOrder: 5,
        lifecycle: 'retired' as const,
      },
    ]

    const categoryVersion: RecordModelVersion = {
      ...version,
      definition: {
        ...version.definition,
        fields: version.definition.fields.map((field) => ({
          ...field,
          logical_type: 'category',
          category_source: { kind: 'embedded' },
          options,
          scientificMetadata: { assay: 'viability' },
        })),
      },
    }

    const save = vi.fn()
    render(
      <RecordModelVersionEditor
        version={categoryVersion}
        impact={impact}
        busy={false}
        onSave={save}
      />,
    )
    const choices = screen.getByLabelText(/Allowed choices/)
    expect(choices).toHaveProperty('value', 'live')
    fireEvent.change(choices, { target: { value: ' old \nnew\nold\n\nother' } })
    expect(choices).toHaveProperty('value', ' old \nnew\nold\n\nother')
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      {
        target: { value: ' Restore classification ' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save).toHaveBeenCalledWith(
      {
        ...categoryVersion.definition,
        fields: categoryVersion.definition.fields.map((field) => ({
          ...field,
          options: [
            { ...options[0], lifecycle: 'retired' },
            { ...options[1], lifecycle: 'active' },
            {
              id: expect.any(String),
              key: 'new',
              label: 'new',
              displayOrder: 2,
              lifecycle: 'active',
            },
            {
              id: expect.any(String),
              key: 'other',
              label: 'other',
              displayOrder: 3,
              lifecycle: 'active',
            },
          ],
        })),
      },
      'Restore classification',
      'new-records-only',
    )
    // Removing all choices retires them without deleting their identities.
    fireEvent.change(choices, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fields: [
          expect.objectContaining({
            options: [
              expect.objectContaining({
                id: options[0]?.id,
                lifecycle: 'retired',
              }),
              expect.objectContaining({
                id: options[1]?.id,
                lifecycle: 'retired',
              }),
              expect.objectContaining({ key: 'new', lifecycle: 'retired' }),
              expect.objectContaining({ key: 'other', lifecycle: 'retired' }),
            ],
          }),
        ],
      }),
      'Restore classification',
      'new-records-only',
    )
  })

  it('edits quantities and bounds without dropping scientific metadata', () => {
    const scientificVersion: RecordModelVersion = {
      ...version,
      definition: {
        ...version.definition,
        fields: version.definition.fields.map((field) => ({
          ...field,
          scientificMetadata: { assay: 'viability' },
          validation: { ...field.validation, detectionLimit: 0.1 },
          quantity: {
            ...field.quantity,
            kind: 'viability',
            dimension: 'ratio',
            storageUnit: '%',
            allowedInputUnits: ['%'],
            calibration: { method: 'cell-count' },
          },
        })),
      },
    }

    const save = vi.fn()
    render(
      <RecordModelVersionEditor
        version={scientificVersion}
        impact={impact}
        busy={false}
        onSave={save}
      />,
    )
    fireEvent.change(screen.getByLabelText('Unit'), {
      target: { value: ' ratio ' },
    })
    fireEvent.change(screen.getByLabelText('Minimum'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Maximum'), {
      target: { value: '99' },
    })
    fireEvent.change(screen.getByLabelText('Default for new records'), {
      target: { value: '' },
    })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      {
        target: { value: 'Update limits' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save).toHaveBeenCalledWith(
      {
        ...scientificVersion.definition,
        fields: scientificVersion.definition.fields.map((field) => ({
          ...field,
          quantity: { ...field.quantity, storageUnit: 'ratio' },
          validation: { max: 99, detectionLimit: 0.1 },
          default_value: null,
        })),
      },
      'Update limits',
      'new-records-only',
    )
  })

  it.each([false, true])(
    'preserves untouched defaults, explicit null: %s',
    (explicitNull) => {
      const draft: RecordModelVersion = {
        ...version,
        definition: {
          ...version.definition,
          migrationScope: 'also-migrate-open-experiments',
          fields: version.definition.fields.map((field) => {
            const copy = { ...field }
            delete copy.default_value

            if (explicitNull) copy.default_value = null

            return copy
          }),
        },
      }

      const save = vi.fn()
      render(
        <RecordModelVersionEditor
          version={draft}
          impact={impact}
          busy={false}
          onSave={save}
        />,
      )
      expect(screen.getByLabelText('Default for new records')).toHaveProperty(
        'value',
        '',
      )
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Reason for change' }),
        {
          target: { value: 'Keep defaults' },
        },
      )
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
      expect(save).toHaveBeenCalledWith(
        draft.definition,
        'Keep defaults',
        'also-migrate-open-experiments',
      )
      expect(save.mock.calls[0]?.[0]).toStrictEqual(draft.definition)
    },
  )
})
