/**
 * Editor for an enterprise connector's non-secret settings (bucket, prefix, host,
 * port, database, SSL mode), bound to `updateConnector({ config })`.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { createDataClient } from '#/lib/data-client'
import {
  connectorQueryKeys,
  describeConnectorsError,
  updateConnector,
} from '#/lib/connectors/client'
import {
  CONNECTOR_CONFIG_FIELDS,
  buildConnectorConfig,
  configFormValues,
  missingConfigLabels,
} from '#/lib/connectors/enterprise/config-form'
import type { ConnectorConfigValues } from '#/lib/connectors/enterprise/config-form'
import type { EnterpriseAdapterId } from '#/lib/connectors/enterprise/types'
import type { ConnectorWire } from '#/lib/connectors/types'
import { t } from '#/copy'

const dataClient = createDataClient()

export function ConnectorConfigCard({
  workspaceId,
  connector,
  adapter,
  canManage,
}: {
  workspaceId: string
  connector: ConnectorWire
  adapter: EnterpriseAdapterId
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<ConnectorConfigValues>(() =>
    configFormValues(adapter, connector.config),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const missing = missingConfigLabels(adapter, connector.config)

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

  const fields = CONNECTOR_CONFIG_FIELDS[adapter]
  const stored = configFormValues(adapter, connector.config)

  return (
    <Section title={t('settings.integrations.configCard.sourceSettings')}>
      {missing.length > 0 ? (
        <Notice
          tone="warn"
          title={t('settings.integrations.configCard.configuredYet')}
        >
          {t('settings.integrations.configCard.cantTestImport', {
            count: missing.length,
            name: connector.name,
            missing: missing.join(', '),
          })}{' '}
          {canManage
            ? t('settings.integrations.configCard.fillThemBelow')
            : t('settings.integrations.configCard.askWorkspaceOwner')}
        </Notice>
      ) : null}
      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            setSaved(false)
            const built = buildConnectorConfig(
              adapter,
              connector.config,
              values,
            )
            if (!built.ok) {
              setErrors(built.errors)
              return
            }
            setErrors({})
            save.mutate(built.config)
          }}
        >
          {fields.map((field) => {
            const value = values[field.name]
            const set = (next: string | boolean) => {
              setSaved(false)
              setValues((prev) => ({ ...prev, [field.name]: next }))
            }
            if (field.kind === 'boolean') {
              return (
                <label
                  key={field.name}
                  className="flex items-center gap-2 text-label sm:col-span-2"
                >
                  <Checkbox
                    checked={Boolean(value)}
                    onCheckedChange={(checked) => set(Boolean(checked))}
                  />
                  <span>
                    {field.label}
                    {field.hint ? (
                      <span className="text-fg-muted"> · {field.hint}</span>
                    ) : null}
                  </span>
                </label>
              )
            }
            return (
              <Field
                key={field.name}
                label={field.label}
                required={field.required}
                hint={field.hint}
                error={errors[field.name]}
              >
                {field.kind === 'select' ? (
                  <Select
                    value={String(value)}
                    onChange={(event) => set(event.target.value)}
                  >
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={String(value)}
                    inputMode={field.kind === 'port' ? 'numeric' : undefined}
                    aria-invalid={errors[field.name] ? true : undefined}
                    onChange={(event) => set(event.target.value)}
                  />
                )}
              </Field>
            )
          })}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="primary" disabled={save.isPending}>
              {save.isPending
                ? t('common.states.saving')
                : t('settings.integrations.configCard.saveSettings')}
            </Button>
            {saved ? (
              <span role="status" className="text-label text-fg-muted">
                {t('settings.integrations.configCard.saved')}
              </span>
            ) : null}
          </div>
          {save.isError ? (
            <div className="sm:col-span-2">
              <Notice tone="bad">
                {describeConnectorsError(save.error)}
                {t('settings.integrations.configCard.nothingChanged')}
              </Notice>
            </div>
          ) : null}
        </form>
      ) : (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
          {fields.map((field) => (
            <div key={field.name} className="contents">
              <dt className="text-fg-muted">{field.label}</dt>
              <dd className="m-0">{String(stored[field.name]) || 'not set'}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  )
}
