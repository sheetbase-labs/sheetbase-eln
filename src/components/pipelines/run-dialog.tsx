import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  declaredRunInputs,
  schemasOf,
  useDatasetVersionChoices,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { parameterText, parameterValue, parameterError } from './run-parameters'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import type { DataClient } from '#/lib/data-client'

/** The words that ask for what a Simple recipe takes from the event that starts it. */
function parameterLabel(name: string): React.ReactNode {
  if (name === 'event_person') return t('data.runDialog.eventPerson')

  if (name === 'event_subject') return t('data.runDialog.eventSubject')

  return (
    <>
      {t('data.runDialog.parameter')} <span className="mono">{name}</span>
    </>
  )
}

export interface RunDetails {
  inputVersions: Record<string, string>
  parameters: PipelineDefinitionVersionWire['configuration']
}

/**
 * "Run with…": a run is pinned to one Dataset Version per declared input, and
 * every declared parameter is supplied here, so the database accepts the
 * request instead of refusing it with "missing input".
 */
export function RunDialog({
  pipelineName,
  version,
  busy,
  onClose,
  onSubmit,
  initial,
  trial,
  client,
}: {
  pipelineName: string
  version: PipelineDefinitionVersionWire
  busy: boolean
  onClose: () => void
  onSubmit: (details: RunDetails) => void
  initial?: Partial<RunDetails>
  /** Set to try an unsaved draft: the dialog then promises that nothing is kept. */
  trial?: boolean
  client?: DataClient
}) {
  const { inputs, parameters } = declaredRunInputs(version)
  const choices = useDatasetVersionChoices(inputs.length > 0, client)
  const members = useWorkspaceMemberNames(client)

  const [pinned, setPinned] = useState<Record<string, string>>(
    initial?.inputVersions ?? {},
  )

  // Each input starts narrowed to the schema it declares, if any; "Any schema"
  // shows every Dataset Version.
  const [schemaFilter, setSchemaFilter] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((i) => [i.name, i.schemaId ?? ''])),
  )

  const schemas = schemasOf(choices.data ?? [])

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      parameters.map((p) => {
        const given = initial?.parameters?.[p.name] ?? p.default

        return [p.name, parameterText({ ...p, default: given })]
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
          title={
            trial
              ? t('data.runDialog.tryWith', { pipelineName })
              : t('data.runDialog.runWith', { pipelineName })
          }
          description={
            trial
              ? t('data.runDialog.runsDraftNowDataset')
              : t('data.runDialog.versionVEachInput', {
                  version: version.version,
                })
          }
        />
        <DialogBody>
          {choices.isError ? (
            <Notice tone="bad" title={t('data.runDialog.couldnTLoadDataset')}>
              <Button size="sm" onClick={() => void choices.refetch()}>
                {t('common.actions.tryAgain')}
              </Button>
            </Notice>
          ) : null}
          {noVersions ? (
            <Notice tone="warn" title={t('data.runDialog.datasetVersionsRun')}>
              {t('data.runDialog.importCreateDatasetFirst')}
            </Notice>
          ) : null}
          {inputs.map((input) => {
            const filter = schemaFilter[input.name] ?? ''

            const offered = (choices.data ?? []).filter(
              (choice) =>
                !filter ||
                choice.schemaId === filter ||
                choice.id === pinned[input.name],
            )

            const filterName = schemas.find((s) => s.id === filter)?.name

            return (
              <Field
                key={input.name}
                label={
                  <>
                    {t('data.runDialog.input')}{' '}
                    <span className="mono">{input.name}</span>
                  </>
                }
                required
                hint={
                  filter && choices.isSuccess && offered.length === 0
                    ? t('data.runDialog.datasetVersionFollowsYet', {
                        schema: filterName ?? t('data.runDialog.thatSchema'),
                      })
                    : input.description
                }
              >
                <div className="flex flex-col gap-1.5">
                  {schemas.length > 1 || filter ? (
                    <Select
                      size="sm"
                      aria-label={t('data.runDialog.ariaSchemaFor', {
                        name: input.name,
                      })}
                      value={filter}
                      onChange={(e) =>
                        setSchemaFilter((cur) => ({
                          ...cur,
                          [input.name]: e.target.value,
                        }))
                      }
                    >
                      <option value="">{t('data.runDialog.anySchema')}</option>
                      {schemas.map((schema) => (
                        <option key={schema.id} value={schema.id}>
                          {schema.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <PickerSelect
                    noun="dataset version"
                    aria-label={t('data.runDialog.ariaLabel', {
                      name: input.name,
                    })}
                    value={pinned[input.name] ?? ''}
                    onChange={(id) =>
                      setPinned((cur) => ({
                        ...cur,
                        [input.name]: id,
                      }))
                    }
                    placeholder={t('data.runDialog.placeholder')}
                    options={offered.map((choice) => ({
                      id: choice.id,
                      label: choice.label,
                    }))}
                  />
                </div>
              </Field>
            )
          })}
          {parameters.map((parameter) => {
            const raw = values[parameter.name] ?? ''

            const error =
              raw === '' ? undefined : parameterError(parameter, raw)

            return (
              <Field
                key={parameter.name}
                label={parameterLabel(parameter.name)}
                required={parameter.required}
                hint={parameter.description}
                error={error}
              >
                {parameter.name === 'event_person' ? (
                  <SearchableSelect
                    noun="member"
                    aria-label={t('data.runDialog.eventPerson')}
                    value={raw}
                    onValueChange={(value) =>
                      setValues((cur) => ({
                        ...cur,
                        [parameter.name]: value,
                      }))
                    }
                  >
                    <option value="">{t('data.runDialog.choosePerson')}</option>
                    {Object.entries(members.data ?? {}).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </SearchableSelect>
                ) : parameter.type === 'boolean' ? (
                  <Select
                    aria-label={t('data.runDialog.ariaParameter', {
                      name: parameter.name,
                    })}
                    value={raw}
                    onChange={(e) =>
                      setValues((cur) => ({
                        ...cur,
                        [parameter.name]: e.target.value,
                      }))
                    }
                  >
                    <option value="">{t('data.runDialog.notSet')}</option>
                    <option value="true">{t('data.runDialog.yes')}</option>
                    <option value="false">{t('data.runDialog.no')}</option>
                  </Select>
                ) : (
                  <Input
                    aria-label={t('data.runDialog.ariaParameter', {
                      name: parameter.name,
                    })}
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
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
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
            {trial ? t('data.runDialog.tryDraft') : t('data.runDialog.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
