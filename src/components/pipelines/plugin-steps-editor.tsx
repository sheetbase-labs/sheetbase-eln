import { z } from 'zod'

import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import type { OperationInput } from '#/lib/operations/descriptor'
import type {
  PipelineParameter,
  PipelineStepAction,
} from '#/lib/pipelines/config'
import type { TableSource } from './plugin-step-sources'

type ArgumentValue = PipelineStepAction['arguments'][string]

const referenceSchema = z.object({ $ref: z.string() })

/**
 * One box of a plugin step: a table (picked from where it can come from), a
 * yes/no, or a value typed here or taken from a pipeline setting.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- one argument box covers every input type (table, yes/no, number, text, setting, row column); splitting it would spread one value contract across files.
export function ArgumentField({
  input,
  isTable,
  value,
  parameters,
  tableSources,
  rows = false,
  onChange,
}: {
  input: OperationInput
  isTable: boolean
  value: ArgumentValue | undefined
  parameters: PipelineParameter[]
  tableSources: TableSource[]
  /** The action runs once for each row: a box may take a column of the row. */
  rows?: boolean
  onChange: (value: ArgumentValue | undefined) => void
}) {
  const label = input.name.replaceAll('_', ' ')
  const caption = label.charAt(0).toUpperCase() + label.slice(1)
  const reference = referenceSchema.safeParse(value)

  if (isTable) {
    const current = reference.success
      ? reference.data.$ref
      : (tableSources.at(0)?.ref ?? 'previous')

    return (
      <Field label={caption} hint={input.description} required={input.required}>
        <Select
          value={current}
          aria-label={caption}
          onChange={(event) => onChange({ $ref: event.target.value })}
        >
          {tableSources.map((source) => (
            <option key={source.ref} value={source.ref}>
              {source.label}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  const matching = parameters.filter((parameter) =>
    input.type === 'num' || input.type === 'int'
      ? ['number', 'integer', 'decimal'].includes(parameter.type)
      : true,
  )

  const ref = reference.success ? reference.data.$ref : null

  const mode = ref?.startsWith('parameters.')
    ? ref
    : ref?.startsWith('row.')
      ? 'row'
      : 'typed'

  const typed = z.union([z.string(), z.number()]).safeParse(value)

  if (input.type === 'bool')
    return (
      <label className="flex items-center gap-2 text-body text-fg">
        <Checkbox
          checked={value === true}
          onCheckedChange={(next) => onChange(next === true)}
        />
        {caption}
      </label>
    )

  return (
    <Field label={caption} hint={input.description} required={input.required}>
      <div className="flex flex-col gap-1.5">
        {matching.length > 0 || rows ? (
          <Select
            size="sm"
            aria-label={t('data.pluginSteps.takenFrom', { name: caption })}
            value={mode}
            onChange={(event) =>
              onChange(
                event.target.value === 'typed'
                  ? undefined
                  : event.target.value === 'row'
                    ? { $ref: 'row.' }
                    : { $ref: event.target.value },
              )
            }
          >
            <option value="typed">{t('data.pluginSteps.typedHere')}</option>
            {rows ? (
              <option value="row">{t('data.stepList.columnOfRow')}</option>
            ) : null}
            {matching.map((parameter) => (
              <option
                key={parameter.name}
                value={`parameters.${parameter.name}`}
              >
                {t('data.pluginSteps.fromParameter', { name: parameter.name })}
              </option>
            ))}
          </Select>
        ) : null}
        {mode === 'row' ? (
          <Input
            className="mono text-xs"
            aria-label={t('data.stepList.rowColumn', { name: caption })}
            value={ref?.slice('row.'.length) ?? ''}
            onChange={(event) =>
              onChange({ $ref: `row.${event.target.value.trim()}` })
            }
          />
        ) : null}
        {mode === 'typed' ? (
          <Input
            value={typed.success ? String(typed.data) : ''}
            inputMode={
              input.type === 'num' || input.type === 'int'
                ? 'decimal'
                : undefined
            }
            onChange={(event) => {
              const text = event.target.value

              if (text === '') return onChange(undefined)

              if (input.type === 'num' || input.type === 'int') {
                const n = Number(text)

                return onChange(Number.isFinite(n) ? n : text)
              }

              onChange(text)
            }}
          />
        ) : null}
      </div>
    </Field>
  )
}
