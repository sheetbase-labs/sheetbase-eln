import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { describeAdminError } from '#/lib/workspace-admin'
import {
  createWebhookSubscriptionFn,
  webhookAdminKeys,
} from '#/lib/webhook-admin'
import type { CreatedWebhookWire } from '#/lib/webhook-admin'
import { STABLE_EVENT_TYPES } from '#/lib/webhook-events'
import { t } from '#/copy'

/** Add an outgoing webhook: where to send, and which events. The signing
 * secret is shown once when it is created, because it can't be read again. */
export function CreateWebhookDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [allEvents, setAllEvents] = useState(true)
  const [events, setEvents] = useState<string[]>([])
  const [created, setCreated] = useState<CreatedWebhookWire | null>(null)

  const validUrl = /^https:\/\/\S+$/.test(url.trim())
  const ready =
    validUrl && name.trim().length > 0 && (allEvents || events.length > 0)
  const create = useMutation({
    mutationFn: () =>
      createWebhookSubscriptionFn({
        data: {
          workspaceId,
          name,
          url,
          eventTypes: allEvents ? [] : events,
        },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: webhookAdminKeys.subscriptions(workspaceId),
      })
      setCreated(result)
    },
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title={
            created
              ? t('settings.createWebhookDialog.webhookAdded')
              : t('settings.createWebhookDialog.addOutgoingWebhook')
          }
          description={
            created
              ? undefined
              : t('settings.createWebhookDialog.sheetbaseSendsSigned')
          }
        />
        <DialogBody>
          {created ? (
            <>
              {created.signingSecret ? (
                <>
                  <p className="m-0 text-body">
                    {t('settings.createWebhookDialog.copySigningSecret')}
                  </p>
                  <Input
                    readOnly
                    aria-label={t(
                      'settings.createWebhookDialog.signingSecretAria',
                    )}
                    className="mono"
                    value={created.signingSecret}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <Field
                label={t('settings.createWebhookDialog.name')}
                hint={t('settings.createWebhookDialog.exampleLabDashboardHint')}
              >
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label={t('settings.createWebhookDialog.address')}
                hint={t('settings.createWebhookDialog.mustStartHttpsHint')}
                error={
                  url && !validUrl
                    ? t('settings.createWebhookDialog.enterAddressStarting')
                    : undefined
                }
              >
                <Input
                  value={url}
                  placeholder="https://example.com/hooks/sheetbase"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-label font-medium">
                  {t('settings.createWebhookDialog.events')}
                </span>
                <label className="flex items-center gap-2 text-body">
                  <Checkbox
                    checked={allEvents}
                    onCheckedChange={(on) => setAllEvents(Boolean(on))}
                  />
                  {t('settings.createWebhookDialog.everythingSheetbaseSend')}
                </label>
                {allEvents ? null : (
                  <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                    {STABLE_EVENT_TYPES.map((type) => (
                      <label
                        key={type}
                        className="flex items-center gap-2 text-body"
                      >
                        <Checkbox
                          checked={events.includes(type)}
                          onCheckedChange={(on) =>
                            setEvents((current) =>
                              on
                                ? [...current, type]
                                : current.filter((t) => t !== type),
                            )
                          }
                        />
                        {type}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {create.isError ? (
                <Notice tone="bad">{describeAdminError(create.error)}</Notice>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {created ? (
            <DialogClose render={<Button variant="primary" />}>
              {t('common.actions.done')}
            </DialogClose>
          ) : (
            <>
              <DialogClose render={<Button />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="primary"
                disabled={!ready || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending
                  ? t('settings.createWebhookDialog.adding')
                  : t('settings.createWebhookDialog.addWebhook')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
