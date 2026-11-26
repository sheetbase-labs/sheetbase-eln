import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

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
import { connectionNeedsSetup } from './plugin-status'

export { connectionNeedsSetup } from './plugin-status'

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
  const [values, setValues] = useState(() => new Map<string, string>())

  const [check, setCheck] = useState<{
    works: boolean
    message: string | null
  } | null>(null)

  const save = useMutation({
    mutationFn: (typed: Record<string, string | null>) =>
      saveConnection({
        extensionId: connection.extensionId,
        point: connection.point,
        itemId: connection.itemId,
        // Only what was typed: an untouched secret stays as it is.
        values: typed,
      }),
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('plugins.admin.couldNotChange'),
      ),
  })

  // Saves as you leave a box. A plain setting can be put back with Undo; a
  // sealed secret cannot be read, so its old value cannot be restored.
  const commit = (name: string) => {
    const setting = connection.settings.find((entry) => entry.name === name)
    const typed = values.get(name)

    if (!setting || typed === undefined) return
    const before = setting.secret ? null : setting.value

    if (typed === (setting.value ?? '') && !setting.secret) return

    if (setting.secret && typed.trim() === '') {
      setValues((current) => {
        const next = new Map(current)

        next.delete(name)

        return next
      })

      return
    }

    save.mutate(
      { [name]: typed },
      {
        onSuccess: () => {
          setValues(new Map())
          setCheck(null)
          void queryClient.invalidateQueries({ queryKey: connectionsQueryKey })
          toast(
            t('plugins.admin.connections.saved', { name: connection.title }),
            setting.secret
              ? undefined
              : {
                  action: {
                    label: t('common.actions.undo'),
                    onClick: () =>
                      save.mutate(
                        { [name]: before },
                        {
                          onSuccess: () =>
                            void queryClient.invalidateQueries({
                              queryKey: connectionsQueryKey,
                            }),
                        },
                      ),
                  },
                },
          )
        },
      },
    )
  }

  const testable = connection.extensionKey === 'protocols-io'

  const test = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        '/api/plugins/protocols-io/test-connection',
        {
          method: 'POST',
        },
      )

      if (!response.ok)
        throw new Error(t('plugins.admin.connections.testFailed'))

      return z
        .object({ works: z.boolean(), message: z.string().nullable() })
        .parse(await response.json())
    },
    onSuccess: setCheck,
    onError: () =>
      setCheck({
        works: false,
        message: t('plugins.admin.connections.testFailed'),
      }),
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
            {connection.hosts.length > 0
              ? ` · ${t('plugins.admin.connections.hosts', {
                  hosts: connection.hosts.join(', '),
                })}`
              : null}
          </span>
        </div>
        <Status
          tone={check ? (check.works ? 'ok' : 'bad') : needs ? 'warn' : 'ok'}
        >
          {check
            ? t(
                check.works
                  ? 'plugins.admin.connections.works'
                  : 'plugins.admin.connections.notWorking',
              )
            : t(
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
              value={values.get(setting.name) ?? setting.value ?? ''}
              placeholder={
                setting.secret && setting.isSet ? '••••••••••••' : undefined
              }
              onChange={(event) =>
                setValues((current) =>
                  new Map(current).set(setting.name, event.target.value),
                )
              }
              onBlur={() => commit(setting.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit(setting.name)
              }}
            />
          </Field>
        ))}
      </div>
      {check && !check.works && check.message ? (
        <p role="alert" className="text-label text-danger-text">
          {check.message}
        </p>
      ) : null}
      {testable ? (
        <div>
          <Button
            type="button"
            size="sm"
            disabled={test.isPending || save.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending
              ? t('plugins.admin.connections.testing')
              : t('plugins.admin.connections.test')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
