/**
 * Subscribe to the Schedule in a calendar app. Makes a private link (the secret
 * is shown once), lists the person's links and lets them revoke any.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { CopyButton } from '#/components/ui/copy-button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { t } from '#/copy'
import {
  calendarFeedKeys,
  createCalendarFeed,
  feedUrl,
  fetchCalendarFeeds,
  revokeCalendarFeed,
  webcalUrl,
} from '#/lib/calendar-feeds'
import type { FeedScope } from '#/lib/calendar-feeds'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'

import type { ScheduleInstrument } from './schedule-data'

const client = notebookDataClient

/** The scopes a subscription can cover, in the order they are offered. */
const FEED_SCOPES = [
  'mine',
  'instrument',
  'all',
] as const satisfies readonly FeedScope[]

export function SubscribeDialog({
  instruments,
}: {
  instruments: ScheduleInstrument[]
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<FeedScope>('mine')
  const [resourceId, setResourceId] = useState('')
  const [label, setLabel] = useState('')
  const [link, setLink] = useState<string | null>(null)

  const feeds = useQuery({
    queryKey: calendarFeedKeys.all,
    queryFn: () => fetchCalendarFeeds(client),
    enabled: open,
    staleTime: 10_000,
  })

  const instrumentName = new Map(instruments.map((i) => [i.id, i.name]))
  const chosenInstrument = resourceId || instruments[0]?.id || ''

  const create = useMutation({
    mutationFn: () =>
      createCalendarFeed(client, {
        scope,
        resourceId: chosenInstrument || null,
        label,
      }),
    onSuccess: ({ token }) => {
      setLink(feedUrl(window.location.origin, token))
      setLabel('')
      void queryClient.invalidateQueries({ queryKey: calendarFeedKeys.all })
    },
    onError: (e: Error) =>
      toast.error(e.message || t('calendarFeed.couldNotCreate')),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeCalendarFeed(client, id),
    onSuccess: () => {
      toast.success(t('calendarFeed.revoked'))
      void queryClient.invalidateQueries({ queryKey: calendarFeedKeys.all })
    },
    onError: () => toast.error(t('calendarFeed.couldNotRevoke')),
  })

  function describe(feed: {
    scope: FeedScope
    resource_id: string | null
    label: string | null
  }): string {
    const what =
      feed.scope === 'instrument'
        ? (instrumentName.get(feed.resource_id ?? '') ??
          t('calendarFeed.scopes.instrument'))
        : t(`calendarFeed.scopes.${feed.scope}`)

    return feed.label ? `${feed.label} · ${what}` : what
  }

  const columns: RegistryColumn<NonNullable<typeof feeds.data>[number]>[] = [
    {
      id: 'name',
      header: t('calendarFeed.columns.name'),
      accessorFn: (feed) => describe(feed),
    },
    {
      id: 'made',
      header: t('calendarFeed.columns.made'),
      accessorFn: (feed) => feed.created_at,
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: 'lastUsed',
      header: t('calendarFeed.columns.lastUsed'),
      accessorFn: (feed) => feed.last_used_at ?? '',
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.last_used_at
            ? formatDate(row.original.last_used_at, { time: true })
            : t('calendarFeed.neverUsed')}
        </span>
      ),
    },
    {
      id: 'revoke',
      header: '',
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex justify-end">
          <Button
            size="sm"
            variant="quiet"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(row.original.id)}
          >
            {t('calendarFeed.revoke')}
          </Button>
        </span>
      ),
    },
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        if (!next) setLink(null)
      }}
    >
      <DialogTrigger render={<Button />}>
        {t('calendarFeed.button')}
      </DialogTrigger>
      <DialogContent className="w-[min(600px,calc(100vw-32px))]">
        <DialogHeader title={t('calendarFeed.title')} />
        <DialogBody>
          <div className="flex flex-col gap-4">
            <p className="m-0 text-body text-fg-muted">
              {t('calendarFeed.intro')}
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={t('calendarFeed.scope')}>
                <Select
                  value={scope}
                  onChange={(e) => {
                    const chosen = FEED_SCOPES.find(
                      (key) => key === e.target.value,
                    )

                    if (chosen) setScope(chosen)
                  }}
                >
                  {FEED_SCOPES.map((key) => (
                    <option key={key} value={key}>
                      {t(`calendarFeed.scopes.${key}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              {scope === 'instrument' ? (
                <Field label={t('calendarFeed.instrument')}>
                  <Select
                    value={chosenInstrument}
                    onChange={(e) => setResourceId(e.target.value)}
                  >
                    {instruments.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field
                label={t('calendarFeed.name')}
                hint={t('calendarFeed.nameHint')}
              >
                <Input
                  value={label}
                  maxLength={120}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
            </div>
            <div>
              <Button
                variant="primary"
                disabled={
                  create.isPending ||
                  (scope === 'instrument' && chosenInstrument === '')
                }
                onClick={() => create.mutate()}
              >
                {create.isPending
                  ? t('calendarFeed.creating')
                  : t('calendarFeed.create')}
              </Button>
            </div>
            {link ? (
              <div
                role="status"
                className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted p-3"
              >
                <span className="text-label font-medium">
                  {t('calendarFeed.newLink')}
                </span>
                <Input
                  readOnly
                  value={link}
                  aria-label={t('calendarFeed.newLink')}
                  className="mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <span className="text-label text-fg-muted">
                  {t('calendarFeed.newLinkHint')}
                </span>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    value={link}
                    variant="secondary"
                    copiedMessage={t('calendarFeed.copied')}
                    failedMessage={t('calendarFeed.copyFailed')}
                  >
                    {t('calendarFeed.copy')}
                  </CopyButton>
                  <Button
                    size="sm"
                    nativeButton={false}
                    // react-doctor-disable-next-line react-doctor/anchor-has-content -- Button forwards its visible open-in-calendar children to this anchor through Base UI's render prop.
                    render={<a href={webcalUrl(link)} />}
                  >
                    {t('calendarFeed.open')}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <span className="text-label font-medium">
                {t('calendarFeed.yours')}
              </span>
              <TableBox>
                <RegistryGrid
                  label={t('calendarFeed.yours')}
                  rows={feeds.data ?? []}
                  columns={columns}
                  getRowId={(feed) => feed.id}
                  selectable={false}
                  isLoading={feeds.isPending}
                  empty={t('calendarFeed.noneYet')}
                />
              </TableBox>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('calendarFeed.close')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
