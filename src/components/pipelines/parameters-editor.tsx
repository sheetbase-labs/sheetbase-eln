import { t } from '#/copy'
import { z } from 'zod'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { MAX_PARAMETERS, PARAMETER_TYPES } from '#/lib/pipelines/config'
import type { PipelineParameter } from '#/lib/pipelines/config'
import { useEditorRows } from './use-editor-rows'
import {
  addParameter,
  parseDefault,
  removeParameter,
  updateParameter,
} from '#/lib/pipelines/authoring'

/**
 * The values a run asks for. A parameter is named, typed, required or not, and
 * may carry a default (never when required); the run dialog asks for each one
 * and the run records what was supplied.
 */
export function ParametersEditor({
  parameters,
  onChange,
}: {
  parameters: PipelineParameter[]
  onChange: (parameters: PipelineParameter[]) => void
}) {
  const { rows, change } = useEditorRows(parameters, onChange)

  return (
    <div className="flex flex-col gap-2">
      {parameters.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.parametersEditor.parametersDeclared')}
        </p>
      ) : null}
      {rows.map(({ id, value: parameter }, index) => {
        const n = index + 1

        return (
          <div
            key={id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle p-2"
          >
            <Input
              className="mono h-8 w-[160px] text-xs"
              aria-label={t('data.parametersEditor.ariaParameterName', { n })}
              value={parameter.name}
              onChange={(e) =>
                change(
                  updateParameter(parameters, index, { name: e.target.value }),
                )
              }
            />
            <Select
              size="sm"
              aria-label={t('data.parametersEditor.ariaParameterType', { n })}
              value={parameter.type}
              onChange={(e) =>
                change(
                  updateParameter(parameters, index, {
                    type: z.enum(PARAMETER_TYPES).parse(e.target.value),
                  }),
                )
              }
            >
              {PARAMETER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-body">
              <Checkbox
                aria-label={t('data.parametersEditor.ariaParameterRequired', {
                  n,
                })}
                checked={parameter.required}
                onCheckedChange={(on) =>
                  change(
                    updateParameter(parameters, index, {
                      required: Boolean(on),
                    }),
                  )
                }
              />
              {t('common.states.required')}
            </label>
            <Input
              className="h-8 w-[140px] text-xs"
              aria-label={t('data.parametersEditor.ariaParameterDefault', {
                n,
              })}
              placeholder={
                parameter.required
                  ? t('data.parametersEditor.placeholderNoDefault')
                  : t('data.parametersEditor.placeholderDefault')
              }
              disabled={parameter.required}
              value={
                parameter.default === undefined || parameter.default === null
                  ? ''
                  : z.coerce.string().parse(parameter.default)
              }
              onChange={(e) =>
                change(
                  updateParameter(parameters, index, {
                    default: parseDefault(parameter.type, e.target.value),
                  }),
                )
              }
            />
            <Button
              size="sm"
              variant="quiet"
              aria-label={t('data.parametersEditor.ariaRemoveParameter', { n })}
              onClick={() => {
                const remaining = removeParameter(parameters, index)
                change(remaining, remaining)
              }}
            >
              {t('common.actions.remove')}
            </Button>
          </div>
        )
      })}
      <div>
        <Button
          size="sm"
          icon="plus"
          disabled={parameters.length >= MAX_PARAMETERS}
          onClick={() => change(addParameter(parameters))}
        >
          {t('data.parametersEditor.addParameter')}
        </Button>
      </div>
    </div>
  )
}
