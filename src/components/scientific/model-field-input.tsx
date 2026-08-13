import type { ModelFieldDefinition } from '#/lib/model-fields'
import { Checkbox, Input, Label, Select } from '#/components/ui'
import { fieldDefinitionFromModelField } from '#/lib/field-definition'
import {
  fieldEditorPresentation,
  selectableFieldOptions,
} from '#/lib/field-presentation'

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
  const presentation = fieldEditorPresentation(field.logicalType)

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
