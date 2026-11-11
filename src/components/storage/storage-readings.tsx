/**
 * Temperature (or any other measurement) kept for a freezer, fridge, incubator
 * or room: the latest reading against its limits, a chart, and a way to log a
 * reading by hand. Probes and loggers send readings the same way instruments do;
 * the people who manage storage are told when one goes out of range.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { ReadingsSection } from '#/components/instruments/live-readings'
import {
  formatAgo,
  liveFeedQueryKeys,
  logStorageReading,
  outOfRangeQueryKey,
  useOutOfRangeStorageFeeds,
  useStorageFeeds,
} from '#/components/instruments/live-feeds-data'
import type {
  FeedRow,
  StoragePlaceKind,
} from '#/components/instruments/live-feeds-data'
import type { StorageNode, StorageTree } from '#/lib/storage-locations'
import { t } from '#/copy'

import { readingKind } from './storage-reading-kind'

/** How many out-of-range measurements sit in each location or below it. */
export function useOutOfRangeCounts(tree: StorageTree | undefined) {
  const feeds = useOutOfRangeStorageFeeds()

  return useMemo(() => {
    const counts = new Map<string, number>()
    const own = new Map<string, FeedRow[]>()

    if (!tree) return { counts, own, feeds: feeds.data ?? [] }

    for (const feed of feeds.data ?? []) {
      const placeId = feed.storageUnitId ?? feed.storageRoomId

      if (!placeId) continue
      own.set(placeId, [...(own.get(placeId) ?? []), feed])
      let node = tree.byId.get(placeId)

      while (node) {
        counts.set(node.id, (counts.get(node.id) ?? 0) + 1)
        node = node.parentId ? tree.byId.get(node.parentId) : undefined
      }
    }

    return { counts, own, feeds: feeds.data ?? [] }
  }, [feeds.data, tree])
}

/** A line above the tree naming what is outside its limits right now. */
export function OutOfRangeNotice({
  tree,
  onSelect,
}: {
  tree: StorageTree
  onSelect: (id: string) => void
}) {
  const { own } = useOutOfRangeCounts(tree)
  const now = Date.now()

  const places = [...own.entries()].flatMap(([id, feeds]) => {
    const node = tree.byId.get(id)

    return node ? [{ node, feeds }] : []
  })

  if (places.length === 0) return null

  return (
    <Notice tone="bad">
      <span className="font-semibold">
        {t('settings.storageReadings.outOfRange', { count: places.length })}
      </span>{' '}
      {places.map(({ node, feeds }, index) => (
        <span key={node.id}>
          {index > 0 ? ', ' : ''}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => onSelect(node.id)}
          >
            {node.name}
          </button>{' '}
          {t('settings.storageReadings.since', {
            when: formatAgo(feeds[0]?.outOfRangeSince ?? null, now),
          })}
        </span>
      ))}
    </Notice>
  )
}

function LogReadingDialog({
  kind,
  node,
  feeds,
  open,
  onOpenChange,
}: {
  kind: StoragePlaceKind
  node: StorageNode
  feeds: FeedRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('Temperature')
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('')

  const existing = feeds.find(
    (f) => f.name.toLowerCase() === name.trim().toLowerCase(),
  )

  const number = value.trim() === '' ? null : Number(value)

  const ready =
    name.trim().length > 0 && number !== null && Number.isFinite(number)

  const mutation = useMutation({
    mutationFn: (reading: number) =>
      logStorageReading({
        kind,
        placeId: node.id,
        feed: name,
        value: reading,
        unit: unit || existing?.unit || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: liveFeedQueryKeys.feeds(node.id),
      })
      void queryClient.invalidateQueries({ queryKey: outOfRangeQueryKey })
      onOpenChange(false)
      setValue('')
      toast(t('settings.storageReadings.logged', { name: node.name }))
    },
    onError: (error) => {
      toast(t('settings.storageReadings.couldNotLog'), {
        description: error.message,
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('settings.storageReadings.logTitle', { name: node.name })}
          description={t('settings.storageReadings.logDescription')}
        />
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Field label={t('settings.storageReadings.measurement')}>
              <Input
                list="storage-reading-names"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <datalist id="storage-reading-names">
                {feeds.map((f) => (
                  <option key={f.id} value={f.name} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('settings.storageReadings.value')}>
                <Input
                  inputMode="decimal"
                  value={value}
                  autoFocus
                  onChange={(e) => setValue(e.target.value)}
                />
              </Field>
              <Field label={t('settings.storageReadings.unit')}>
                <Input
                  value={unit}
                  placeholder={existing?.unit ?? '°C'}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || mutation.isPending}
            onClick={() => {
              if (number === null || !Number.isFinite(number)) return
              mutation.mutate(number)
            }}
          >
            {mutation.isPending
              ? t('common.states.saving')
              : t('settings.storageReadings.log')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function StorageReadingsSection({
  node,
  canLog,
  canSetLimits,
}: {
  node: StorageNode
  /** Anyone who can write in the workspace. */
  canLog: boolean
  /** The people who manage storage. */
  canSetLimits: boolean
}) {
  const kind = readingKind(node)
  const feeds = useStorageFeeds(kind ?? 'unit', kind ? node.id : '')
  const [logging, setLogging] = useState(false)

  if (!kind) return null
  const rows = feeds.data ?? []

  return (
    <>
      <ReadingsSection
        ownerId={node.id}
        fileLabel={node.code ?? node.name}
        feeds={rows}
        loaded={feeds.isSuccess}
        canSetLimits={canSetLimits}
        hideWhenEmpty={!canLog}
        title={t('settings.storageReadings.title', { name: node.name })}
        empty={t('settings.storageReadings.empty')}
        defaultWindow="24h"
        className="flex flex-col gap-3 pt-2"
        action={
          canLog ? (
            <Button size="sm" onClick={() => setLogging(true)}>
              {t('settings.storageReadings.logReading')}
            </Button>
          ) : null
        }
      />
      <LogReadingDialog
        key={node.id}
        kind={kind}
        node={node}
        feeds={rows}
        open={logging}
        onOpenChange={setLogging}
      />
    </>
  )
}
