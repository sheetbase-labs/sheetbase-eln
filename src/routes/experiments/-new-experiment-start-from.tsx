import { useState } from 'react'

import { Icon } from '#/components/icons'
import { Field, Input } from '#/components/ui/input'
import type { PickerOption } from '#/components/record-picker/entity-picker'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

import type {
  AskedParameterRow,
  StartFrom,
  TemplateRow,
} from './-new-experiment-form-data'
import { templateOutline } from './-new-experiment-outline'

interface StartChoice {
  key: string
  kind: StartFrom
  id: string
  label: string
  detail: string
  group: string
}

function choicesOf(
  templateOptions: PickerOption[],
  protocolOptions: PickerOption[],
): StartChoice[] {
  return [
    {
      key: 'blank',
      kind: 'blank',
      id: '',
      label: t('projects.newExperiment.blank'),
      detail: t('projects.newExperiment.blankHint'),
      group: '',
    },
    ...templateOptions.map((option) => ({
      key: `template:${option.id}`,
      kind: 'template' as const,
      id: option.id,
      label: option.label,
      detail: option.detail ?? '',
      group: t('projects.newExperiment.templatesGroup'),
    })),
    ...protocolOptions.map((option) => ({
      key: `protocol:${option.id}`,
      kind: 'protocol' as const,
      id: option.id,
      label: option.label,
      detail: option.identifier ?? '',
      group: t('projects.newExperiment.protocolsGroup'),
    })),
  ]
}

/**
 * First question of the form: what are you running. A searchable list of the
 * ways to start sits beside a preview of what the notebook will hold, so the
 * choice that shapes the notebook is made first and seen before it is made.
 */
export function StartFromFields({
  startFrom,
  onChoose,
  effectiveProtocolVersionId,
  protocolOptions,
  templateError,
  templateId,
  templateOptions,
  templates,
  templatesLoading,
  parameters,
  onParameter,
}: {
  startFrom: StartFrom
  onChoose: (kind: StartFrom, id: string) => void
  effectiveProtocolVersionId: string
  protocolOptions: PickerOption[]
  templateError: string | undefined
  templateId: string
  templateOptions: PickerOption[]
  templates: TemplateRow[]
  templatesLoading: boolean
  parameters: AskedParameterRow[]
  onParameter: (id: string, value: string) => void
}) {
  const [query, setQuery] = useState('')

  const all = choicesOf(templateOptions, protocolOptions)
  const needle = query.trim().toLowerCase()

  const shown = all.filter(
    (choice) =>
      choice.kind === 'blank' ||
      !needle ||
      `${choice.label} ${choice.detail}`.toLowerCase().includes(needle),
  )

  const currentKey =
    startFrom === 'template'
      ? `template:${templateId}`
      : startFrom === 'protocol'
        ? `protocol:${effectiveProtocolVersionId}`
        : 'blank'

  const current = all.find((choice) => choice.key === currentKey) ?? all[0]
  const template = templates.find((row) => row.id === templateId)

  const outline =
    startFrom === 'template'
      ? templateOutline(
          (template?.published ?? template?.latest)?.configuration,
        )
      : null

  let lastGroup: string | null = null

  return (
    <section
      aria-labelledby="start-from-title"
      className="flex flex-col gap-3 border-b pb-6"
    >
      <div>
        <h2 id="start-from-title" className="text-base font-semibold text-fg">
          {t('projects.newExperiment.whatRunning')}
        </h2>
        <p className="text-label text-fg-muted">
          {t('projects.newExperiment.whatRunningHint')}
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('projects.newExperiment.searchStarts')}
            aria-label={t('projects.newExperiment.searchStarts')}
          />
          <div
            role="radiogroup"
            aria-label={t('projects.newExperiment.startFrom')}
            className="flex max-h-80 flex-col overflow-y-auto"
          >
            {shown.map((choice) => {
              const heading = choice.group !== lastGroup ? choice.group : ''
              lastGroup = choice.group
              const selected = choice.key === currentKey

              return (
                <div key={choice.key}>
                  {heading ? (
                    <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
                      {heading}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChoose(choice.kind, choice.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'bg-selection text-fg'
                        : 'text-fg hover:bg-surface-hover',
                    )}
                  >
                    <Icon
                      name={
                        choice.kind === 'blank'
                          ? 'edit'
                          : choice.kind === 'template'
                            ? 'table'
                            : 'file'
                      }
                      size={16}
                      className="shrink-0 text-fg-muted"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {choice.label}
                      </span>
                      {choice.detail ? (
                        <span className="block truncate text-xs text-fg-muted">
                          {choice.detail}
                        </span>
                      ) : null}
                    </span>
                    {selected ? (
                      <Icon name="check" size={14} className="shrink-0" />
                    ) : null}
                  </button>
                </div>
              )
            })}
            {templatesLoading ? (
              <p className="px-2.5 py-2 text-xs text-fg-muted">
                {t('projects.newExperiment.loadingTemplates')}
              </p>
            ) : null}
            {needle && shown.length === 1 ? (
              <p className="px-2.5 py-2 text-xs text-fg-muted">
                {t('projects.newExperiment.noStartMatches')}
              </p>
            ) : null}
          </div>
          {startFrom === 'template' && templateError ? (
            <p role="alert" className="text-xs text-danger">
              {templateError}
            </p>
          ) : null}
        </div>
        <div
          aria-live="polite"
          className="min-w-0 border-t pt-4 md:border-l md:border-t-0 md:pl-6 md:pt-0"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
            {t('projects.newExperiment.previewTitle')}
          </p>
          <p className="mt-1 text-base font-semibold text-fg">
            {current.label}
          </p>
          {startFrom === 'blank' ? (
            <p className="mt-2 text-sm text-fg-muted">
              {t('projects.newExperiment.previewBlank')}
            </p>
          ) : null}
          {startFrom === 'protocol' ? (
            <p className="mt-2 text-sm text-fg-muted">
              {t('projects.newExperiment.previewProtocol')}
            </p>
          ) : null}
          {outline && outline.lines.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">
              {t('projects.newExperiment.previewEmpty')}
            </p>
          ) : null}
          {outline && outline.lines.length > 0 ? (
            <ol className="mt-3 flex flex-col text-sm">
              {outline.lines.map((line) => (
                <li
                  key={line.id}
                  className={cn(
                    'flex items-baseline gap-2 py-1',
                    line.kind === 'part'
                      ? 'mt-2 font-semibold text-fg'
                      : 'pl-3 text-fg',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{line.label}</span>
                  {line.note ? (
                    <span className="shrink-0 text-xs text-fg-muted">
                      {line.note}
                    </span>
                  ) : null}
                </li>
              ))}
              {outline.more > 0 ? (
                <li className="pl-3 pt-1 text-xs text-fg-muted">
                  {t('projects.newExperiment.previewMore', {
                    count: outline.more,
                  })}
                </li>
              ) : null}
            </ol>
          ) : null}
          {startFrom === 'template' && parameters.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4">
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
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
