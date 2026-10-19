import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { MAX_PARAMETERS, PARAMETER_TYPES } from '#/lib/pipelines/config'
import type { ParameterType, PipelineParameter } from '#/lib/pipelines/config'
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
  return (
    <div className="flex flex-col gap-2">
      {parameters.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">No parameters declared.</p>
      ) : null}
      {parameters.map((parameter, index) => {
        const n = index + 1
        return (
          <div
            key={index}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle p-2"
          >
            <Input
              className="mono h-8 w-[160px] text-xs"
              aria-label={`Parameter ${n} name`}
              value={parameter.name}
              onChange={(e) =>
                onChange(
                  updateParameter(parameters, index, { name: e.target.value }),
                )
              }
            />
            <Select
              size="sm"
              aria-label={`Parameter ${n} type`}
              value={parameter.type}
              onChange={(e) =>
                onChange(
                  updateParameter(parameters, index, {
                    type: e.target.value as ParameterType,
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
                aria-label={`Parameter ${n} required`}
                checked={parameter.required}
                onCheckedChange={(on) =>
                  onChange(
                    updateParameter(parameters, index, {
                      required: Boolean(on),
                    }),
                  )
                }
              />
              Required
            </label>
            <Input
              className="h-8 w-[140px] text-xs"
              aria-label={`Parameter ${n} default`}
              placeholder={parameter.required ? 'No default' : 'Default'}
              disabled={parameter.required}
              value={
                parameter.default === undefined || parameter.default === null
                  ? ''
                  : String(parameter.default)
              }
              onChange={(e) =>
                onChange(
                  updateParameter(parameters, index, {
                    default: parseDefault(parameter.type, e.target.value),
                  }),
                )
              }
            />
            <Button
              size="sm"
              variant="quiet"
              aria-label={`Remove parameter ${n}`}
              onClick={() => onChange(removeParameter(parameters, index))}
            >
              Remove
            </Button>
          </div>
        )
      })}
      <div>
        <Button
          size="sm"
          icon="plus"
          disabled={parameters.length >= MAX_PARAMETERS}
          onClick={() => onChange(addParameter(parameters))}
        >
          Add parameter
        </Button>
      </div>
    </div>
  )
}
