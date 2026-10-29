/**
 * INT-02 — folder pickup settings for an instrument connector: where files
 * sent by the watched-folder agent are kept and committed. Bound to
 * `updateConnector({ config })`; the endpoint reads `config.pickup`.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { AgentDownload } from '#/components/v3/instruments/agent-download'
import { useWritableProjects } from '#/components/v3/projects/use-writable-projects'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { createDataClient } from '#/lib/data-client'
import { listPublishedDatasetSchemas } from '#/lib/dataset-product'
import {
  connectorQueryKeys,
  describeConnectorsError,
  updateConnector,
} from '#/lib/connectors/client'
import {
  buildPickupConfig,
  pickupFormValues,
} from '#/lib/connectors/pickup-config'
import type { PickupFormValues } from '#/lib/connectors/pickup-config'
import type { ConnectorWire } from '#/lib/connectors/types'
import { t } from '#/copy'

const dataClient = createDataClient()

export function PickupCard({
  workspaceId,
  connector,
  canManage,
}: {
  workspaceId: string
  connector: ConnectorWire
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<PickupFormValues>(() =>
    pickupFormValues(connector.config),
  )
  const [errors, setErrors] = useState<
    Partial<Record<keyof PickupFormValues, string>>
  >({})
  const [saved, setSaved] = useState(false)
  const configured = Boolean(pickupFormValues(connector.config).schemaVersionId)

  // Only projects this person can add to: the agent writes as them.
  const projects = useWritableProjects(canManage)
  const schemas = useQuery({
    queryKey: ['connectors', 'pickup', 'schemas'],
    queryFn: () => listPublishedDatasetSchemas(dataClient),
  })
  const datasets = useQuery({
    queryKey: ['connectors', 'pickup', 'datasets', values.schemaVersionId],
    queryFn: () =>
      dataClient.list<{ id: string; name: string }>(
        'datasets',
        `?schema_version_id=eq.${encodeURIComponent(values.schemaVersionId)}&select=id,name&order=created_at.desc`,
      ),
    enabled: Boolean(values.schemaVersionId),
  })
  const instruments = useQuery({
    queryKey: ['connectors', 'pickup', 'instruments'],
    queryFn: () =>
      dataClient.list<{ id: string; name: string }>(
        'instruments',
        '?select=id,name&retired_at=is.null&order=name.asc',
      ),
  })

  const save = useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      updateConnector(dataClient, {
        workspaceId,
        connectorId: connector.id,
        config,
      }),
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['connectors'] })
      void queryClient.invalidateQueries({
        queryKey: connectorQueryKeys.connector(connector.id),
      })
    },
  })

  const set = <TKey extends keyof PickupFormValues>(
    key: TKey,
    value: PickupFormValues[TKey],
  ) => {
    setSaved(false)
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <Section title={t('settings.integrations.pickupCard.folderPickup')}>
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        {t('settings.integrations.pickupCard.smallAgentInstrument')}
      </p>
      {!configured ? (
        <Notice
          tone="warn"
          title={t('settings.integrations.pickupCard.setUpYet')}
        >
          {t('settings.integrations.pickupCard.chooseWherePicked')}
        </Notice>
      ) : null}
      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            setSaved(false)
            const built = buildPickupConfig(connector.config, values)
            if (!built.ok) {
              setErrors(built.errors)
              return
            }
            setErrors({})
            save.mutate(built.config)
          }}
        >
          <Field
            label={t('settings.integrations.pickupCard.retainRawFiles')}
            required
            error={errors.projectId}
          >
            <Select
              value={values.projectId}
              onChange={(event) => set('projectId', event.target.value)}
            >
              <option value="">
                {t('settings.integrations.pickupCard.selectProject')}
              </option>
              {projects.usable.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('settings.integrations.pickupCard.targetSchemaVersion')}
            required
            error={errors.schemaVersionId}
          >
            <Select
              value={values.schemaVersionId}
              onChange={(event) => {
                set('schemaVersionId', event.target.value)
                set('datasetId', '')
              }}
            >
              <option value="">
                {t('settings.integrations.pickupCard.selectPublishedSchema')}
              </option>
              {(schemas.data ?? []).map((option) => (
                <option
                  key={option.schemaVersionId}
                  value={option.schemaVersionId}
                >
                  {option.name} v{option.version}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('settings.integrations.pickupCard.commit')}
            hint={t('settings.integrations.pickupCard.appendEveryFileHint')}
          >
            <Select
              value={values.datasetId}
              onChange={(event) => set('datasetId', event.target.value)}
            >
              <option value="">
                {t('settings.integrations.pickupCard.newDatasetPer')}
              </option>
              {(datasets.data ?? []).map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </Select>
          </Field>
          {values.datasetId ? null : (
            <Field
              label={t('settings.integrations.pickupCard.newDatasetName')}
              hint={t('settings.integrations.pickupCard.filledHint', {
                connector: '{connector}',
                file: '{file}',
                date: '{date}',
              })}
            >
              <Input
                value={values.datasetNamePattern}
                onChange={(event) =>
                  set('datasetNamePattern', event.target.value)
                }
              />
            </Field>
          )}
          <Field
            label={t('settings.integrations.pickupCard.recordInstrument')}
            hint={t('settings.integrations.pickupCard.addsCompletedRunHint')}
          >
            <Select
              value={values.instrumentId}
              onChange={(event) => set('instrumentId', event.target.value)}
            >
              <option value="">
                {t('settings.integrations.pickupCard.none')}
              </option>
              {(instruments.data ?? []).map((instrument) => (
                <option key={instrument.id} value={instrument.id}>
                  {instrument.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-label sm:col-span-2">
            <Checkbox
              checked={values.autoDetect}
              onCheckedChange={(checked) => set('autoDetect', Boolean(checked))}
            />
            <span>
              {t('settings.integrations.pickupCard.detectFileFormat')}
              <span className="text-fg-muted">
                {t('settings.integrations.pickupCard.otherwiseEveryFile')}
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {t('settings.integrations.pickupCard.savePickupSettings')}
            </Button>
            {saved ? (
              <span className="text-label text-fg-muted">
                {t('common.states.saved')}
              </span>
            ) : null}
          </div>
          {save.isError ? (
            <div className="sm:col-span-2">
              <Notice tone="bad">{describeConnectorsError(save.error)}</Notice>
            </div>
          ) : null}
        </form>
      ) : (
        <p className="m-0 text-label text-fg-muted">
          {t('settings.integrations.pickupCard.askWorkspaceOwner')}
        </p>
      )}
      {configured ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="text-label font-medium">
            {t('library.instruments.agent.title')}
          </span>
          <AgentDownload connectorId={connector.id} canManage={canManage} />
        </div>
      ) : null}
    </Section>
  )
}
