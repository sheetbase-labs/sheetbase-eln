/**
 * What a registry entry came from and what has been made from it, plus the
 * Retire / Restore action. Shown on the record page of any model that is a
 * registry.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field } from '#/components/ui/input'
import { Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  PARENT_ROLES,
  addParent,
  fetchLineageLinks,
  fetchRegistryEntries,
  fetchRegistryModels,
  messageOf,
  registryKeys,
  removeParent,
  walkLineage,
} from '#/lib/bio-registry'
import type { LineageNode, ParentRole } from '#/lib/bio-registry'

const client = notebookDataClient

function useRegistryGraph() {
  const models = useQuery({
    queryKey: registryKeys.models,
    queryFn: () => fetchRegistryModels(client),
    staleTime: 10_000,
  })

  const keys = useMemo(
    () => (models.data ?? []).map((m) => m.key),
    [models.data],
  )

  const entries = useQuery({
    queryKey: registryKeys.entries(keys),
    queryFn: () => fetchRegistryEntries(client, keys),
    enabled: keys.length > 0,
    staleTime: 10_000,
  })

  const ids = useMemo(
    () => (entries.data ?? []).map((e) => e.id),
    [entries.data],
  )

  const links = useQuery({
    queryKey: [...registryKeys.lineage, ids.length],
    queryFn: () => fetchLineageLinks(client, ids),
    enabled: ids.length > 0,
    staleTime: 10_000,
  })

  return {
    models: models.data ?? [],
    entries: entries.data ?? [],
    links: links.data ?? [],
  }
}

export function RegistryLineage({
  entryId,
  identifier,
  canWrite,
}: {
  entryId: string
  identifier: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const graph = useRegistryGraph()
  const [adding, setAdding] = useState(false)

  const modelName = useMemo(
    () => new Map(graph.models.map((m) => [m.key, m.name] as const)),
    [graph.models],
  )

  const up = useMemo(
    () => walkLineage(entryId, 'up', graph.entries, graph.links),
    [entryId, graph.entries, graph.links],
  )

  const down = useMemo(
    () => walkLineage(entryId, 'down', graph.entries, graph.links),
    [entryId, graph.entries, graph.links],
  )

  const unlink = useMutation({
    mutationFn: (node: LineageNode) =>
      removeParent(client, entryId, node.entry.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      toast.success(t('registry.entry.parentRemoved'))
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.entry.couldNotLink'))),
  })

  function columns(removable: boolean): RegistryColumn<LineageNode>[] {
    return [
      {
        id: 'number',
        header: t('registry.entry.lineageColumns.number'),
        size: 110,
        cell: ({ row }) => (
          <span className="mono text-fg-muted">
            {row.original.entry.identifier}
          </span>
        ),
      },
      {
        id: 'name',
        header: t('registry.entry.lineageColumns.name'),
        size: 260,
        cell: ({ row }) => (
          <Link
            to="/models/$modelId/records/$recordId"
            params={{
              modelId: row.original.entry.kind,
              recordId: row.original.entry.id,
            }}
            className="truncate font-medium text-fg hover:underline"
          >
            {row.original.entry.title}
          </Link>
        ),
      },
      {
        id: 'registry',
        header: t('registry.entry.lineageColumns.registry'),
        size: 130,
        cell: ({ row }) => (
          <span className="truncate">
            {modelName.get(row.original.entry.kind) ?? row.original.entry.kind}
          </span>
        ),
      },
      {
        id: 'role',
        header: t('registry.entry.lineageColumns.role'),
        size: 150,
        cell: ({ row }) => (
          <span className="truncate text-fg-muted">
            {t(`registry.roles.${row.original.role}`)}
          </span>
        ),
      },
      {
        id: 'step',
        header: t('registry.entry.lineageColumns.step'),
        size: 120,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {t('registry.entry.stepsAway', { count: row.original.depth })}
          </span>
        ),
      },
      ...(removable && canWrite
        ? [
            {
              id: 'remove',
              header: '',
              size: 120,
              cell: ({ row }: { row: { original: LineageNode } }) =>
                row.original.depth === 1 ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={unlink.isPending}
                    onClick={() => unlink.mutate(row.original)}
                  >
                    {t('registry.entry.removeParent')}
                  </Button>
                ) : null,
            },
          ]
        : []),
    ]
  }

  return (
    <Section
      title={t('registry.entry.lineage')}
      action={
        canWrite ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('registry.entry.addParent')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 text-label font-medium text-fg-muted">
            {t('registry.entry.cameFrom')}
          </h3>
          {up.length > 0 ? (
            <RegistryGrid
              label={t('registry.entry.cameFrom')}
              rows={up}
              columns={columns(true)}
              getRowId={(node) => node.entry.id}
            />
          ) : (
            <p className="m-0 text-label text-fg-muted">
              {t('registry.entry.noAncestors')}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 text-label font-medium text-fg-muted">
            {t('registry.entry.madeFromIt')}
          </h3>
          {down.length > 0 ? (
            <RegistryGrid
              label={t('registry.entry.madeFromIt')}
              rows={down}
              columns={columns(false)}
              getRowId={(node) => node.entry.id}
            />
          ) : (
            <p className="m-0 text-label text-fg-muted">
              {t('registry.entry.noDescendants')}
            </p>
          )}
        </div>
      </div>
      <AddParentDialog
        open={adding}
        onOpenChange={setAdding}
        entryId={entryId}
        identifier={identifier}
        candidates={graph.entries
          .filter((e) => e.id !== entryId && !e.archived_at)
          .map((e) => ({
            id: e.id,
            label: `${e.identifier} · ${e.title}`,
          }))}
      />
    </Section>
  )
}

function AddParentDialog({
  open,
  onOpenChange,
  entryId,
  identifier,
  candidates,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryId: string
  identifier: string
  candidates: { id: string; label: string }[]
}) {
  const queryClient = useQueryClient()
  const [parent, setParent] = useState('')
  const [role, setRole] = useState<ParentRole>('parent')
  const selected = parent || candidates[0]?.id || ''

  const add = useMutation({
    mutationFn: () => addParent(client, entryId, selected, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      toast.success(t('registry.entry.parentAdded'))
      onOpenChange(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.entry.couldNotLink'))),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('registry.entry.addParentTitle', { number: identifier })}
        />
        <DialogBody>
          {candidates.length === 0 ? (
            <p className="m-0 text-label text-fg-muted">
              {t('registry.entry.pickParentNone')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <Field label={t('registry.entry.pickParent')}>
                <Select
                  value={selected}
                  onChange={(e) => setParent(e.target.value)}
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('registry.entry.role')}>
                <Select
                  value={role}
                  onChange={(e) => setRole(e.target.value as ParentRole)}
                >
                  {PARENT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`registry.roles.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="quiet" />}>
            {t('registry.entry.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!selected || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending
              ? t('registry.entry.adding')
              : t('registry.entry.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Retire hides nothing and keeps the number; it only marks the entry. */
export function RegistryRetireButton({
  recordId,
  identifier,
  retired,
  metadataVersion,
}: {
  recordId: string
  identifier: string
  retired: boolean
  metadataVersion: number
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const change = useMutation({
    mutationFn: () =>
      client.rpc(retired ? 'restore_record' : 'archive_record', {
        p_record_id: recordId,
        p_expected_metadata_version: metadataVersion,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      toast.success(
        retired ? t('registry.entry.restored') : t('registry.entry.retired'),
      )
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'record-models'],
      })
      setConfirming(false)
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.entry.couldNotChange'))),
  })

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => (retired ? change.mutate() : setConfirming(true))}
        disabled={change.isPending}
      >
        {retired ? t('registry.entry.restore') : t('registry.entry.retire')}
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="w-[min(440px,calc(100vw-32px))]">
          <DialogHeader
            title={t('registry.entry.retireTitle', { number: identifier })}
          />
          <DialogBody>
            <p className="m-0 text-body">{t('registry.entry.retireBody')}</p>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="quiet" />}>
              {t('registry.entry.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={change.isPending}
              onClick={() => change.mutate()}
            >
              {t('registry.entry.retireConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
