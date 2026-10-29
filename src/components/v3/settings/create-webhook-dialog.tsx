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
          title={created ? 'Webhook added' : 'Add outgoing webhook'}
          description={
            created
              ? undefined
              : 'Sheetbase sends a signed message to this address when the chosen events happen.'
          }
        />
        <DialogBody>
          {created ? (
            <>
              {created.signingSecret ? (
                <>
                  <p className="m-0 text-body">
                    Copy the signing secret now. It can’t be shown again; the
                    receiving system uses it to check each message came from
                    Sheetbase.
                  </p>
                  <Input
                    readOnly
                    aria-label="Signing secret"
                    className="mono"
                    value={created.signingSecret}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </>
              ) : null}
            </>
          ) : (
            <>
              <Field label="Name" hint="For example, Lab dashboard.">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field
                label="Address"
                hint="Must start with https://."
                error={
                  url && !validUrl
                    ? 'Enter an address starting with https://'
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
                <span className="text-label font-medium">Events</span>
                <label className="flex items-center gap-2 text-body">
                  <Checkbox
                    checked={allEvents}
                    onCheckedChange={(on) => setAllEvents(Boolean(on))}
                  />
                  Everything Sheetbase can send
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
              Done
            </DialogClose>
          ) : (
            <>
              <DialogClose render={<Button />}>Cancel</DialogClose>
              <Button
                variant="primary"
                disabled={!ready || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Adding…' : 'Add webhook'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
