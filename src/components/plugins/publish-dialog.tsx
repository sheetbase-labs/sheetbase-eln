import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { FieldForm, readFieldValues } from '#/components/plugins/field-form'
import type { FieldValues } from '#/components/plugins/field-form'
import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { t } from '#/copy'
import type { ExtensionPublisherDeclaration } from '#/lib/extensions/data-points'
import type { RunnerItem } from '#/lib/extensions/runner-points'

export type PublisherItem = RunnerItem<ExtensionPublisherDeclaration>

interface Sent {
  message: string
  link?: string
  rows: number
}

/**
 * Sends a dataset to another system with a plugin publisher. It says where the
 * data will go before anything leaves, asks for whatever the publisher needs,
 * and reports exactly what the other system answered.
 */
export function PublishDialog({
  publisher,
  datasetName,
  datasetId,
  onClose,
}: {
  publisher: PublisherItem
  datasetName: string
  datasetId: string
  onClose: () => void
}) {
  const declaration = publisher.declaration
  const [values, setValues] = useState<FieldValues>({})
  const [missing, setMissing] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: async (): Promise<Sent | undefined> => {
      const parameters = readFieldValues(declaration.parameters, values)
      if (!parameters.ok) {
        setMissing(parameters.missing[0])
        return undefined
      }
      setMissing(null)
      const response = await fetch(
        `/api/plugins/publish-dataset/${encodeURIComponent(datasetId)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            extensionKey: publisher.extensionKey,
            publisherId: publisher.id,
            parameters: parameters.input,
          }),
        },
      )
      const body = (await response.json().catch(() => null)) as
        (Sent & { error?: { message?: string } }) | null
      if (!response.ok || !body?.message)
        throw new Error(
          body?.error?.message ?? t('plugins.publish.couldNotSend'),
        )
      return body
    },
  })
  const sent = send.data
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('plugins.publish.title', { name: declaration.title })}
          description={t('plugins.publish.where', {
            dataset: datasetName,
            hosts: declaration.hosts.join(', '),
            plugin: publisher.extensionName,
          })}
        />
        <DialogBody>
          <p className="m-0 text-body text-fg-muted">
            {declaration.description}
          </p>
          {declaration.parameters.length > 0 ? (
            <FieldForm
              fields={declaration.parameters}
              values={values}
              onChange={setValues}
              disabled={send.isPending || Boolean(sent)}
            />
          ) : null}
          {missing ? (
            <p role="status" className="m-0 text-label text-danger-text">
              {t('plugins.import.needs', { name: missing })}
            </p>
          ) : null}
          {send.error ? (
            <Banner tone="bad" title={t('plugins.publish.notSent')}>
              {send.error.message}
            </Banner>
          ) : null}
          {sent ? (
            <Banner
              tone="info"
              title={t('plugins.publish.sent', { name: declaration.title })}
            >
              {sent.message}
              {sent.link ? (
                <>
                  {' '}
                  <a
                    href={sent.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link underline"
                  >
                    {t('plugins.publish.open')}
                  </a>
                </>
              ) : null}
            </Banner>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {sent ? t('common.actions.close') : t('common.actions.cancel')}
          </Button>
          {sent ? null : (
            <Button
              type="button"
              variant="primary"
              disabled={send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending
                ? t('plugins.publish.sending')
                : t('plugins.publish.send')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
