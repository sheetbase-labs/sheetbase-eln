/**
 * One registry entry: what it is, where it came from, what has been made from
 * it, and which samples and records use it.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Textarea } from '#/components/v3/inventory/list'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { RecordPickerDialog } from '#/components/v3/record-picker/record-picker'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { Status } from '#/components/v3/ui/status'
import { t } from '#/copy'
import { formatDate } from '#/lib/format-date'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  PARENT_ROLES,
  addParent,
  fetchEntries,
  fetchParents,
  fetchUses,
  messageOf,
  registryKeys,
  removeParent,
  setEntryStatus,
  setUse,
  walkLineage,
} from '#/lib/bio-registry'
import type { LineageNode, ParentRole, RegistryEntry } from '#/lib/bio-registry'

import { RegistryFormDialog } from './registry-form'
import {
  STATUS_TONE,
  filledDetails,
  kindLabel,
  roleLabel,
  statusLabel,
} from './registry-shared'

const client = notebookDataClient

interface UsedRecord {
  id: string
  identifier: string
  title: string | null
  kind: string
  linkedAt: string
}

async function fetchUsedRecords(entryId: string): Promise<UsedRecord[]> {
  const uses = await fetchUses(client, entryId)
  if (uses.length === 0) return []
  const rows = await client.list<{
    id: string
    identifier: string
    title: string | null
    kind: string
  }>(
    'records',
    `?id=in.(${uses.map((u) => u.record_id).join(',')})&select=id,identifier,title,kind`,
  )
  const byId = new Map(rows.map((r) => [r.id, r] as const))
  return uses.flatMap((use) => {
    const row = byId.get(use.record_id)
    return row
      ? [
          {
            id: row.id,
            identifier: row.identifier,
            title: row.title,
            kind: row.kind,
            linkedAt: use.created_at,
          },
        ]
      : []
  })
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-[96px] flex-col gap-0.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className="m-0 truncate text-body font-medium">{children}</dd>
    </div>
  )
}

function Section({
  title,
  help,
  actions,
  children,
}: {
  title: string
  help?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6">
        <h2 className="font-heading text-doc font-semibold">{title}</h2>
        {help ? (
          <span className="text-label text-fg-muted max-md:hidden">{help}</span>
        ) : null}
        <span className="flex-1" />
        {actions}
      </div>
      {children}
    </section>
  )
}

function LineageTable({
  nodes,
  label,
  empty,
  canWrite,
  onRemove,
}: {
  nodes: LineageNode[]
  label: string
  empty: string
  canWrite: boolean
  onRemove?: (node: LineageNode) => void
}) {
  const columns = useMemo<RegistryColumn<LineageNode>[]>(
    () => [
      {
        id: 'number',
        header: t('registry.entry.lineageColumns.number'),
        size: 110,
        cell: ({ row }) => (
          <Link
            to="/registry/$entryId"
            params={{ entryId: row.original.entry.id }}
            className="mono text-link"
          >
            {row.original.entry.registryId}
          </Link>
        ),
      },
      {
        id: 'name',
        header: t('registry.entry.lineageColumns.name'),
        cell: ({ row }) => (
          <span className="truncate">{row.original.entry.name}</span>
        ),
      },
      {
        id: 'role',
        header: t('registry.entry.lineageColumns.role'),
        size: 160,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.role ? roleLabel(row.original.role) : ''}
          </span>
        ),
      },
      {
        id: 'step',
        header: t('registry.entry.lineageColumns.step'),
        size: 120,
        cell: ({ row }) => (
          <span className="num text-fg-muted">
            {t('registry.entry.stepsAway', { count: row.original.depth })}
          </span>
        ),
      },
      ...(onRemove && canWrite
        ? [
            {
              id: 'remove',
              header: '',
              size: 120,
              cell: ({ row }: { row: { original: LineageNode } }) =>
                row.original.depth === 1 ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => onRemove(row.original)}
                  >
                    {t('registry.entry.removeParent')}
                  </Button>
                ) : null,
            } satisfies RegistryColumn<LineageNode>,
          ]
        : []),
    ],
    [canWrite, onRemove],
  )
  if (nodes.length === 0) {
    return <p className="m-0 px-4 text-label text-fg-muted md:px-6">{empty}</p>
  }
  return (
    <RegistryGrid
      label={label}
      rows={nodes}
      columns={columns}
      getRowId={(node) => node.entry.id}
      selectable={false}
    />
  )
}

function AddParentDialog({
  open,
  onOpenChange,
  entry,
  candidates,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: RegistryEntry
  candidates: RegistryEntry[]
}) {
  const queryClient = useQueryClient()
  const [parentId, setParentId] = useState('')
  const [role, setRole] = useState<ParentRole>('parent')
  const add = useMutation({
    mutationFn: () => addParent(client, entry.id, parentId, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      setParentId('')
      onOpenChange(false)
      toast.success(t('registry.entry.parentAdded'))
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.entry.couldNotLink'))),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader title={t('registry.entry.addParent')} />
        <DialogBody>
          <form
            id="add-parent-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (parentId) add.mutate()
            }}
          >
            <Field label={t('registry.form.pickParent')} required>
              <Select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">{t('registry.form.pickParent')}</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.registryId} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('registry.entry.lineageColumns.role')}>
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as ParentRole)}
              >
                {PARENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </Select>
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('registry.form.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            type="submit"
            form="add-parent-form"
            disabled={!parentId || add.isPending}
          >
            {t('registry.entry.addParent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RetireDialog({
  open,
  onOpenChange,
  entry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: RegistryEntry
}) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const retire = useMutation({
    mutationFn: () =>
      setEntryStatus(client, entry.id, 'retired', reason.trim() || null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      setReason('')
      onOpenChange(false)
      toast.success(t('registry.entry.retired'))
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.form.couldNotSave'))),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('registry.entry.retireTitle', { number: entry.registryId })}
          description={t('registry.entry.retireBody')}
        />
        <DialogBody>
          <Field label={t('registry.entry.retireReason')}>
            <Textarea
              rows={3}
              value={reason}
              placeholder={t('registry.entry.retireReasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('registry.form.cancel')}
          </DialogClose>
          <Button
            variant="danger-fill"
            disabled={retire.isPending}
            onClick={() => retire.mutate()}
          >
            {t('registry.entry.retireConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RegistryEntryPage({
  entryId,
  canWrite,
}: {
  entryId: string
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const [addingParent, setAddingParent] = useState(false)
  const [linking, setLinking] = useState(false)
  const [derive, setDerive] = useState(false)

  const entries = useQuery({
    queryKey: registryKeys.list,
    queryFn: () => fetchEntries(client),
    staleTime: 10_000,
  })
  const links = useQuery({
    queryKey: [...registryKeys.list, 'parents'],
    queryFn: () => fetchParents(client),
    staleTime: 10_000,
  })
  const uses = useQuery({
    queryKey: [...registryKeys.entry(entryId), 'uses'],
    queryFn: () => fetchUsedRecords(entryId),
    staleTime: 10_000,
  })

  const all = entries.data ?? []
  const entry = all.find((e) => e.id === entryId)
  const ancestors = useMemo(
    () => walkLineage(entryId, 'up', all, links.data ?? []),
    [entryId, all, links.data],
  )
  const descendants = useMemo(
    () => walkLineage(entryId, 'down', all, links.data ?? []),
    [entryId, all, links.data],
  )

  const restore = useMutation({
    mutationFn: () => setEntryStatus(client, entryId, 'active', null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      toast.success(t('registry.entry.restored'))
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.form.couldNotSave'))),
  })
  const unlinkParent = useMutation({
    mutationFn: (node: LineageNode) =>
      removeParent(client, entryId, node.entry.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: registryKeys.all })
      toast.success(t('registry.entry.parentRemoved'))
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.entry.couldNotLink'))),
  })
  const changeUse = useMutation({
    mutationFn: (input: { recordId: string; linked: boolean }) =>
      setUse(client, entryId, input.recordId, input.linked),
    onSuccess: (_, input) => {
      void queryClient.invalidateQueries({
        queryKey: registryKeys.entry(entryId),
      })
      toast.success(
        input.linked
          ? t('registry.entry.linked')
          : t('registry.entry.unlinked'),
      )
    },
    onError: (e: unknown) =>
      toast.error(messageOf(e, t('registry.entry.couldNotLink'))),
  })

  const usedColumns = useMemo<RegistryColumn<UsedRecord>[]>(
    () => [
      {
        id: 'record',
        header: t('registry.entry.usedColumns.record'),
        size: 130,
        cell: ({ row }) => (
          <ObjectLink
            kind={row.original.kind}
            id={row.original.id}
            identifier={row.original.identifier}
          />
        ),
      },
      {
        id: 'title',
        header: t('registry.entry.usedColumns.title'),
        cell: ({ row }) => (
          <span className="truncate">{row.original.title ?? ''}</span>
        ),
      },
      {
        id: 'kind',
        header: t('registry.entry.usedColumns.kind'),
        size: 130,
        cell: ({ row }) => (
          <span className="truncate capitalize text-fg-muted">
            {row.original.kind}
          </span>
        ),
      },
      {
        id: 'linked',
        header: t('registry.entry.usedColumns.linked'),
        size: 130,
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {formatDate(row.original.linkedAt)}
          </span>
        ),
      },
      ...(canWrite
        ? [
            {
              id: 'unlink',
              header: '',
              size: 100,
              cell: ({ row }: { row: { original: UsedRecord } }) => (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() =>
                    changeUse.mutate({
                      recordId: row.original.id,
                      linked: false,
                    })
                  }
                >
                  {t('registry.entry.unlink')}
                </Button>
              ),
            } satisfies RegistryColumn<UsedRecord>,
          ]
        : []),
    ],
    [canWrite, changeUse],
  )

  if (entries.isPending) {
    return (
      <div className="flex-1 p-6 text-fg-muted">
        {t('common.states.loading')}
      </div>
    )
  }
  if (!entry) {
    return (
      <div className="p-6">
        <Notice tone="info" title={t('registry.entry.notFoundTitle')}>
          {t('registry.entry.notFoundBody')}
        </Notice>
      </div>
    )
  }

  const details = filledDetails(entry)
  const usedIds = (uses.data ?? []).map((u) => u.id)
  const activeOthers = all.filter(
    (e) => e.id !== entry.id && e.status === 'active',
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-auto pb-10 max-md:pb-24">
      <header className="flex flex-col gap-2 border-b border-border bg-surface px-4 py-3 md:px-6 md:py-4">
        <Link
          to="/registry"
          className="w-fit text-label text-link underline-offset-2 hover:underline"
        >
          {t('registry.entry.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="mono text-body text-fg-muted">
            {entry.registryId}
          </span>
          <h1 className="text-title max-md:text-[18px]">{entry.name}</h1>
          <Status tone={STATUS_TONE[entry.status]}>
            {statusLabel(entry.status)}
          </Status>
          <span className="flex-1" />
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)}>
                {t('registry.entry.edit')}
              </Button>
              <Button onClick={() => setDerive(true)}>
                {t('registry.entry.deriveNew')}
              </Button>
              {entry.status === 'active' ? (
                <Button variant="danger" onClick={() => setRetiring(true)}>
                  {t('registry.entry.retire')}
                </Button>
              ) : (
                <Button
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  {t('registry.entry.restore')}
                </Button>
              )}
            </div>
          ) : null}
        </div>
        {entry.status === 'retired' ? (
          <Notice tone="info" title={t('registry.entry.retiredBanner')}>
            {entry.retiredReason
              ? t('registry.entry.retiredBecause', {
                  reason: entry.retiredReason,
                })
              : t('registry.entry.retiredNoReason')}
          </Notice>
        ) : null}
        <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3 pt-1">
          <Fact label={t('registry.entry.facts.type')}>
            {kindLabel(entry.kind)}
          </Fact>
          {entry.kind === 'construct' && entry.details.seqLength ? (
            <>
              <Fact label={t('registry.entry.facts.length')}>
                {t(
                  `sequences.summary.length.${entry.details.seqMolecule === 'protein' ? 'protein' : entry.details.seqMolecule === 'rna' ? 'rna' : 'dna'}`,
                  { count: Number(entry.details.seqLength) },
                )}
              </Fact>
              <Fact label={t('registry.entry.facts.shape')}>
                <span className="capitalize">
                  {t(
                    `sequences.summary.${entry.details.seqTopology === 'circular' ? 'circular' : 'linear'}`,
                  )}
                </span>
              </Fact>
            </>
          ) : null}
          <Fact label={t('registry.entry.facts.added')}>
            {formatDate(entry.createdAt)}
          </Fact>
          <Fact label={t('registry.entry.facts.updated')}>
            {formatDate(entry.updatedAt)}
          </Fact>
        </dl>
      </header>

      <Section title={t('registry.entry.details')}>
        <div className="px-4 md:px-6">
          {details.length === 0 && !entry.description ? (
            <p className="m-0 text-label text-fg-muted">
              {t('registry.entry.noDetails')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {details.length > 0 ? (
                <dl className="m-0 grid grid-cols-3 gap-x-6 gap-y-3 max-md:grid-cols-1">
                  {details.map((d) => (
                    <Fact key={d.key} label={d.label}>
                      {d.value}
                    </Fact>
                  ))}
                </dl>
              ) : null}
              {entry.description ? (
                <p className="m-0 whitespace-pre-wrap text-body">
                  {entry.description}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </Section>

      <Section
        title={t('registry.entry.lineage')}
        help={t('registry.entry.lineageHelp')}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setAddingParent(true)}>
              {t('registry.entry.addParent')}
            </Button>
          ) : null
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="m-0 px-4 text-label font-medium text-fg-muted md:px-6">
              {t('registry.entry.cameFrom')}
            </h3>
            <LineageTable
              nodes={ancestors}
              label={t('registry.entry.cameFrom')}
              empty={t('registry.entry.noAncestors')}
              canWrite={canWrite}
              onRemove={(node) => unlinkParent.mutate(node)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="m-0 px-4 text-label font-medium text-fg-muted md:px-6">
              {t('registry.entry.madeFromIt')}
            </h3>
            <LineageTable
              nodes={descendants}
              label={t('registry.entry.madeFromIt')}
              empty={t('registry.entry.noDescendants')}
              canWrite={false}
            />
          </div>
        </div>
      </Section>

      <Section
        title={t('registry.entry.usedIn')}
        help={t('registry.entry.usedInHelp')}
        actions={
          canWrite ? (
            <Button size="sm" onClick={() => setLinking(true)}>
              {t('registry.entry.linkRecord')}
            </Button>
          ) : null
        }
      >
        {(uses.data ?? []).length === 0 && !uses.isPending ? (
          <p className="m-0 px-4 text-label text-fg-muted md:px-6">
            {t('registry.entry.noUses')}
          </p>
        ) : (
          <RegistryGrid
            label={t('registry.entry.usedIn')}
            rows={uses.data ?? []}
            columns={usedColumns}
            getRowId={(row) => row.id}
            selectable={false}
            isLoading={uses.isPending}
          />
        )}
      </Section>

      <RegistryFormDialog
        open={editing}
        onOpenChange={setEditing}
        entry={entry}
        entries={all}
        onSaved={() => toast.success(t('registry.entry.saved'))}
      />
      <RegistryFormDialog
        open={derive}
        onOpenChange={setDerive}
        fromEntry={entry}
        entries={activeOthers.concat(entry)}
        onSaved={() => undefined}
      />
      <RetireDialog open={retiring} onOpenChange={setRetiring} entry={entry} />
      <AddParentDialog
        open={addingParent}
        onOpenChange={setAddingParent}
        entry={entry}
        candidates={activeOthers.filter(
          (c) => !descendants.some((d) => d.entry.id === c.id),
        )}
      />
      <RecordPickerDialog
        open={linking}
        onOpenChange={setLinking}
        title={t('registry.entry.linkRecordTitle', {
          number: entry.registryId,
        })}
        allowed={['Sample', 'Material', 'Experiment']}
        exclude={usedIds}
        multiple
        onPick={(items) =>
          items.forEach((item) =>
            changeUse.mutate({ recordId: item.id, linked: true }),
          )
        }
      />
    </div>
  )
}
