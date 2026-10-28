/**
 * INT-02 — folder pickup settings for an instrument connector: where files
 * sent by the watched-folder agent are kept and committed. Bound to
 * `updateConnector({ config })`; the endpoint reads `config.pickup`.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
  agentCommand,
  buildPickupConfig,
  pickupFormValues,
} from '#/lib/connectors/pickup-config'
import type { PickupFormValues } from '#/lib/connectors/pickup-config'
import type { ConnectorWire } from '#/lib/connectors/types'

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

  const projects = useQuery({
    queryKey: ['connectors', 'pickup', 'projects'],
    queryFn: () =>
      dataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
  })
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

  const origin =
    typeof window === 'undefined' ? 'https://your-eln' : window.location.origin

  return (
    <Section title="Folder pickup">
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        A small agent on the instrument’s computer watches a results folder and
        sends each finished file here. Each file is retained, read by the parser
        and committed to a Dataset in a governed run.
      </p>
      {!configured ? (
        <Notice tone="warn" title="Not set up yet.">
          Choose where picked-up files go before starting the agent.
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
            label="Retain raw files in project"
            required
            error={errors.projectId}
          >
            <Select
              value={values.projectId}
              onChange={(event) => set('projectId', event.target.value)}
            >
              <option value="">Select a project…</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Target Schema Version"
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
              <option value="">Select a published Schema…</option>
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
            label="Commit to"
            hint="Append every file to one Dataset, or create a Dataset per file."
          >
            <Select
              value={values.datasetId}
              onChange={(event) => set('datasetId', event.target.value)}
            >
              <option value="">— A new Dataset per file —</option>
              {(datasets.data ?? []).map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </Select>
          </Field>
          {values.datasetId ? null : (
            <Field
              label="New Dataset name"
              hint="{connector}, {file} and {date} are filled in."
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
            label="Record on instrument"
            hint="Adds a completed run holding the raw file to this instrument."
          >
            <Select
              value={values.instrumentId}
              onChange={(event) => set('instrumentId', event.target.value)}
            >
              <option value="">— None —</option>
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
              Detect the file format
              <span className="text-fg-muted">
                {' '}
                · otherwise every file uses this connector’s parser
              </span>
            </span>
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              Save pickup settings
            </Button>
            {saved ? (
              <span className="text-label text-fg-muted">Saved.</span>
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
          Ask a workspace owner, admin or steward to change pickup settings.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-label text-fg-muted">
          Run on the instrument computer (create a personal API token with the
          files:write and datasets:write scopes under Settings → Credentials):
        </span>
        <pre className="m-0 overflow-auto rounded border border-border bg-surface-muted p-3 text-label">
          {agentCommand(origin, connector.key)}
        </pre>
      </div>
    </Section>
  )
}
