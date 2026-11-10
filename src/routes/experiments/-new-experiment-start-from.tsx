import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import { t } from '#/copy'

import type { AskedParameterRow, StartFrom } from './-new-experiment-form-data'

/** Where the new experiment starts: blank, a protocol's version, or a template. */
export function StartFromFields({
  startFrom,
  onStartFrom,
  protocolHint,
  effectiveProtocolVersionId,
  protocolOptions,
  onProtocol,
  templateError,
  templatePlaceholder,
  templateId,
  templateOptions,
  onTemplate,
  templatesLoading,
  parameters,
  onParameter,
}: {
  startFrom: StartFrom
  onStartFrom: (value: StartFrom) => void
  protocolHint: string
  effectiveProtocolVersionId: string
  protocolOptions: PickerOption[]
  onProtocol: (id: string) => void
  templateError: string | undefined
  templatePlaceholder: string
  templateId: string
  templateOptions: PickerOption[]
  onTemplate: (id: string) => void
  templatesLoading: boolean
  parameters: AskedParameterRow[]
  onParameter: (id: string, value: string) => void
}) {
  return (
    <>
      <div
        role="group"
        aria-label={t('projects.newExperiment.startFrom')}
        className="flex flex-col gap-1.5"
      >
        <span className="text-label font-medium text-fg">
          {t('projects.newExperiment.startFrom')}
        </span>
        <div className="flex gap-1.5">
          {(
            [
              ['blank', t('projects.newExperiment.blank')],
              ['protocol', t('projects.newExperiment.aProtocol')],
              ['template', t('projects.newExperiment.aTemplate')],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={startFrom === value ? 'primary' : 'secondary'}
              aria-pressed={startFrom === value}
              onClick={() => onStartFrom(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      {startFrom === 'protocol' ? (
        <Field
          label={t('projects.newExperiment.protocolVersion')}
          hint={protocolHint}
        >
          <PickerSelect
            noun="protocol"
            value={effectiveProtocolVersionId}
            onChange={onProtocol}
            clearLabel="No protocol"
            options={protocolOptions}
          />
        </Field>
      ) : null}
      {startFrom === 'template' ? (
        <>
          <Field
            label={t('projects.newExperiment.template')}
            required
            error={templateError}
            hint={t('projects.newExperiment.templateHint')}
          >
            <PickerSelect
              noun="template"
              value={templateId}
              onChange={onTemplate}
              disabled={templatesLoading}
              placeholder={templatePlaceholder}
              options={templateOptions}
            />
          </Field>
          {parameters.map((parameter) => (
            <Field
              key={parameter.id}
              label={parameter.label}
              required
              error={parameter.error}
            >
              <Input
                value={parameter.value}
                onChange={(event) =>
                  onParameter(parameter.id, event.target.value)
                }
              />
            </Field>
          ))}
        </>
      ) : null}
    </>
  )
}
