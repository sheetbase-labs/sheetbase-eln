import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import {
  connectionsQueryKey,
  saveConnection,
} from '#/lib/extensions/outgoing-client'
import type { ConnectionWire } from '#/lib/extensions/outgoing-client'

/** Whether a connection still needs something filled in. */
export const connectionNeedsSetup = (connection: ConnectionWire) =>
  connection.settings.some((setting) => setting.required && !setting.isSet)

/**
 * What a plugin's publishers, notification channels and connectors need before
 * they can work: an address, a token. A secret is sealed when saved and is
 * never shown again, so leaving its box empty keeps what is there.
 */
export function PluginConnectionsDialog({
  name,
  connections,
  onClose,
}: {
  name: string
  connections: ConnectionWire[]
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="w-[min(640px,calc(100vw-32px))]">
        <DialogHeader
          title={t('plugins.admin.connections.title', { name })}
          description={t('plugins.admin.connections.intro')}
        />
        <DialogBody>
          {connections.map((connection) => (
            <ConnectionForm
              key={`${connection.point}:${connection.itemId}`}
              connection={connection}
            />
          ))}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConnectionForm({ connection }: { connection: ConnectionWire }) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: (typed: Record<string, string>) =>
      saveConnection({
        extensionId: connection.extensionId,
        point: connection.point,
        itemId: connection.itemId,
        // Only what was typed: an untouched secret stays as it is.
        values: typed,
      }),
    onSuccess: () => {
      toast(t('plugins.admin.connections.saved', { name: connection.title }))
      setValues({})
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey })
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('plugins.admin.couldNotChange'),
      ),
  })

  const needs = connectionNeedsSetup(connection)

  return (
    <section
      aria-label={connection.title}
      className="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-medium text-fg">{connection.title}</span>
          <span className="text-caption text-fg-muted">
            {t(`plugins.admin.connections.kind.${connection.point}`)}
            {' · '}
            {t('plugins.admin.connections.hosts', {
              hosts: connection.hosts.join(', '),
            })}
          </span>
        </div>
        <Status tone={needs ? 'warn' : 'ok'}>
          {t(
            needs
              ? 'plugins.admin.connections.needsSetup'
              : 'plugins.admin.connections.ready',
          )}
        </Status>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {connection.settings.map((setting) => (
          <Field
            key={setting.name}
            label={setting.label}
            required={setting.required}
            hint={
              setting.secret && setting.isSet
                ? t('plugins.admin.connections.secretKept')
                : setting.secret
                  ? t('plugins.admin.connections.secretHint')
                  : undefined
            }
          >
            <Input
              type={setting.secret ? 'password' : 'text'}
              autoComplete="off"
              value={
                (values as Partial<Record<string, string>>)[setting.name] ??
                setting.value ??
                ''
              }
              placeholder={
                setting.secret && setting.isSet ? '••••••••••••' : undefined
              }
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [setting.name]: event.target.value,
                }))
              }
            />
          </Field>
        ))}
      </div>
      <div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={save.isPending || Object.keys(values).length === 0}
          onClick={() => save.mutate(values)}
        >
          {t('common.actions.save')}
        </Button>
      </div>
    </section>
  )
}
