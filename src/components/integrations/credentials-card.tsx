/**
 * INT-03 — connector credentials card (steward-gated).
 *
 * Wraps the INT-01 sealed-secret functions: only secret *names* and
 * timestamps are visible. Values are set once, rotatable, deletable — never
 * readable. Enterprise connectors declare the names they need so missing
 * credentials are obvious before a run is attempted.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react'

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from '#/components/ui'
import {
  deleteConnectorSecretFn,
  listConnectorSecretNamesFn,
  setConnectorSecretFn,
} from '#/lib/connector-secret-admin'

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
    <Card>
      <CardHeader>
        <CardTitle>Credentials</CardTitle>
        <CardDescription>
          Sealed server-side secrets. Names are visible; values are set once and
          never returned to any client.
          {missing.length > 0 && (
            <span className="text-destructive">
              {' '}
              Missing required: {missing.join(', ')}.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {(secretsQuery.data ?? []).map((entry) => (
          <div
            key={entry.secretName}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 font-mono text-xs">
              <KeyRound className="size-3.5" />
              {entry.secretName}
              <span className="text-muted-foreground">
                updated {new Date(entry.updatedAt).toLocaleString()}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(entry.secretName)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
        {(secretsQuery.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-xs">
            No credentials stored yet.
          </p>
        )}
        <Separator />
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="secret-name">Secret name</Label>
            <Input
              id="secret-name"
              value={secretName}
              onChange={(event) => setSecretName(event.target.value)}
              placeholder="access_key_id"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="secret-value">Value</Label>
            <Input
              id="secret-value"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button
            size="sm"
            disabled={
              !secretName.trim() || !value.trim() || setMutation.isPending
            }
            onClick={() => setMutation.mutate({ secretName, value })}
          >
            {stored.has(secretName) ? 'Rotate' : 'Set'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
