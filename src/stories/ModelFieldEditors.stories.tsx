import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordModelFieldCategoryEditor } from '#/components/models/record-model-field-category-editor'
import { RecordModelFieldDefaultsEditor } from '#/components/models/record-model-field-defaults-editor'
import { RecordModelFieldDefinitionEditor } from '#/components/models/record-model-field-definition-editor'
import { RecordModelFieldQuantityEditor } from '#/components/models/record-model-field-quantity-editor'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'

type VersionField = RecordModelVersionDefinition['fields'][number]

const numericField: VersionField = {
  id: '00000000-0000-4000-8000-0000000000f3',
  field_name: 'viability',
  label: 'Viability',
  logical_type: 'decimal',
  nullable: false,
  display_order: 0,
  lifecycle: 'active',
  default_value: 90,
  validation: { min: 0, max: 100 },
  cardinality: 'one',
  quantity: { kind: 'viability', dimension: 'fraction', storageUnit: '%' },
}

const categoryField: VersionField = {
  ...numericField,
  field_name: 'cell_line',
  label: 'Cell line',
  logical_type: 'category',
  default_value: 'cho',
  validation: {},
  quantity: null,
  category_source: { kind: 'embedded' },
  options: [
    {
      id: '00000000-0000-4000-8000-0000000000c1',
      key: 'cho',
      label: 'CHO-K1',
      displayOrder: 0,
      lifecycle: 'active',
    },
    {
      id: '00000000-0000-4000-8000-0000000000c2',
      key: 'hek',
      label: 'HEK293',
      displayOrder: 1,
      lifecycle: 'retired',
    },
  ],
}

function Editor({
  initial = numericField,
  surface = 'definition',
  locked = false,
  busy = false,
  open = true,
}: {
  initial?: VersionField
  surface?: 'definition' | 'category' | 'defaults' | 'quantity'
  locked?: boolean
  busy?: boolean
  open?: boolean
}) {
  const [field, setField] = useState(initial)
  const [choiceInput, setChoiceInput] = useState<string>()

  function change(patch: ModelMetadataPatch<VersionField>) {
    setField((current) => ({ ...current, ...patch }))
  }

  return (
    <div className="w-[600px] max-w-full space-y-4">
      {surface === 'definition' ? (
        <RecordModelFieldDefinitionEditor
          field={field}
          locked={locked}
          publishedVersion={locked ? 3 : null}
          busy={busy}
          open={open}
          choiceInput={choiceInput}
          onChoiceInputChange={setChoiceInput}
          onChange={change}
        />
      ) : surface === 'category' ? (
        <RecordModelFieldCategoryEditor
          field={field}
          input={choiceInput}
          onInputChange={setChoiceInput}
          onChange={change}
        />
      ) : surface === 'defaults' ? (
        <RecordModelFieldDefaultsEditor
          field={field}
          numeric={field.logical_type === 'decimal'}
          onChange={change}
        />
      ) : (
        <RecordModelFieldQuantityEditor field={field} onChange={change} />
      )}
      <output aria-label="Current field definition" className="block">
        <pre className="whitespace-pre-wrap text-caption">
          {JSON.stringify(field, null, 2)}
        </pre>
      </output>
    </div>
  )
}

const meta = { title: 'Models/Field editors' } satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const NumericDefinition: Story = { render: () => <Editor /> }

export const PublishedKey: Story = { render: () => <Editor locked /> }

export const Saving: Story = { render: () => <Editor busy /> }

export const CollapsedRetired: Story = {
  render: () => (
    <Editor initial={{ ...numericField, lifecycle: 'retired' }} open={false} />
  ),
}

export const CategoryDefinition: Story = {
  render: () => <Editor initial={categoryField} />,
}

export const ReferenceDefinition: Story = {
  render: () => (
    <Editor
      initial={{
        ...numericField,
        field_name: 'source_sample',
        label: 'Source sample',
        logical_type: 'reference',
        default_value: null,
        quantity: null,
        validation: { targetModelKey: 'sample' },
        relationship: {
          target: { kind: 'model', modelKey: 'sample' },
          cardinality: 'one',
        },
      }}
    />
  ),
}

/** Editing the keys retires missing options without deleting their identity. */
export const CategoryChoices: Story = {
  render: () => <Editor initial={categoryField} surface="category" />,
}

export const EmptyChoices: Story = {
  render: () => (
    <Editor initial={{ ...categoryField, options: [] }} surface="category" />
  ),
}

export const NumericDefaults: Story = {
  render: () => <Editor surface="defaults" />,
}

export const OptionalTextDefaults: Story = {
  render: () => (
    <Editor
      initial={{
        ...numericField,
        field_name: 'notes',
        label: 'Notes',
        logical_type: 'text',
        nullable: true,
        default_value: null,
        validation: {},
        quantity: null,
      }}
      surface="defaults"
    />
  ),
}

export const Quantity: Story = { render: () => <Editor surface="quantity" /> }

export const NoQuantity: Story = {
  render: () => (
    <Editor initial={{ ...numericField, quantity: null }} surface="quantity" />
  ),
}
