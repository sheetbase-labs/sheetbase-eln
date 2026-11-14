import { SearchableSelect } from '#/components/record-picker/searchable-select'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '#/components/ui/dialog'
import { describeAdminError } from '#/lib/workspace-admin'
import {
  createWebhookSubscriptionFn,
  listWebhookRecipientsFn,
  webhookAdminKeys,
  webhookRecipientKeys,
} from '#/lib/webhook-admin'
import type {
  CreatedWebhookWire,
  WebhookChannelType,
} from '#/lib/webhook-admin'
import { WEBHOOK_EVENT_OPTIONS } from '#/lib/event-catalogue'
import { t } from '#/copy'
import { CreationDialogFooter } from './creation-dialog-footer'

/** The events a webhook can listen for, under their group headings. */
const eventGroups = WEBHOOK_EVENT_OPTIONS.reduce<
  Array<{
    name: string
    options: Array<(typeof WEBHOOK_EVENT_OPTIONS)[number]>
  }>
>((groups, option) => {
  const group = groups.find((g) => g.name === option.group)

  if (group) group.options.push(option)
  else groups.push({ name: option.group, options: [option] })

  return groups
}, [])

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
  const [channelType, setChannelType] = useState<WebhookChannelType>('webhook')
  const [url, setUrl] = useState('')
  const [recipientUserId, setRecipientUserId] = useState('')
  const [allEvents, setAllEvents] = useState(true)
  const [events, setEvents] = useState<string[]>([])
  const [created, setCreated] = useState<CreatedWebhookWire | null>(null)
  const isEmail = channelType === 'email'

  const recipients = useQuery({
    queryKey: webhookRecipientKeys.list(workspaceId),
    queryFn: () => listWebhookRecipientsFn({ data: { workspaceId } }),
    enabled: isEmail,
  })

  const validUrl = /^https:\/\/\S+$/.test(url.trim())
  const destinationReady = isEmail ? recipientUserId !== '' : validUrl

  const ready =
    destinationReady &&
    name.trim().length > 0 &&
    (allEvents || events.length > 0)

  const create = useMutation({
    mutationFn: () =>
      createWebhookSubscriptionFn({
        data: {
          workspaceId,
          name,
          url,
          eventTypes: allEvents ? [] : events,
          channelType,
          recipientUserId: isEmail ? recipientUserId : null,
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
              <Field label={t('settings.createWebhookDialog.sendTo')}>
                <Select
                  value={channelType}
                  onChange={(e) => {
                    const value = e.target.value

                    if (
                      value === 'webhook' ||
                      value === 'teams' ||
                      value === 'email'
                    )
                      setChannelType(value)
                  }}
                >
                  <option value="webhook">
                    {t('settings.createWebhookDialog.sendToWebhook')}
                  </option>
                  <option value="teams">
                    {t('settings.createWebhookDialog.sendToTeams')}
                  </option>
                  <option value="email">
                    {t('settings.createWebhookDialog.sendToEmail')}
                  </option>
                </Select>
              </Field>
              {isEmail ? (
                <Field
                  label={t('settings.createWebhookDialog.person')}
                  hint={t('settings.createWebhookDialog.personHint')}
                >
                  <SearchableSelect
                    noun="destination"
                    value={recipientUserId}
                    onValueChange={(value) => setRecipientUserId(value)}
                  >
                    <option value="">
                      {t('settings.createWebhookDialog.choosePerson')}
                    </option>
                    {(recipients.data ?? []).map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.name || person.email}
                      </option>
                    ))}
                  </SearchableSelect>
                </Field>
              ) : (
                <WebhookAddress
                  channelType={channelType}
                  url={url}
                  validUrl={validUrl}
                  onChange={setUrl}
                />
              )}
              <WebhookEvents
                allEvents={allEvents}
                events={events}
                onAllEvents={setAllEvents}
                onEvents={setEvents}
              />
              {create.isError ? (
                <Notice tone="bad">{describeAdminError(create.error)}</Notice>
              ) : null}
            </>
          )}
        </DialogBody>
        <CreationDialogFooter
          complete={created !== null}
          pending={create.isPending}
          ready={ready}
          onCreate={() => create.mutate()}
          createLabel={t('settings.createWebhookDialog.addWebhook')}
          pendingLabel={t('settings.createWebhookDialog.adding')}
        />
      </DialogContent>
    </Dialog>
  )
}

function WebhookAddress({
  channelType,
  url,
  validUrl,
  onChange,
}: {
  channelType: WebhookChannelType
  url: string
  validUrl: boolean
  onChange: (url: string) => void
}) {
  const teams = channelType === 'teams'

  return (
    <Field
      label={
        teams
          ? t('settings.createWebhookDialog.teamsAddress')
          : t('settings.createWebhookDialog.address')
      }
      hint={
        teams
          ? t('settings.createWebhookDialog.teamsAddressHint')
          : t('settings.createWebhookDialog.mustStartHttpsHint')
      }
      error={
        url && !validUrl
          ? t('settings.createWebhookDialog.enterAddressStarting')
          : undefined
      }
    >
      <Input
        value={url}
        placeholder={
          teams
            ? 'https://example.webhook.office.com/…'
            : 'https://example.com/hooks/sheetbase'
        }
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function WebhookEvents({
  allEvents,
  events,
  onAllEvents,
  onEvents,
}: {
  allEvents: boolean
  events: string[]
  onAllEvents: (all: boolean) => void
  onEvents: Dispatch<SetStateAction<string[]>>
}) {
  const selectedEvents = new Set(events)

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label font-medium">
        {t('settings.createWebhookDialog.events')}
      </span>
      <label className="flex items-center gap-2 text-body">
        <Checkbox
          checked={allEvents}
          onCheckedChange={(on) => onAllEvents(Boolean(on))}
        />
        {t('settings.createWebhookDialog.everythingSheetbaseSend')}
      </label>
      {allEvents ? null : (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border border-border p-2">
          {eventGroups.map((group) => (
            <div key={group.name} className="flex flex-col gap-1">
              <span className="text-label font-medium text-fg-muted">
                {group.name}
              </span>
              {group.options.map((option) => (
                <label
                  key={option.name}
                  className="flex items-center gap-2 text-body"
                >
                  <Checkbox
                    checked={selectedEvents.has(option.name)}
                    onCheckedChange={(on) =>
                      onEvents((current) =>
                        on
                          ? [...current, option.name]
                          : current.filter((event) => event !== option.name),
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
