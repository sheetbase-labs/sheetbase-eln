import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { INPUT_NAME_RE, MAX_INPUTS } from '#/lib/pipelines/config'
import type { PipelineInput } from '#/lib/pipelines/config'
import {
  schemasOf,
  useDatasetVersionChoices,
  useDatasetVersionFields,
} from '#/components/v3/pipelines/pipelines-data'

/**
 * The tables a pipeline reads. Each input is a name the SQL uses; the author
 * can pick any Dataset Version as an example to see the column keys the table
 * will have, and click a column to put it into the transform. The example is
 * a guide only: a run is always started with the Dataset Version it is given.
 */
export function InputsEditor({
  inputs,
  onChange,
  onInsert,
}: {
  inputs: PipelineInput[]
  onChange: (inputs: PipelineInput[]) => void
  /** Put text (a column reference) into the transform. */
  onInsert: (text: string) => void
}) {
  const patch = (index: number, change: Partial<PipelineInput>) =>
    onChange(
      inputs.map((item, position) =>
        position === index ? { ...item, ...change } : item,
      ),
    )
  return (
    <div className="flex flex-col gap-2">
      {inputs.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.inputsEditor.inputsDeclaredPipelineInputs')}
        </p>
      ) : null}
      {inputs.map((input, index) => (
        <InputRow
          key={index}
          input={input}
          index={index}
          onPatch={(change) => patch(index, change)}
          onRemove={() =>
            onChange(inputs.filter((_, position) => position !== index))
          }
          onInsert={onInsert}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon="plus"
          disabled={inputs.length >= MAX_INPUTS}
          onClick={() => onChange([...inputs, { name: '', required: true }])}
        >
          {t('data.inputsEditor.addInput')}
        </Button>
        <span className="text-label text-fg-muted">
          {t('data.inputsEditor.eachInputTableSql', { MAX_INPUTS })}
        </span>
      </div>
    </div>
  )
}

function InputRow({
  input,
  index,
  onPatch,
  onRemove,
  onInsert,
}: {
  input: PipelineInput
  index: number
  onPatch: (change: Partial<PipelineInput>) => void
  onRemove: () => void
  onInsert: (text: string) => void
}) {
  const n = index + 1
  const [example, setExample] = useState('')
  const choices = useDatasetVersionChoices(true)
  const fields = useDatasetVersionFields(example)
  const nameInvalid = input.name !== '' && !INPUT_NAME_RE.test(input.name)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="mono h-8 w-[200px] text-xs"
          aria-label={t('data.inputsEditor.ariaInputName', { n })}
          aria-invalid={nameInvalid || undefined}
          placeholder={t('data.inputsEditor.placeholderEGReadings')}
          value={input.name}
          onChange={(event) => onPatch({ name: event.target.value })}
        />
        <span className="flex-1" />
        <Button
          size="sm"
          variant="quiet"
          aria-label={t('data.inputsEditor.ariaRemoveInput', { n })}
          onClick={onRemove}
        >
          {t('common.actions.remove')}
        </Button>
      </div>
      {nameInvalid ? (
        <span role="alert" className="text-label text-danger-text">
          {t('data.inputsEditor.lowerCaseLettersNumbers')}
        </span>
      ) : null}
      <Input
        className="h-8 text-xs"
        aria-label={t('data.inputsEditor.ariaInputDescription', { n })}
        placeholder={t('data.inputsEditor.placeholderWhatDataGoesHere')}
        value={input.description ?? ''}
        onChange={(event) =>
          onPatch({ description: event.target.value || undefined })
        }
      />
      <label className="flex flex-col gap-0.5 text-label text-fg-muted">
        {t('data.inputsEditor.seeColumnsExampleDataset')}
        <Select
          size="sm"
          aria-label={t('data.inputsEditor.ariaInputExampleDataset', { n })}
          value={example}
          onChange={(event) => {
            setExample(event.target.value)
            // The example's schema is what this input will usually be given, so
            // the Run dialog narrows its list to it unless the author chose one.
            const schemaId = (choices.data ?? []).find(
              (choice) => choice.id === event.target.value,
            )?.schemaId
            if (schemaId && !input.schemaId) onPatch({ schemaId })
          }}
        >
          <option value="">
            {t('data.inputsEditor.chooseDatasetVersion')}
          </option>
          {(choices.data ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-0.5 text-label text-fg-muted">
        {t('data.inputsEditor.expectedDatasetSchema')}
        <Select
          size="sm"
          aria-label={t('data.inputsEditor.ariaInputExpectedSchema', { n })}
          value={input.schemaId ?? ''}
          onChange={(event) =>
            onPatch({ schemaId: event.target.value || undefined })
          }
        >
          <option value="">{t('data.inputsEditor.anySchema')}</option>
          {schemasOf(choices.data ?? []).map((schema) => (
            <option key={schema.id} value={schema.id}>
              {schema.name}
            </option>
          ))}
        </Select>
        <span>{t('data.inputsEditor.runDialogListsDataset')}</span>
      </label>
      {example ? (
        fields.isLoading ? (
          <span className="text-label text-fg-muted">
            {t('data.inputsEditor.loadingColumns')}
          </span>
        ) : (fields.data ?? []).length === 0 ? (
          <span className="text-label text-fg-muted">
            {t('data.inputsEditor.datasetHasColumnsShow')}
          </span>
        ) : (
          <div
            role="group"
            aria-label={t('data.inputsEditor.ariaColumnsExample', {
              value: input.name || `input ${n}`,
            })}
            className="flex flex-wrap gap-1.5"
          >
            {(fields.data ?? []).map((field) => (
              <Button
                key={field.key}
                size="sm"
                variant="quiet"
                className="mono text-xs"
                title={t('data.inputsEditor.clickAddSql', {
                  label: field.label,
                  type: field.type,
                })}
                disabled={!input.name}
                onClick={() =>
                  onInsert(
                    input.name ? `${input.name}.${field.key}` : field.key,
                  )
                }
              >
                {field.key}
                <span className="ml-1 text-fg-muted">{field.type}</span>
              </Button>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}
