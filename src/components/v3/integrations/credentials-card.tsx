/**
 * INT-03 — connector credentials card (steward-gated). UI port: app-3's v3 kit.
 *
 * Wraps the INT-01 sealed-secret functions: only secret *names* and
 * timestamps are visible. Values are set once, rotatable, deletable — never
 * readable. Enterprise connectors declare the names they need so missing
 * credentials are obvious before a run is attempted.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Icon } from '#/components/v3/icons'
import {
  deleteConnectorSecretFn,
  listConnectorSecretNamesFn,
  setConnectorSecretFn,
} from '#/lib/connector-secret-admin'
import { t } from '#/copy'

export function ConnectorCredentialsCard({
  workspaceId,
  connectorId,
  requiredSecrets,
  canManage,
}: {
  workspaceId: string
  connectorId: string
  /** Secret names this connector's adapter requires. */
  requiredSecrets: readonly string[]
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [secretName, setSecretName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const secretsQuery = useQuery({
    queryKey: ['connectors', connectorId, 'secret-names'],
    queryFn: () =>
      listConnectorSecretNamesFn({ data: { workspaceId, connectorId } }),
  })

  const setMutation = useMutation({
    mutationFn: (input: { secretName: string; value: string }) =>
      setConnectorSecretFn({ data: { workspaceId, connectorId, ...input } }),
    onSuccess: () => {
      setError(null)
      setValue('')
      void queryClient.invalidateQueries({
        queryKey: ['connectors', connectorId, 'secret-names'],
      })
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      deleteConnectorSecretFn({
        data: { workspaceId, connectorId, secretName: name },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['connectors', connectorId, 'secret-names'],
      })
    },
  })

  const stored = new Set(
    (secretsQuery.data ?? []).map((entry) => entry.secretName),
  )
  const missing = requiredSecrets.filter((name) => !stored.has(name))

  if (!canManage) {
    return null
  }

  return (
    <Section title={t('settings.integrations.credentialsCard.credentials')}>
      <p className="m-0 max-w-3xl text-body text-fg-muted">
        {t('settings.integrations.credentialsCard.sealedServerSide')}
        {missing.length > 0 ? (
          <span className="text-danger-text">
            {t('settings.integrations.credentialsCard.missingRequired', {
              missing: missing.join(', '),
            })}
          </span>
        ) : null}
      </p>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {(secretsQuery.data ?? []).map((entry) => (
          <div
            key={entry.secretName}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span className="flex items-center gap-2 mono text-label">
              <Icon name="key" size={14} />
              {entry.secretName}
              <span className="text-fg-muted">
                updated {new Date(entry.updatedAt).toLocaleString()}
              </span>
            </span>
            <Button
              size="sm"
              variant="quiet"
              aria-label={t(
                'settings.integrations.credentialsCard.deleteAria',
                { secretName: entry.secretName },
              )}
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(entry.secretName)}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
        ))}
        {(secretsQuery.data ?? []).length === 0 && (
          <p className="m-0 px-3 py-2 text-label text-fg-muted">
            {t('settings.integrations.credentialsCard.credentialsStoredYet')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label={t('settings.integrations.credentialsCard.secretName')}>
          <Input
            value={secretName}
            onChange={(event) => setSecretName(event.target.value)}
            placeholder="access_key_id"
          />
        </Field>
        <Field label={t('settings.integrations.credentialsCard.value')}>
          <Input
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <Button
          disabled={
            !secretName.trim() || !value.trim() || setMutation.isPending
          }
          onClick={() => setMutation.mutate({ secretName, value })}
        >
          {stored.has(secretName)
            ? t('settings.integrations.credentialsCard.rotateAction')
            : t('settings.integrations.credentialsCard.setAction')}
        </Button>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </Section>
  )
}
