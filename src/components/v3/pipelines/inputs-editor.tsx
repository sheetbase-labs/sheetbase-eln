import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { INPUT_NAME_RE, MAX_INPUTS } from '#/lib/pipelines/config'
import type { PipelineInput } from '#/lib/pipelines/config'
import {
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
          No inputs declared. A pipeline with no inputs can still compute
          something, for example from its parameters.
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
          Add input
        </Button>
        <span className="text-label text-fg-muted">
          Each input is a table the SQL reads by name; up to {MAX_INPUTS}. A run
          is always started with a Dataset Version for every input.
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
          aria-label={`Input ${n} name`}
          aria-invalid={nameInvalid || undefined}
          placeholder="e.g. readings"
          value={input.name}
          onChange={(event) => onPatch({ name: event.target.value })}
        />
        <span className="flex-1" />
        <Button
          size="sm"
          variant="quiet"
          aria-label={`Remove input ${n}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {nameInvalid ? (
        <span role="alert" className="text-label text-danger-text">
          Lower-case letters, numbers and _, starting with a letter.
        </span>
      ) : null}
      <Input
        className="h-8 text-xs"
        aria-label={`Input ${n} description`}
        placeholder="What data goes here, e.g. viability readings from the Ambr 250"
        value={input.description ?? ''}
        onChange={(event) =>
          onPatch({ description: event.target.value || undefined })
        }
      />
      <label className="flex flex-col gap-0.5 text-label text-fg-muted">
        See the columns of an example dataset
        <Select
          size="sm"
          aria-label={`Input ${n} example dataset`}
          value={example}
          onChange={(event) => setExample(event.target.value)}
        >
          <option value="">Choose a Dataset Version…</option>
          {(choices.data ?? []).map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </Select>
      </label>
      {example ? (
        fields.isLoading ? (
          <span className="text-label text-fg-muted">Loading columns…</span>
        ) : (fields.data ?? []).length === 0 ? (
          <span className="text-label text-fg-muted">
            That dataset has no columns to show.
          </span>
        ) : (
          <div
            role="group"
            aria-label={`Columns of the example for ${input.name || `input ${n}`}`}
            className="flex flex-wrap gap-1.5"
          >
            {(fields.data ?? []).map((field) => (
              <Button
                key={field.key}
                size="sm"
                variant="quiet"
                className="mono text-xs"
                title={`${field.label} · ${field.type}. Click to add it to the SQL.`}
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
