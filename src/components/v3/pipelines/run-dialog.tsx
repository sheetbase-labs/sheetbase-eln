import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Notice } from '#/components/v3/ui/alert'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import {
  declaredRunInputs,
  useDatasetVersionChoices,
} from '#/components/v3/pipelines/pipelines-data'
import type { PipelineParameter } from '#/lib/pipelines/config'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'

export interface RunDetails {
  inputVersions: Record<string, string>
  parameters: Record<string, unknown>
}

function parameterValue(
  parameter: PipelineParameter,
  raw: string,
): unknown | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  switch (parameter.type) {
    case 'integer':
    case 'decimal':
      return Number(text)
    case 'boolean':
      return text === 'true'
    default:
      return text
  }
}

function parameterError(
  parameter: PipelineParameter,
  raw: string,
): string | undefined {
  const text = raw.trim()
  if (text === '') return parameter.required ? 'Required.' : undefined
  if (parameter.type === 'integer' && !/^-?\d+$/.test(text))
    return 'Enter a whole number.'
  if (parameter.type === 'decimal' && Number.isNaN(Number(text)))
    return 'Enter a number.'
  if (parameter.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text))
    return 'Use the format YYYY-MM-DD.'
  return undefined
}

/**
 * "Run with…": a run is pinned to one Dataset Version per declared input, and
 * every declared parameter is supplied here, so the database accepts the
 * request instead of refusing it with "missing input".
 */
export function RunDialog({
  pipelineKey,
  version,
  busy,
  onClose,
  onSubmit,
  initial,
}: {
  pipelineKey: string
  version: PipelineDefinitionVersionWire
  busy: boolean
  onClose: () => void
  onSubmit: (details: RunDetails) => void
  initial?: Partial<RunDetails>
}) {
  const { inputs, parameters } = declaredRunInputs(version)
  const choices = useDatasetVersionChoices(inputs.length > 0)
  const [pinned, setPinned] = useState<Record<string, string>>(
    initial?.inputVersions ?? {},
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      parameters.map((p) => {
        const given = initial?.parameters?.[p.name] ?? p.default
        return [p.name, given === undefined ? '' : String(given)]
      }),
    ),
  )

  // The database asks for every declared input, required or not.
  const missingInput = inputs.some((input) => !pinned[input.name])
  const invalidParameter = parameters.some((p) =>
    parameterError(p, values[p.name] ?? ''),
  )
  const noVersions =
    inputs.length > 0 && choices.isSuccess && choices.data.length === 0

  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-[min(520px,calc(100vw-32px))]">
        <DialogHeader
          title={`Run ${pipelineKey} with…`}
          description={`Version v${version.version}. Each input is pinned to the Dataset Version you choose, so the run can be repeated exactly.`}
        />
        <DialogBody>
          {choices.isError ? (
            <Notice tone="bad" title="Couldn’t load Dataset Versions">
              <Button size="sm" onClick={() => void choices.refetch()}>
                Try again
              </Button>
            </Notice>
          ) : null}
          {noVersions ? (
            <Notice tone="warn" title="No Dataset Versions to run on">
              Import or create a dataset first. A run reads a saved Dataset
              Version, never a live sheet.
            </Notice>
          ) : null}
          {inputs.map((input) => (
            <Field
              key={input.name}
              label={
                <>
                  Input <span className="mono">{input.name}</span>
                </>
              }
              required
              hint={input.description}
            >
              <Select
                aria-label={`Dataset Version for ${input.name}`}
                value={pinned[input.name] ?? ''}
                onChange={(e) =>
                  setPinned((cur) => ({ ...cur, [input.name]: e.target.value }))
                }
              >
                <option value="">Choose a Dataset Version…</option>
                {(choices.data ?? []).map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
          {parameters.map((parameter) => {
            const raw = values[parameter.name] ?? ''
            const error =
              raw === '' ? undefined : parameterError(parameter, raw)
            return (
              <Field
                key={parameter.name}
                label={
                  <>
                    Parameter <span className="mono">{parameter.name}</span>
                  </>
                }
                required={parameter.required}
                hint={parameter.description}
                error={error}
              >
                {parameter.type === 'boolean' ? (
                  <Select
                    aria-label={`Parameter ${parameter.name}`}
                    value={raw}
                    onChange={(e) =>
                      setValues((cur) => ({
                        ...cur,
                        [parameter.name]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Not set</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </Select>
                ) : (
                  <Input
                    aria-label={`Parameter ${parameter.name}`}
                    type={parameter.type === 'date' ? 'date' : 'text'}
                    value={raw}
                    onChange={(e) =>
                      setValues((cur) => ({
                        ...cur,
                        [parameter.name]: e.target.value,
                      }))
                    }
                  />
                )}
              </Field>
            )
          })}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            icon="play"
            disabled={busy || missingInput || invalidParameter}
            onClick={() =>
              onSubmit({
                inputVersions: Object.fromEntries(
                  inputs.map((input) => [input.name, pinned[input.name]]),
                ),
                parameters: Object.fromEntries(
                  parameters.flatMap((p) => {
                    const value = parameterValue(p, values[p.name] ?? '')
                    return value === undefined ? [] : [[p.name, value]]
                  }),
                ),
              })
            }
          >
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
