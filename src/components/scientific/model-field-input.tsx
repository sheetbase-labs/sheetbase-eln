import { useEffect, useState } from 'react'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { Checkbox, Input, Label, Select } from '#/components/ui'
import { fieldDefinitionFromModelField } from '#/lib/field-definition'
import {
  fieldEditorPresentation,
  selectableFieldOptions,
} from '#/lib/field-presentation'
import {
  RecordReferenceCellError,
  parsePersistedRecordReference,
} from '#/lib/record-reference-cell'

export function ModelFieldInput({
  definition,
  value,
  onChange,
  showLabel = true,
}: {
  definition: ModelFieldDefinition
  value: string | boolean
  onChange: (value: string | boolean) => void
  showLabel?: boolean
}) {
  const field =
    definition.definition ?? fieldDefinitionFromModelField(definition)
  const presentation = fieldEditorPresentation(field.logicalType, {
    relationshipTarget: field.relationship?.target.kind,
  })

  if (presentation.kind === 'checkbox') {
    return (
      <Label
        className={`flex items-center gap-2 text-xs ${showLabel ? '' : 'justify-end'}`}
      >
        <Checkbox
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          aria-label={definition.label}
        />
        {showLabel ? definition.label : null}
      </Label>
    )
  }

  if (presentation.kind === 'category-select') {
    return (
      <Label className="text-xs text-muted-foreground">
        {showLabel ? definition.label : null}
        {showLabel && !definition.nullable ? ' *' : ''}
        <Select
          className={`${showLabel ? 'mt-1' : ''} h-8 text-xs`}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-label={definition.label}
        >
          {definition.nullable ? <option value="">Not set</option> : null}
          {selectableFieldOptions(field, value).map((option) => (
            <option key={option.id} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
      </Label>
    )
  }

  if (presentation.kind === 'record-picker') {
    return (
      <RecordReferenceUuidInput
        label={definition.label}
        description={definition.description}
        nullable={definition.nullable}
        value={String(value)}
        onChange={onChange}
        showLabel={showLabel}
      />
    )
  }

  return (
    <Label className="text-xs text-muted-foreground">
      {showLabel ? definition.label : null}
      {showLabel && !definition.nullable ? ' *' : ''}
      <Input
        className={`${showLabel ? 'mt-1' : ''} h-8 text-xs`}
        type={presentation.inputType ?? 'text'}
        step={presentation.step}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={definition.label}
        required={!definition.nullable}
      />
      {showLabel && definition.description ? (
        <span className="mt-1 block text-[0.65rem]">
          {definition.description}
        </span>
      ) : null}
    </Label>
  )
}

function RecordReferenceUuidInput({
  label,
  description,
  nullable,
  value,
  onChange,
  showLabel,
}: {
  label: string
  description: string | null
  nullable: boolean
  value: string
  onChange: (value: string | boolean) => void
  showLabel: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(value)
    setError(null)
  }, [value])

  return (
    <Label className="text-xs text-muted-foreground">
      {showLabel ? label : null}
      {showLabel && !nullable ? ' *' : ''}
      <Input
        className={`${showLabel ? 'mt-1' : ''} h-8 text-xs`}
        type="text"
        value={draft}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (next === '') {
            setError(nullable ? null : 'Record reference is required.')
            onChange('')
            return
          }
          try {
            const parsed = parsePersistedRecordReference(next, {
              nullable,
            })
            setError(null)
            onChange(parsed ?? '')
          } catch (caught) {
            const message =
              caught instanceof RecordReferenceCellError
                ? caught.message
                : 'Record reference must be a UUID string.'
            setError(message)
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-label={label}
        required={!nullable}
      />
      <span className="mt-1 block text-[0.65rem]">
        Persists the Record UUID. Record ID and Name are display only.
      </span>
      {error ? (
        <span className="mt-1 block text-[0.65rem] text-destructive">
          {error}
        </span>
      ) : null}
      {showLabel && description ? (
        <span className="mt-1 block text-[0.65rem]">{description}</span>
      ) : null}
    </Label>
  )
}
